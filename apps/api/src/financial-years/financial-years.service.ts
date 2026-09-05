import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isStatementSection,
  isYearEditable,
  SECTION_META,
  round2,
  type FinancialYearStatus,
  type FinancialYearSummary,
} from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PeriodService } from '../statements/period.service';
import { StatementsService } from '../statements/statements.service';
import { toDecimal, toNumber } from '../common/decimal';

export interface CreateYearInput {
  label: string;
  startDate: string;
  endDate: string;
  previousYearId?: string | null;
  makeCurrent?: boolean;
}

export interface CarryForwardInput {
  label: string;
  startDate: string;
  endDate: string;
  /** Close the year being carried forward, so its figures stop moving. */
  closeSourceYear?: boolean;
  /** Bring accounting policy and free text notes across. */
  copyNotes?: boolean;
  /** Bring the debtors and creditors listings across as opening balances. */
  copySubledgers?: boolean;
}

function parseDate(value: string, field: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new BadRequestException(`${field} is not a valid date.`);
  }
  return date;
}

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

@Injectable()
export class FinancialYearsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly periods: PeriodService,
    private readonly statements: StatementsService,
  ) {}

  async list(companyId: string): Promise<FinancialYearSummary[]> {
    const years = await this.prisma.financialYear.findMany({
      where: { companyId },
      orderBy: { startDate: 'desc' },
      include: {
        previousYear: { select: { id: true, label: true } },
        _count: { select: { balances: true } },
      },
    });

    // Balance is cheap to state and is the first thing a preparer looks for.
    const summaries: FinancialYearSummary[] = [];
    for (const year of years) {
      const totals = await this.prisma.trialBalanceEntry.aggregate({
        where: { financialYearId: year.id },
        _sum: { debit: true, credit: true },
      });
      const debit = toNumber(totals._sum.debit);
      const credit = toNumber(totals._sum.credit);

      summaries.push({
        id: year.id,
        companyId: year.companyId,
        label: year.label,
        startDate: isoDate(year.startDate),
        endDate: isoDate(year.endDate),
        status: year.status,
        isCurrent: year.isCurrent,
        previousYearId: year.previousYearId,
        previousYearLabel: year.previousYear?.label ?? null,
        accountCount: year._count.balances,
        isBalanced: round2(debit - credit) === 0,
      });
    }

    return summaries;
  }

  async get(yearId: string) {
    const year = await this.prisma.financialYear.findUnique({
      where: { id: yearId },
      include: { previousYear: { select: { id: true, label: true } } },
    });
    if (!year) throw new NotFoundException('That financial year was not found.');
    return year;
  }

  async create(companyId: string, userId: string, input: CreateYearInput) {
    const startDate = parseDate(input.startDate, 'The start date');
    const endDate = parseDate(input.endDate, 'The end date');
    if (endDate <= startDate) {
      throw new BadRequestException('The year has to end after it starts.');
    }

    const label = input.label.trim();
    const clash = await this.prisma.financialYear.findUnique({
      where: { companyId_label: { companyId, label } },
    });
    if (clash) {
      throw new ConflictException(`This company already has a year called ${label}.`);
    }

    if (input.previousYearId) {
      await this.assertLinkable(companyId, input.previousYearId);
    }

    const year = await this.prisma.$transaction(async (tx) => {
      if (input.makeCurrent) {
        await tx.financialYear.updateMany({ where: { companyId }, data: { isCurrent: false } });
      }
      return tx.financialYear.create({
        data: {
          companyId,
          label,
          startDate,
          endDate,
          previousYearId: input.previousYearId ?? null,
          isCurrent: input.makeCurrent ?? false,
          status: 'DRAFT',
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'YEAR_CREATED',
      entity: 'FinancialYear',
      entityId: year.id,
      summary: `Created ${year.label}`,
    });

    return year;
  }

  async update(
    companyId: string,
    yearId: string,
    userId: string,
    input: Partial<CreateYearInput> & { notesIntro?: string },
  ) {
    const year = await this.get(yearId);
    if (year.companyId !== companyId) {
      throw new NotFoundException('That financial year was not found.');
    }

    if (input.previousYearId) {
      await this.assertLinkable(companyId, input.previousYearId, yearId);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      if (input.makeCurrent) {
        await tx.financialYear.updateMany({ where: { companyId }, data: { isCurrent: false } });
      }
      return tx.financialYear.update({
        where: { id: yearId },
        data: {
          ...(input.label !== undefined ? { label: input.label.trim() } : {}),
          ...(input.startDate !== undefined
            ? { startDate: parseDate(input.startDate, 'The start date') }
            : {}),
          ...(input.endDate !== undefined
            ? { endDate: parseDate(input.endDate, 'The end date') }
            : {}),
          ...(input.previousYearId !== undefined ? { previousYearId: input.previousYearId } : {}),
          ...(input.makeCurrent !== undefined ? { isCurrent: input.makeCurrent } : {}),
          ...(input.notesIntro !== undefined ? { notesIntro: input.notesIntro || null } : {}),
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'YEAR_UPDATED',
      entity: 'FinancialYear',
      entityId: yearId,
      summary: `Updated ${updated.label}`,
    });

    return updated;
  }

  /**
   * Move a year through its lifecycle.
   *
   * Locking is the point at which figures stop moving, so it is also the point
   * where the validation run has to be clean. Refusing here is much cheaper
   * than discovering a broken statement after it has been signed.
   */
  async setStatus(companyId: string, yearId: string, userId: string, status: FinancialYearStatus) {
    const year = await this.get(yearId);
    if (year.companyId !== companyId) {
      throw new NotFoundException('That financial year was not found.');
    }

    if ((status === 'LOCKED' || status === 'CLOSED') && isYearEditable(year.status)) {
      const report = await this.statements.getValidation(yearId);
      if (!report.passed) {
        const first = report.issues.find((i) => i.severity === 'ERROR');
        throw new BadRequestException(
          `${year.label} still has ${report.errorCount} validation ${
            report.errorCount === 1 ? 'error' : 'errors'
          }. First one: ${first?.title}.`,
        );
      }
    }

    const updated = await this.prisma.financialYear.update({
      where: { id: yearId },
      data: {
        status,
        closedAt: status === 'CLOSED' ? new Date() : null,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'YEAR_STATUS_CHANGED',
      entity: 'FinancialYear',
      entityId: yearId,
      summary: `${year.label} moved from ${year.status.toLowerCase()} to ${status.toLowerCase()}`,
      before: { status: year.status },
      after: { status },
    });

    return updated;
  }

  async remove(companyId: string, yearId: string, userId: string): Promise<void> {
    const year = await this.get(yearId);
    if (year.companyId !== companyId) {
      throw new NotFoundException('That financial year was not found.');
    }
    if (year.status === 'CLOSED') {
      throw new BadRequestException('A closed year cannot be deleted. Reopen it first.');
    }

    const next = await this.prisma.financialYear.findFirst({
      where: { previousYearId: yearId },
      select: { label: true },
    });
    if (next) {
      throw new BadRequestException(
        `${next.label} uses ${year.label} for its comparatives. Unlink it first.`,
      );
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.financialYear.delete({ where: { id: yearId } });

      // Deleting the year everything was pointing at would otherwise leave the
      // company with no current year, and nothing for the app to open on.
      if (year.isCurrent) {
        const latest = await tx.financialYear.findFirst({
          where: { companyId },
          orderBy: { startDate: 'desc' },
          select: { id: true },
        });
        if (latest) {
          await tx.financialYear.update({
            where: { id: latest.id },
            data: { isCurrent: true },
          });
        }
      }
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'YEAR_DELETED',
      entity: 'FinancialYear',
      entityId: yearId,
      summary: `Deleted ${year.label}`,
    });
  }

  /**
   * Open the next financial year from this one.
   *
   * Balance sheet accounts open where they closed. Profit and loss accounts
   * start empty. The year's profit and any dividends declared are rolled into
   * retained earnings, which is exactly what makes the new year's comparatives
   * and its cash flow statement tie.
   */
  async carryForward(
    companyId: string,
    sourceYearId: string,
    userId: string,
    input: CarryForwardInput,
  ) {
    const { year: sourceYear, period } = await this.periods.loadPeriod(sourceYearId);
    if (sourceYear.companyId !== companyId) {
      throw new NotFoundException('That financial year was not found.');
    }

    if (!period.isTrialBalanceBalanced) {
      throw new BadRequestException(
        `${sourceYear.label} does not balance yet, so it cannot be carried forward. It is out by ${period.trialBalanceDifference}.`,
      );
    }

    // Opening balances are built from the statement sections, so an account
    // with a balance and no reporting category would be dropped without
    // trace. Refuse rather than quietly lose it.
    const unmapped = await this.prisma.trialBalanceEntry.findMany({
      where: { financialYearId: sourceYearId, account: { isActive: true } },
      select: { account: { select: { code: true, name: true, section: true } } },
    });
    const unmappedCodes = unmapped
      .filter((e) => !isStatementSection(e.account.section))
      .map((e) => `${e.account.code} ${e.account.name}`);
    if (unmappedCodes.length > 0) {
      throw new BadRequestException(
        `These accounts have no reporting category, so they cannot be carried forward: ${unmappedCodes
          .slice(0, 5)
          .join(', ')}${unmappedCodes.length > 5 ? ` and ${unmappedCodes.length - 5} more` : ''}.`,
      );
    }

    const label = input.label.trim();
    const clash = await this.prisma.financialYear.findUnique({
      where: { companyId_label: { companyId, label } },
    });
    if (clash) {
      throw new ConflictException(`This company already has a year called ${label}.`);
    }

    const alreadyChained = await this.prisma.financialYear.findFirst({
      where: { previousYearId: sourceYearId },
      select: { label: true },
    });
    if (alreadyChained) {
      throw new ConflictException(
        `${sourceYear.label} has already been carried forward into ${alreadyChained.label}.`,
      );
    }

    const openingEntries = this.buildOpeningBalances(period);

    const created = await this.prisma.$transaction(async (tx) => {
      await tx.financialYear.updateMany({ where: { companyId }, data: { isCurrent: false } });

      const newYear = await tx.financialYear.create({
        data: {
          companyId,
          label,
          startDate: parseDate(input.startDate, 'The start date'),
          endDate: parseDate(input.endDate, 'The end date'),
          previousYearId: sourceYearId,
          isCurrent: true,
          status: 'OPEN',
        },
      });

      if (openingEntries.length > 0) {
        await tx.trialBalanceEntry.createMany({
          data: openingEntries.map((entry) => ({
            financialYearId: newYear.id,
            accountId: entry.accountId,
            debit: toDecimal(entry.debit),
            credit: toDecimal(entry.credit),
            source: 'CARRY_FORWARD' as const,
          })),
        });
      }

      // The opening trade receivables and payables in the new year are last
      // year's closing balances, so the listings that support them have to
      // travel with them. Without this the new year opens with a control
      // account and an empty listing, which reads as a reconciliation error
      // that nobody caused.
      if (input.copySubledgers ?? true) {
        const balances = await tx.partyBalance.findMany({
          where: { financialYearId: sourceYearId },
        });
        if (balances.length > 0) {
          await tx.partyBalance.createMany({
            data: balances.map((balance) => ({
              financialYearId: newYear.id,
              partyId: balance.partyId,
              current: balance.current,
              days30: balance.days30,
              days60: balance.days60,
              days90: balance.days90,
              days120Plus: balance.days120Plus,
              total: balance.total,
            })),
          });
        }
      }

      if (input.copyNotes ?? true) {
        const notes = await tx.note.findMany({
          where: { financialYearId: sourceYearId, kind: { in: ['POLICY', 'FREE_TEXT'] } },
          orderBy: { number: 'asc' },
        });
        for (const note of notes) {
          await tx.note.create({
            data: {
              financialYearId: newYear.id,
              number: note.number,
              title: note.title,
              kind: note.kind,
              section: note.section,
              body: note.body,
              isSystemGenerated: false,
              sortOrder: note.sortOrder,
            },
          });
        }
      }

      if (input.closeSourceYear) {
        await tx.financialYear.update({
          where: { id: sourceYearId },
          data: { status: 'CLOSED', closedAt: new Date() },
        });
      }

      return newYear;
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'YEAR_CARRIED_FORWARD',
      entity: 'FinancialYear',
      entityId: created.id,
      summary: `Carried ${sourceYear.label} forward into ${created.label} with ${openingEntries.length} opening balances`,
    });

    return { year: created, openingBalanceCount: openingEntries.length };
  }

  /**
   * Turn a closed year into next year's opening trial balance.
   *
   * Working in debit-positive signed amounts keeps the arithmetic in one form.
   * The profit for the year is a credit to retained earnings, so it subtracts;
   * dividends declared were a debit sitting in their own account, so rolling
   * them in adds back.
   */
  private buildOpeningBalances(
    period: Awaited<ReturnType<PeriodService['loadPeriod']>>['period'],
  ): Array<{ accountId: string; debit: number; credit: number }> {
    const entries: Array<{ accountId: string; debit: number; credit: number }> = [];
    const retainedEarningsAccounts: Array<{ accountId: string; signed: number }> = [];
    let dividendsSigned = 0;

    for (const aggregate of Object.values(period.sections)) {
      const meta = SECTION_META[aggregate.section];
      if (!meta || meta.statement !== 'BALANCE_SHEET') continue;

      for (const account of aggregate.accounts) {
        // The stored amount is presentation-signed; convert back to debit-positive.
        const signed = meta.presentAs === 'DEBIT' ? account.amount : round2(-account.amount);

        if (aggregate.section === 'DIVIDENDS_DECLARED') {
          // Closed into retained earnings; the account itself opens at nil.
          dividendsSigned = round2(dividendsSigned + signed);
          continue;
        }

        if (aggregate.section === 'RETAINED_EARNINGS') {
          retainedEarningsAccounts.push({ accountId: account.accountId, signed });
          continue;
        }

        if (signed === 0) continue;
        entries.push(toEntry(account.accountId, signed));
      }
    }

    if (retainedEarningsAccounts.length > 0) {
      // Everything rolls into the first retained earnings account; any others
      // simply open where they closed.
      const [primary, ...rest] = retainedEarningsAccounts.sort((a, b) =>
        a.accountId.localeCompare(b.accountId),
      );
      const primarySigned = round2(primary.signed - period.income.profitForYear + dividendsSigned);
      entries.push(toEntry(primary.accountId, primarySigned));
      for (const account of rest) {
        if (account.signed !== 0) entries.push(toEntry(account.accountId, account.signed));
      }
    }

    return entries;
  }

  private async assertLinkable(
    companyId: string,
    previousYearId: string,
    excludeYearId?: string,
  ): Promise<void> {
    const previous = await this.prisma.financialYear.findUnique({
      where: { id: previousYearId },
      select: { id: true, companyId: true, label: true },
    });
    if (!previous || previous.companyId !== companyId) {
      throw new BadRequestException('That comparative year belongs to a different company.');
    }
    if (previous.id === excludeYearId) {
      throw new BadRequestException('A year cannot be its own comparative.');
    }

    const taken = await this.prisma.financialYear.findFirst({
      where: { previousYearId, ...(excludeYearId ? { id: { not: excludeYearId } } : {}) },
      select: { label: true },
    });
    if (taken) {
      throw new ConflictException(
        `${previous.label} is already the comparative for ${taken.label}.`,
      );
    }
  }
}

function toEntry(accountId: string, signed: number): { accountId: string; debit: number; credit: number } {
  return signed >= 0
    ? { accountId, debit: signed, credit: 0 }
    : { accountId, debit: 0, credit: round2(-signed) };
}
