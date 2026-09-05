import { Injectable } from '@nestjs/common';
import {
  assignNoteNumbers,
  buildBalanceSheet,
  buildCashFlowStatement,
  buildIncomeStatement,
  difference,
  isStatementSection,
  isZero,
  runValidations,
  sum,
  type NoteTieCheck,
  type StatementsResponse,
  type SubledgerTotals,
  type ValidationReport,
} from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { toNumber } from '../common/decimal';
import { PeriodService, type PeriodContext } from './period.service';

@Injectable()
export class StatementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly periods: PeriodService,
  ) {}

  async getStatements(financialYearId: string, detailed = false): Promise<StatementsResponse> {
    const ctx = await this.periods.loadContext(financialYearId);
    const notes = assignNoteNumbers(ctx.period);

    const common = {
      current: ctx.period,
      prior: ctx.prior,
      companyName: ctx.year.companyName,
      notes,
      detailed,
    };

    const cashFlow = ctx.prior
      ? buildCashFlowStatement({
          current: ctx.period,
          prior: ctx.prior,
          companyName: ctx.year.companyName,
        })
      : null;

    return {
      company: {
        id: ctx.year.companyId,
        name: ctx.year.companyName,
        currencyCode: ctx.year.currencyCode,
      },
      current: ctx.period,
      prior: ctx.prior,
      balanceSheet: buildBalanceSheet(common),
      incomeStatement: buildIncomeStatement(common),
      cashFlow,
      validation: await this.validate(ctx),
      noteNumbers: notes.bySection,
    };
  }

  async getValidation(financialYearId: string): Promise<ValidationReport> {
    const ctx = await this.periods.loadContext(financialYearId);
    return this.validate(ctx);
  }

  /** Gathers everything the shared validation rules need, then runs them. */
  async validate(ctx: PeriodContext): Promise<ValidationReport> {
    const [subledger, notes] = await Promise.all([
      this.subledgerTotals(ctx.year.id),
      this.noteTieChecks(ctx),
    ]);

    return runValidations({
      current: ctx.period,
      prior: ctx.prior,
      accounts: ctx.accounts,
      subledger,
      notes,
      currency: ctx.year.currencyCode,
    });
  }

  private async subledgerTotals(financialYearId: string): Promise<SubledgerTotals> {
    const balances = await this.prisma.partyBalance.findMany({
      where: { financialYearId },
      include: { party: { select: { id: true, name: true, type: true } } },
    });

    let debtors = 0;
    let creditors = 0;
    const ageingMismatches: SubledgerTotals['ageingMismatches'] = [];

    for (const balance of balances) {
      const stated = toNumber(balance.total);
      const bucketed = sum([
        toNumber(balance.current),
        toNumber(balance.days30),
        toNumber(balance.days60),
        toNumber(balance.days90),
        toNumber(balance.days120Plus),
      ]);

      if (balance.party.type === 'DEBTOR') debtors = sum([debtors, stated]);
      else creditors = sum([creditors, stated]);

      if (!isZero(difference(stated, bucketed))) {
        ageingMismatches.push({
          partyId: balance.party.id,
          partyName: balance.party.name,
          type: balance.party.type,
          stated,
          bucketed,
        });
      }
    }

    return { debtors, creditors, ageingMismatches };
  }

  private async noteTieChecks(ctx: PeriodContext): Promise<NoteTieCheck[]> {
    const notes = await this.prisma.note.findMany({
      where: { financialYearId: ctx.year.id },
      include: { lines: true },
      orderBy: { number: 'asc' },
    });

    const checks: NoteTieCheck[] = [];
    for (const note of notes) {
      if (!isStatementSection(note.section)) continue;

      // Subtotal lines restate figures already in the note, so they are not
      // added again.
      const noteTotal = sum(
        note.lines.filter((l) => !l.isSubtotal).map((l) => toNumber(l.currentAmount)),
      );

      checks.push({
        noteId: note.id,
        noteNumber: note.number,
        title: note.title,
        section: note.section,
        noteTotal,
        statementAmount: ctx.period.sections[note.section].amount,
      });
    }

    return checks;
  }
}
