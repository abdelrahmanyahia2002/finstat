import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import type { AuditLogDto, Paginated } from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';

export interface AuditEntry {
  companyId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  summary: string;
  before?: Prisma.InputJsonValue;
  after?: Prisma.InputJsonValue;
  ipAddress?: string | null;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Audit writes never fail the operation they describe. Losing the trail is
   * bad; refusing a legitimate save because the trail could not be written is
   * worse, so a failure here is logged and swallowed.
   */
  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          companyId: entry.companyId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          summary: entry.summary,
          before: entry.before,
          after: entry.after,
          ipAddress: entry.ipAddress ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Could not write audit entry ${entry.action}`, error as Error);
    }
  }

  async list(
    companyId: string,
    options: { page?: number; pageSize?: number; entity?: string; entityId?: string } = {},
  ): Promise<Paginated<AuditLogDto>> {
    const page = Math.max(1, options.page ?? 1);
    const pageSize = Math.min(200, Math.max(1, options.pageSize ?? 50));

    const where: Prisma.AuditLogWhereInput = {
      companyId,
      ...(options.entity ? { entity: options.entity } : {}),
      ...(options.entityId ? { entityId: options.entityId } : {}),
    };

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.auditLog.count({ where }),
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { user: { select: { name: true, email: true } } },
      }),
    ]);

    return {
      items: rows.map((row) => ({
        id: row.id,
        action: row.action,
        entity: row.entity,
        entityId: row.entityId,
        summary: row.summary,
        userName: row.user?.name ?? null,
        userEmail: row.user?.email ?? null,
        createdAt: row.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
    };
  }
}
