import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  isStatementSection,
  parsePastedTrialBalance,
  round2,
  SECTION_META,
  sum,
  type BalanceSource,
  type ColumnMap,
  type ImportPreview,
  type ImportPreviewRow,
  type StatementSection,
  type TrialBalanceResponse,
  type TrialBalanceRowDto,
} from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { toDecimal, toNumber } from '../common/decimal';

export interface EntryInput {
  accountId: string;
  debit: number;
  credit: number;
  note?: string | null;
}

export interface PasteOptionsInput {
  columnMap?: ColumnMap;
  amountSign?: 'DEBIT_POSITIVE' | 'CREDIT_POSITIVE';
  /** Add accounts the paste refers to but the chart does not have yet. */
  createMissingAccounts?: boolean;
  /** Zero every account the paste does not mention. */
  replaceAll?: boolean;
}

@Injectable()
export class TrialBalanceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async get(companyId: string, financialYearId: string): Promise<TrialBalanceResponse> {
    const year = await this.prisma.financialYear.findUnique({
      where: { id: financialYearId },
      select: { id: true, previousYearId: true },
    });
    if (!year) throw new NotFoundException('That financial year was not found.');

    const [accounts, entries, priorEntries] = await Promise.all([
      this.prisma.account.findMany({
        where: { companyId, isActive: true },
        orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      }),
      this.prisma.trialBalanceEntry.findMany({ where: { financialYearId } }),
      year.previousYearId
        ? this.prisma.trialBalanceEntry.findMany({
            where: { financialYearId: year.previousYearId },
          })
        : Promise.resolve([]),
    ]);

    const byAccount = new Map(entries.map((e) => [e.accountId, e]));
    const priorByAccount = new Map(priorEntries.map((e) => [e.accountId, e]));

    const rows: TrialBalanceRowDto[] = accounts.map((account) => {
      const entry = byAccount.get(account.id);
      const prior = priorByAccount.get(account.id);
      return {
        accountId: account.id,
        code: account.code,
        name: account.name,
        type: account.type,
        section: isStatementSection(account.section) ? account.section : null,
        debit: toNumber(entry?.debit),
        credit: toNumber(entry?.credit),
        priorDebit: toNumber(prior?.debit),
        priorCredit: toNumber(prior?.credit),
        source: (entry?.source ?? 'MANUAL') as BalanceSource,
        updatedAt: entry?.updatedAt.toISOString() ?? null,
      };
    });

    const totalDebit = sum(rows.map((r) => r.debit));
    const totalCredit = sum(rows.map((r) => r.credit));
    const difference = round2(totalDebit - totalCredit);

