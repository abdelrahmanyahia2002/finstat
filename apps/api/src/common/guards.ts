import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { roleAtLeast, type CompanyRole, type GlobalRole } from '@finstat/shared';

import { PrismaService } from './prisma/prisma.service';
import { COMPANY_ROLE_KEY, GLOBAL_ROLE_KEY, IS_PUBLIC_KEY, type RequestUser } from './decorators';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(private readonly reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }
}

@Injectable()
export class GlobalRoleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<GlobalRole>(GLOBAL_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required) return true;

    const user = context.switchToHttp().getRequest().user as RequestUser | undefined;
    if (user?.globalRole !== 'SUPERADMIN' && user?.globalRole !== required) {
      throw new ForbiddenException('You do not have access to this area.');
    }
    return true;
  }
}

/**
 * Every route below a `:companyId` runs through here. It proves the caller is a
 * member of that company before the controller sees the request, so no service
 * has to remember to scope its own query, and it puts the caller's role on the
 * request for the routes that need a minimum one.
 */
@Injectable()
export class CompanyAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user as RequestUser | undefined;
    if (!user) throw new ForbiddenException('Sign in to continue.');

    const companyId: string | undefined =
      request.params?.companyId ?? request.body?.companyId ?? request.query?.companyId;

    if (!companyId) {
      throw new NotFoundException('No company was specified.');
    }

    const membership = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId: user.id } },
      select: { role: true },
    });

    let role: CompanyRole | null = membership?.role ?? null;

    // A platform administrator can reach any company, with owner rights.
    if (!role && user.globalRole === 'SUPERADMIN') {
      const exists = await this.prisma.company.findUnique({
        where: { id: companyId },
        select: { id: true },
      });
      if (exists) role = 'OWNER';
    }

    if (!role) {
      // Not "forbidden": a caller who is not a member should not learn that
      // this company exists at all.
      throw new NotFoundException('That company was not found.');
    }

    request.companyId = companyId;
    request.companyRole = role;

    const required = this.reflector.getAllAndOverride<CompanyRole>(COMPANY_ROLE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required && !roleAtLeast(role, required)) {
      throw new ForbiddenException(
        `This needs ${required.toLowerCase()} access. Yours is ${role.toLowerCase()}.`,
      );
    }

    return true;
  }
}
