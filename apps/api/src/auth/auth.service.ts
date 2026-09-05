import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import type { SessionResponse } from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const BCRYPT_ROUNDS = 12;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  async register(input: {
    email: string;
    password: string;
    name: string;
  }): Promise<SessionResponse> {
    const email = input.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ConflictException('An account already uses that email address.');
    }

    // The very first account to register runs the installation.
    const userCount = await this.prisma.user.count();

    const user = await this.prisma.user.create({
      data: {
        email,
        name: input.name.trim(),
        passwordHash: await bcrypt.hash(input.password, BCRYPT_ROUNDS),
        globalRole: userCount === 0 ? 'SUPERADMIN' : 'USER',
      },
    });

    await this.audit.record({
      userId: user.id,
      action: 'USER_REGISTERED',
      entity: 'User',
      entityId: user.id,
      summary: `${user.email} created an account`,
    });

    return this.issueSession(user.id, user.email, user.name, user.globalRole);
  }

  async login(email: string, password: string, userAgent?: string): Promise<SessionResponse> {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });

    // One message for both branches, so the response cannot be used to work out
    // which addresses have accounts.
    const invalid = new UnauthorizedException('That email address and password do not match.');
    if (!user) {
      // Spend roughly the same time as a real comparison would.
      await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva');
      throw invalid;
    }
    if (!user.isActive) {
      throw new UnauthorizedException('This account has been deactivated.');
    }
    if (!(await bcrypt.compare(password, user.passwordHash))) {
      throw invalid;
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueSession(user.id, user.email, user.name, user.globalRole, userAgent);
  }

  async refresh(refreshToken: string, userAgent?: string): Promise<SessionResponse> {
    const tokenHash = hashToken(refreshToken);
    const stored = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Please sign in again.');
    }
    if (!stored.user.isActive) {
      throw new UnauthorizedException('This account has been deactivated.');
    }

    // Rotate: the presented token dies with the request that used it.
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date() },
    });

    return this.issueSession(
      stored.user.id,
      stored.user.email,
      stored.user.name,
      stored.user.globalRole,
      userAgent,
    );
  }

  async logout(refreshToken: string): Promise<void> {
    const tokenHash = hashToken(refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async logoutEverywhere(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, current: string, next: string): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await bcrypt.compare(current, user.passwordHash))) {
      throw new UnauthorizedException('The current password is not correct.');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash: await bcrypt.hash(next, BCRYPT_ROUNDS) },
    });

    // A password change ends every other session.
    await this.logoutEverywhere(userId);

    await this.audit.record({
      userId,
      action: 'PASSWORD_CHANGED',
      entity: 'User',
      entityId: userId,
      summary: 'Password changed',
    });
  }

  static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, BCRYPT_ROUNDS);
  }

  private async issueSession(
    userId: string,
    email: string,
    name: string,
    globalRole: 'SUPERADMIN' | 'USER',
    userAgent?: string,
  ): Promise<SessionResponse> {
    const accessSeconds = parseTtlSeconds(this.config.get<string>('JWT_ACCESS_TTL', '15m'));
    const accessToken = await this.jwt.signAsync(
      { sub: userId, email },
      {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
        expiresIn: accessSeconds,
      },
    );

    const refreshToken = randomBytes(48).toString('base64url');
    const refreshDays = Number(this.config.get<string>('JWT_REFRESH_DAYS', '7'));
    const expiresAt = new Date(Date.now() + refreshDays * 24 * 60 * 60 * 1000);

    await this.prisma.refreshToken.create({
      data: { userId, tokenHash: hashToken(refreshToken), expiresAt, userAgent },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessSeconds,
      user: { id: userId, email, name, globalRole },
    };
  }
}

/**
 * Refresh tokens are stored as a digest. A leaked database dump then contains
 * nothing that can be replayed against the API.
 */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function parseTtlSeconds(ttl: string): number {
  const match = /^(\d+)([smhd])$/.exec(ttl.trim());
  if (!match) return 900;
  const value = Number(match[1]);
  const unit = match[2];
  const multipliers: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };
  return value * (multipliers[unit] ?? 60);
}
