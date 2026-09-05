import { Injectable, NotFoundException } from '@nestjs/common';
import {
  computePeriod,
  isStatementSection,
  type AccountBalance,
  type PeriodComputation,
  type StatementSection,
} from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { toNumber } from '../common/decimal';

export interface LoadedYear {
  id: string;
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  status: string;
  previousYearId: string | null;
  companyName: string;
  currencyCode: string;
  currencySymbol: string;
  locale: string;
}

export interface PeriodContext {
  year: LoadedYear;
  period: PeriodComputation;
  prior: PeriodComputation | null;
  priorYear: LoadedYear | null;
  /** Every account on the company's chart, including ones with no balance. */
  accounts: Array<{
    id: string;
    code: string;
    name: string;
    section: StatementSection | null;
    isActive: boolean;
  }>;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class PeriodService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Load one financial year and turn it into figures.
   *
   * Posted adjustments are folded into the balances here rather than being
   * written back over the imported trial balance, so the original figures stay
   * intact and every statement still sees one number per account.
   */
  async loadPeriod(financialYearId: string): Promise<{ year: LoadedYear; period: PeriodComputation }> {
    const year = await this.prisma.financialYear.findUnique({
      where: { id: financialYearId },
      include: { company: true },
    });

    if (!year) {
      throw new NotFoundException('That financial year was not found.');
    }

    const loaded: LoadedYear = {
      id: year.id,
      companyId: year.companyId,
      label: year.label,
      startDate: isoDate(year.startDate),
      endDate: isoDate(year.endDate),
      status: year.status,
      previousYearId: year.previousYearId,
      companyName: year.company.name,
      currencyCode: year.company.currencyCode,
      currencySymbol: year.company.currencySymbol,
      locale: year.company.locale,
    };

    const rows = await this.buildBalances(financialYearId);

    return {
      year: loaded,
      period: computePeriod({
        financialYearId: year.id,
        label: year.label,
        startDate: loaded.startDate,
        endDate: loaded.endDate,
        rows,
      }),
    };
  }

  /** The year, its comparatives, and the chart of accounts behind both. */
  async loadContext(financialYearId: string): Promise<PeriodContext> {
    const { year, period } = await this.loadPeriod(financialYearId);

    let prior: PeriodComputation | null = null;
    let priorYear: LoadedYear | null = null;
    if (year.previousYearId) {
      const loaded = await this.loadPeriod(year.previousYearId);
      prior = loaded.period;
      priorYear = loaded.year;
    }

    const accounts = await this.prisma.account.findMany({
      where: { companyId: year.companyId },
      orderBy: [{ sortOrder: 'asc' }, { code: 'asc' }],
      select: { id: true, code: true, name: true, section: true, isActive: true },
    });

    return {
      year,
      period,
      prior,
      priorYear,
      accounts: accounts.map((a) => ({
        id: a.id,
        code: a.code,
        name: a.name,
        section: isStatementSection(a.section) ? a.section : null,
        isActive: a.isActive,
      })),
    };
  }

  private async buildBalances(financialYearId: string): Promise<AccountBalance[]> {
    const [entries, adjustmentLines] = await Promise.all([
      this.prisma.trialBalanceEntry.findMany({
        where: { financialYearId },
        include: { account: true },
      }),
      this.prisma.adjustmentLine.findMany({
        where: { adjustment: { financialYearId, status: 'POSTED' } },
        include: { account: true },
      }),
    ]);

    const byAccount = new Map<string, AccountBalance>();

    for (const entry of entries) {
      if (!entry.account.isActive) continue;
      byAccount.set(entry.accountId, {
        accountId: entry.accountId,
        code: entry.account.code,
        name: entry.account.name,
        type: entry.account.type,
        section: (entry.account.section ?? '') as StatementSection,
        debit: toNumber(entry.debit),
        credit: toNumber(entry.credit),
      });
    }

    for (const line of adjustmentLines) {
      if (!line.account.isActive) continue;
      const existing = byAccount.get(line.accountId);
      if (existing) {
        existing.debit = toNumber(existing.debit + toNumber(line.debit));
        existing.credit = toNumber(existing.credit + toNumber(line.credit));
      } else {
        byAccount.set(line.accountId, {
          accountId: line.accountId,
          code: line.account.code,
          name: line.account.name,
          type: line.account.type,
          section: (line.account.section ?? '') as StatementSection,
          debit: toNumber(line.debit),
          credit: toNumber(line.credit),
        });
      }
    }

    return [...byAccount.values()].sort((a, b) =>
      a.code.localeCompare(b.code, undefined, { numeric: true }),
    );
  }
}