    return {
      financialYearId,
      rows,
      totalDebit,
      totalCredit,
      difference,
      isBalanced: difference === 0,
      priorYearId: year.previousYearId,
    };
  }

  /**
   * Save a block of figures.
   *
   * An account can hold a debit or a credit, never both, so a row carrying two
   * amounts is netted to the side it actually falls on. Rows that come back to
   * zero have their entry removed rather than stored as a nil balance, which
   * keeps the grid and the statements free of empty lines.
   */
  async saveEntries(
    companyId: string,
    financialYearId: string,
    userId: string,
    entries: EntryInput[],
    source: BalanceSource = 'MANUAL',
  ): Promise<TrialBalanceResponse> {
    if (entries.length === 0) {
      return this.get(companyId, financialYearId);
    }

    const accountIds = [...new Set(entries.map((e) => e.accountId))];
    const accounts = await this.prisma.account.findMany({
      where: { id: { in: accountIds }, companyId },
      select: { id: true, code: true },
    });
    if (accounts.length !== accountIds.length) {
      throw new BadRequestException('One of those accounts does not belong to this company.');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const entry of entries) {
        const net = round2((entry.debit ?? 0) - (entry.credit ?? 0));
        const debit = net > 0 ? net : 0;
        const credit = net < 0 ? round2(-net) : 0;

        if (debit === 0 && credit === 0) {
          await tx.trialBalanceEntry.deleteMany({
            where: { financialYearId, accountId: entry.accountId },
          });
          continue;
        }

        await tx.trialBalanceEntry.upsert({
          where: {
            financialYearId_accountId: { financialYearId, accountId: entry.accountId },
          },
          create: {
            financialYearId,
            accountId: entry.accountId,
            debit: toDecimal(debit),
            credit: toDecimal(credit),
            source,
            note: entry.note ?? null,
          },
          update: {
            debit: toDecimal(debit),
            credit: toDecimal(credit),
            source,
            ...(entry.note !== undefined ? { note: entry.note } : {}),
          },
        });
      }
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'TRIAL_BALANCE_SAVED',
      entity: 'FinancialYear',
      entityId: financialYearId,
      summary: `Saved ${entries.length} ${entries.length === 1 ? 'balance' : 'balances'} (${source.toLowerCase()})`,
    });

    return this.get(companyId, financialYearId);
  }

  /** Read a pasted block and say what committing it would do, changing nothing. */
  async previewPaste(
    companyId: string,
    financialYearId: string,
    text: string,
    options: PasteOptionsInput = {},
  ): Promise<ImportPreview> {
    const parsed = parsePastedTrialBalance(text, {
      columnMap: options.columnMap,
      amountSign: options.amountSign,
    });

    const accounts = await this.prisma.account.findMany({
      where: { companyId },
      select: { id: true, code: true, name: true, isActive: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code.trim().toUpperCase(), a]));
    const byName = new Map(accounts.map((a) => [a.name.trim().toUpperCase(), a]));

    const rows: ImportPreviewRow[] = parsed.rows.map((row) => {
      const problems = [...row.problems];
      const match =
        (row.code ? byCode.get(row.code.trim().toUpperCase()) : undefined) ??
        (row.name ? byName.get(row.name.trim().toUpperCase()) : undefined);

      let action: ImportPreviewRow['action'] = 'UPDATE';

      if (!match) {
        if (row.section) {
          action = 'CREATE';
        } else {
          action = 'ERROR';
          problems.push(
            `Account ${row.code || row.name} is not on the chart. Add a reporting category column, or create the account first.`,
          );
        }
      }

      if (problems.length > 0) action = 'ERROR';

      return {
        rowNumber: row.rowNumber,
        code: row.code,
        name: row.name,
        debit: row.debit,
        credit: row.credit,
        section: row.section,
        action,
        problems,
      };
    });

    return {
      rows,
      totalDebit: parsed.totalDebit,
      totalCredit: parsed.totalCredit,
      difference: round2(parsed.totalDebit - parsed.totalCredit),
      createCount: rows.filter((r) => r.action === 'CREATE').length,
      updateCount: rows.filter((r) => r.action === 'UPDATE').length,
      errorCount: rows.filter((r) => r.action === 'ERROR').length,
      skippedRows: parsed.skippedRows,
      problems: parsed.problems,
    };
  }

  /**
   * Apply a pasted block.
   *
   * The whole paste goes in or none of it does. A half applied trial balance is
   * worse than a rejected one, because the difference it leaves looks like a
   * real accounting error.
   */
  async commitPaste(
    companyId: string,
    financialYearId: string,
    userId: string,
    text: string,
    options: PasteOptionsInput = {},
  ): Promise<{ preview: ImportPreview; result: TrialBalanceResponse }> {
    const preview = await this.previewPaste(companyId, financialYearId, text, options);

    if (preview.problems.length > 0) {
      throw new BadRequestException(preview.problems.join(' '));
    }
    if (preview.errorCount > 0) {
      const first = preview.rows.find((r) => r.action === 'ERROR');
      throw new BadRequestException(
        `${preview.errorCount} ${preview.errorCount === 1 ? 'row has' : 'rows have'} a problem. Row ${first?.rowNumber}: ${first?.problems[0]}`,
      );
    }
    if (preview.createCount > 0 && !options.createMissingAccounts) {
      throw new BadRequestException(
        `${preview.createCount} of those accounts are not on the chart yet. Confirm creating them, or add them first.`,
      );
    }

    const accounts = await this.prisma.account.findMany({
      where: { companyId },
      select: { id: true, code: true, name: true },
    });
    const byCode = new Map(accounts.map((a) => [a.code.trim().toUpperCase(), a.id]));
    const byName = new Map(accounts.map((a) => [a.name.trim().toUpperCase(), a.id]));

    const entries: EntryInput[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const row of preview.rows) {
        let accountId =
          (row.code ? byCode.get(row.code.trim().toUpperCase()) : undefined) ??
          (row.name ? byName.get(row.name.trim().toUpperCase()) : undefined);

        if (!accountId && row.section) {
          const section = row.section as StatementSection;
          const created = await tx.account.create({
            data: {
              companyId,
              code: row.code || row.name,
              name: row.name || row.code,
              type: SECTION_META[section].accountType,
              section,
            },
          });
          accountId = created.id;
          byCode.set(created.code.trim().toUpperCase(), created.id);
        }

        if (!accountId) continue;
        entries.push({ accountId, debit: row.debit, credit: row.credit });
      }

      if (options.replaceAll) {
        const keep = entries.map((e) => e.accountId);
        await tx.trialBalanceEntry.deleteMany({
          where: { financialYearId, accountId: { notIn: keep } },
        });
      }

      for (const entry of entries) {
        const net = round2(entry.debit - entry.credit);
        const debit = net > 0 ? net : 0;
        const credit = net < 0 ? round2(-net) : 0;

        if (debit === 0 && credit === 0) {
          await tx.trialBalanceEntry.deleteMany({
            where: { financialYearId, accountId: entry.accountId },
          });
          continue;
        }

        await tx.trialBalanceEntry.upsert({
          where: { financialYearId_accountId: { financialYearId, accountId: entry.accountId } },
          create: {
            financialYearId,
            accountId: entry.accountId,
            debit: toDecimal(debit),
            credit: toDecimal(credit),
            source: 'PASTE',
          },
          update: { debit: toDecimal(debit), credit: toDecimal(credit), source: 'PASTE' },
        });
      }
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'TRIAL_BALANCE_PASTED',
      entity: 'FinancialYear',
      entityId: financialYearId,
      summary: `Pasted ${entries.length} balances, ${preview.createCount} new accounts${
        options.replaceAll ? ', replacing everything else' : ''
      }`,
    });

    return { preview, result: await this.get(companyId, financialYearId) };
  }

  async clear(companyId: string, financialYearId: string, userId: string): Promise<void> {
    const { count } = await this.prisma.trialBalanceEntry.deleteMany({
      where: { financialYearId },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'TRIAL_BALANCE_CLEARED',
      entity: 'FinancialYear',
      entityId: financialYearId,
      summary: `Cleared ${count} balances`,
    });
  }
}
