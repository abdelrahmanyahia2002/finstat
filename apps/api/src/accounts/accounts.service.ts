import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isAccountType,
  isStatementSection,
  SECTION_META,
  type AccountDto,
  type AccountType,
  type StatementSection,
} from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { STANDARD_CHART } from './chart-template';

export interface AccountInput {
  code: string;
  name: string;
  type: AccountType;
  section?: StatementSection | null;
  description?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}

@Injectable()
export class AccountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async list(companyId: string, includeInactive = false): Promise<AccountDto[]> {
    const accounts = await this.prisma.account.findMany({
      where: { companyId, ...(includeInactive ? {} : { isActive: true }) },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
    });

    return accounts.map(toDto);
  }

  async create(companyId: string, userId: string, input: AccountInput): Promise<AccountDto> {
    this.assertConsistent(input);

    const code = input.code.trim();
    const clash = await this.prisma.account.findUnique({
      where: { companyId_code: { companyId, code } },
    });
    if (clash) {
      throw new ConflictException(`Account ${code} already exists on this chart.`);
    }

    const account = await this.prisma.account.create({
      data: {
        companyId,
        code,
        name: input.name.trim(),
        type: input.type,
        section: input.section ?? null,
        description: input.description ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'ACCOUNT_CREATED',
      entity: 'Account',
      entityId: account.id,
      summary: `Added account ${account.code} ${account.name}`,
    });

    return toDto(account);
  }

  async update(
    companyId: string,
    accountId: string,
    userId: string,
    input: Partial<AccountInput>,
  ): Promise<AccountDto> {
    const existing = await this.prisma.account.findUnique({ where: { id: accountId } });
    if (!existing || existing.companyId !== companyId) {
      throw new NotFoundException('That account was not found.');
    }

    const merged = {
      type: input.type ?? existing.type,
      section: input.section !== undefined ? input.section : (existing.section as StatementSection | null),
    };
    this.assertConsistent(merged);

    if (input.code && input.code.trim() !== existing.code) {
      const clash = await this.prisma.account.findUnique({
        where: { companyId_code: { companyId, code: input.code.trim() } },
      });
      if (clash) throw new ConflictException(`Account ${input.code} already exists on this chart.`);
    }

    const account = await this.prisma.account.update({
      where: { id: accountId },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.type !== undefined ? { type: input.type } : {}),
        ...(input.section !== undefined ? { section: input.section } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'ACCOUNT_UPDATED',
      entity: 'Account',
      entityId: accountId,
      summary: `Updated account ${account.code} ${account.name}`,
      before: { code: existing.code, name: existing.name, section: existing.section },
      after: { code: account.code, name: account.name, section: account.section },
    });

    return toDto(account);
  }

  /**
   * Accounts that have ever carried a balance are deactivated rather than
   * deleted, because deleting one would silently rewrite the history of every
   * year it appears in.
   */
  async remove(companyId: string, accountId: string, userId: string): Promise<{ deactivated: boolean }> {
    const account = await this.prisma.account.findUnique({
      where: { id: accountId },
      include: { _count: { select: { balances: true, adjustmentLines: true } } },
    });
    if (!account || account.companyId !== companyId) {
      throw new NotFoundException('That account was not found.');
    }

    const inUse = account._count.balances > 0 || account._count.adjustmentLines > 0;

    if (inUse) {
      await this.prisma.account.update({ where: { id: accountId }, data: { isActive: false } });
    } else {
      await this.prisma.account.delete({ where: { id: accountId } });
    }

    await this.audit.record({
      companyId,
      userId,
      action: inUse ? 'ACCOUNT_DEACTIVATED' : 'ACCOUNT_DELETED',
      entity: 'Account',
      entityId: accountId,
      summary: `${inUse ? 'Deactivated' : 'Deleted'} account ${account.code} ${account.name}`,
    });

    return { deactivated: inUse };
  }

  /** Create or update many accounts at once, for a pasted or imported chart. */
  async bulkUpsert(
    companyId: string,
    userId: string,
    rows: AccountInput[],
  ): Promise<{ created: number; updated: number; problems: string[] }> {
    const problems: string[] = [];
    const valid: AccountInput[] = [];

    const seen = new Set<string>();
    rows.forEach((row, index) => {
      const code = row.code?.trim();
      if (!code) {
        problems.push(`Row ${index + 1} has no account code.`);
        return;
      }
      if (seen.has(code.toUpperCase())) {
        problems.push(`Row ${index + 1}: account ${code} appears more than once.`);
        return;
      }
      if (!row.name?.trim()) {
        problems.push(`Row ${index + 1}: account ${code} has no name.`);
        return;
      }
      if (!isAccountType(row.type)) {
        problems.push(`Row ${index + 1}: "${row.type}" is not a valid account type.`);
        return;
      }
      if (row.section && !isStatementSection(row.section)) {
        problems.push(`Row ${index + 1}: "${row.section}" is not a known reporting category.`);
        return;
      }
      seen.add(code.toUpperCase());
      valid.push({ ...row, code });
    });

    const existing = await this.prisma.account.findMany({
      where: { companyId, code: { in: valid.map((r) => r.code) } },
      select: { id: true, code: true },
    });
    const existingByCode = new Map(existing.map((a) => [a.code, a.id]));

    let created = 0;
    let updated = 0;

    await this.prisma.$transaction(async (tx) => {
      for (const row of valid) {
        const id = existingByCode.get(row.code);
        if (id) {
          await tx.account.update({
            where: { id },
            data: {
              name: row.name.trim(),
              type: row.type,
              ...(row.section !== undefined ? { section: row.section } : {}),
              ...(row.description !== undefined ? { description: row.description } : {}),
              ...(row.sortOrder !== undefined ? { sortOrder: row.sortOrder } : {}),
              isActive: true,
            },
          });
          updated += 1;
        } else {
          await tx.account.create({
            data: {
              companyId,
              code: row.code,
              name: row.name.trim(),
              type: row.type,
              section: row.section ?? null,
              description: row.description ?? null,
              sortOrder: row.sortOrder ?? 0,
            },
          });
          created += 1;
        }
      }
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'CHART_BULK_UPDATED',
      entity: 'Account',
      summary: `Chart of accounts updated: ${created} added, ${updated} changed`,
    });

    return { created, updated, problems };
  }

  /** Put the standard chart on a company that has none yet. */
  async applyTemplate(
    companyId: string,
    userId: string,
  ): Promise<{ created: number; skipped: number }> {
    const existing = await this.prisma.account.findMany({
      where: { companyId },
      select: { code: true },
    });
    const have = new Set(existing.map((a) => a.code));
    const toCreate = STANDARD_CHART.filter((a) => !have.has(a.code));

    if (toCreate.length > 0) {
      await this.prisma.account.createMany({
        data: toCreate.map((a, index) => ({
          companyId,
          code: a.code,
          name: a.name,
          type: a.type,
          section: a.section,
          sortOrder: index,
        })),
      });
    }

    await this.audit.record({
      companyId,
      userId,
      action: 'CHART_TEMPLATE_APPLIED',
      entity: 'Account',
      summary: `Applied the standard chart of accounts, adding ${toCreate.length} accounts`,
    });

    return { created: toCreate.length, skipped: STANDARD_CHART.length - toCreate.length };
  }

  /**
   * The account type and the reporting category have to describe the same
   * thing. Catching it here keeps a revenue account from ever appearing under
   * current assets on the face of the balance sheet.
   */
  private assertConsistent(input: { type: AccountType; section?: StatementSection | null }): void {
    if (!input.section) return;
    if (!isStatementSection(input.section)) {
      throw new BadRequestException(`"${input.section}" is not a known reporting category.`);
    }
    const meta = SECTION_META[input.section];
    if (meta.accountType !== input.type) {
      throw new BadRequestException(
        `${meta.label} holds ${meta.accountType.toLowerCase()} accounts, but this one is ${input.type.toLowerCase()}.`,
      );
    }
  }
}

function toDto(account: {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: AccountType;
  section: string | null;
  isActive: boolean;
  sortOrder: number;
  description: string | null;
}): AccountDto {
  return {
    id: account.id,
    companyId: account.companyId,
    code: account.code,
    name: account.name,
    type: account.type,
    section: isStatementSection(account.section) ? account.section : null,
    isActive: account.isActive,
    sortOrder: account.sortOrder,
    description: account.description,
  };
}
