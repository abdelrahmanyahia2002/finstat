import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  assignNoteNumbers,
  difference,
  isStatementSection,
  isZero,
  SECTIONS_IN_ORDER,
  sum,
  type NoteDto,
  type NoteKind,
  type NoteLineDto,
  type StatementSection,
} from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PeriodService } from '../statements/period.service';
import { toNumber, toOptionalDecimal } from '../common/decimal';

export interface NoteLineInput {
  label: string;
  currentAmount?: number | null;
  priorAmount?: number | null;
  isSubtotal?: boolean;
  sortOrder?: number;
  accountId?: string | null;
}

export interface NoteInput {
  title: string;
  kind?: NoteKind;
  section?: StatementSection | null;
  body?: string | null;
  number?: number;
  sortOrder?: number;
  lines?: NoteLineInput[];
}

/** The disclosures nearly every set of statements opens with. */
const DEFAULT_POLICY_NOTES: Array<{ title: string; body: string }> = [
  {
    title: 'Basis of preparation',
    body: 'The financial statements have been prepared on the historical cost basis, and in accordance with the reporting framework stated above. They are presented in the functional currency of the company and rounded to the nearest unit.',
  },
  {
    title: 'Going concern',
    body: 'The financial statements have been prepared on the going concern basis. The directors have reviewed the position of the company and have no reason to believe it will not continue in operation for the foreseeable future.',
  },
  {
    title: 'Property, plant and equipment',
    body: 'Property, plant and equipment is carried at cost less accumulated depreciation and any accumulated impairment. Depreciation is charged on a straight line basis over the expected useful life of each asset.',
  },
  {
    title: 'Revenue recognition',
    body: 'Revenue is measured at the fair value of the consideration received or receivable, net of returns and trade discounts, and is recognised when control of the goods or services passes to the customer.',
  },
  {
    title: 'Financial instruments',
    body: 'Trade receivables are measured at amortised cost less any loss allowance. Trade payables are measured at amortised cost. Cash and cash equivalents comprise bank balances and short term deposits.',
  },
];

@Injectable()
export class NotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly periods: PeriodService,
  ) {}

  async list(financialYearId: string): Promise<NoteDto[]> {
    const ctx = await this.periods.loadContext(financialYearId);
    const notes = await this.prisma.note.findMany({
      where: { financialYearId },
      include: { lines: { orderBy: { sortOrder: 'asc' } } },
      orderBy: [{ sortOrder: 'asc' }, { number: 'asc' }],
    });

    return notes.map((note) => {
      const lines: NoteLineDto[] = note.lines.map((line) => ({
        id: line.id,
        label: line.label,
        currentAmount: line.currentAmount === null ? null : toNumber(line.currentAmount),
        priorAmount: line.priorAmount === null ? null : toNumber(line.priorAmount),
        isSubtotal: line.isSubtotal,
        sortOrder: line.sortOrder,
        accountId: line.accountId,
      }));

      const section = isStatementSection(note.section) ? note.section : null;
      const hasAmounts = lines.some((l) => l.currentAmount !== null);
      const total = hasAmounts
        ? sum(lines.filter((l) => !l.isSubtotal).map((l) => l.currentAmount ?? 0))
        : null;
      const priorTotal = hasAmounts
        ? sum(lines.filter((l) => !l.isSubtotal).map((l) => l.priorAmount ?? 0))
        : null;
      const statementAmount = section ? ctx.period.sections[section].amount : null;

      return {
        id: note.id,
        financialYearId: note.financialYearId,
        number: note.number,
        title: note.title,
        kind: note.kind,
        section,
        body: note.body,
        isSystemGenerated: note.isSystemGenerated,
        sortOrder: note.sortOrder,
        lines,
        total,
        priorTotal,
        statementAmount,
        ties:
          statementAmount === null || total === null
            ? true
            : isZero(difference(total, statementAmount)),
      };
    });
  }

  async create(companyId: string, financialYearId: string, userId: string, input: NoteInput) {
    const number = input.number ?? (await this.nextNumber(financialYearId));
    await this.assertNumberFree(financialYearId, number);

    const note = await this.prisma.note.create({
      data: {
        financialYearId,
        number,
        title: input.title.trim(),
        kind: input.kind ?? 'FREE_TEXT',
        section: input.section ?? null,
        body: input.body ?? null,
        sortOrder: input.sortOrder ?? number,
        lines: {
          create: (input.lines ?? []).map((line, index) => ({
            label: line.label,
            currentAmount: toOptionalDecimal(line.currentAmount),
            priorAmount: toOptionalDecimal(line.priorAmount),
            isSubtotal: line.isSubtotal ?? false,
            sortOrder: line.sortOrder ?? index,
            accountId: line.accountId ?? null,
          })),
        },
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'NOTE_CREATED',
      entity: 'Note',
      entityId: note.id,
      summary: `Added note ${note.number}: ${note.title}`,
    });

    return note;
  }

  async update(
    companyId: string,
    financialYearId: string,
    noteId: string,
    userId: string,
    input: Partial<NoteInput>,
  ) {
    const existing = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!existing || existing.financialYearId !== financialYearId) {
      throw new NotFoundException('That note was not found.');
    }

    if (input.number !== undefined && input.number !== existing.number) {
      await this.assertNumberFree(financialYearId, input.number);
    }

    const note = await this.prisma.$transaction(async (tx) => {
      // Lines are replaced wholesale: the editor sends the whole note back, so
      // diffing individual rows would only add a way for them to disagree.
      if (input.lines) {
        await tx.noteLine.deleteMany({ where: { noteId } });
        await tx.noteLine.createMany({
          data: input.lines.map((line, index) => ({
            noteId,
            label: line.label,
            currentAmount: toOptionalDecimal(line.currentAmount),
            priorAmount: toOptionalDecimal(line.priorAmount),
            isSubtotal: line.isSubtotal ?? false,
            sortOrder: line.sortOrder ?? index,
            accountId: line.accountId ?? null,
          })),
        });
      }

      return tx.note.update({
        where: { id: noteId },
        data: {
          ...(input.title !== undefined ? { title: input.title.trim() } : {}),
          ...(input.kind !== undefined ? { kind: input.kind } : {}),
          ...(input.section !== undefined ? { section: input.section } : {}),
          ...(input.body !== undefined ? { body: input.body } : {}),
          ...(input.number !== undefined ? { number: input.number } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          // Hand editing a generated note makes it the preparer's note.
          ...(input.lines || input.body !== undefined ? { isSystemGenerated: false } : {}),
        },
      });
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'NOTE_UPDATED',
      entity: 'Note',
      entityId: noteId,
      summary: `Updated note ${note.number}: ${note.title}`,
    });

    return note;
  }

  async remove(
    companyId: string,
    financialYearId: string,
    noteId: string,
    userId: string,
  ): Promise<void> {
    const note = await this.prisma.note.findUnique({ where: { id: noteId } });
    if (!note || note.financialYearId !== financialYearId) {
      throw new NotFoundException('That note was not found.');
    }

    await this.prisma.note.delete({ where: { id: noteId } });

    await this.audit.record({
      companyId,
      userId,
      action: 'NOTE_DELETED',
      entity: 'Note',
      entityId: noteId,
      summary: `Deleted note ${note.number}: ${note.title}`,
    });
  }

  /**
   * Build the supporting notes from the figures.
   *
   * Accounting policies come first and are text the preparer edits. After them
   * comes one note per statement line that carries a balance, broken down by
   * account with last year alongside. Notes a preparer has edited are left
   * alone, so regenerating after a figure changes never destroys written work.
   */
  async generate(
    companyId: string,
    financialYearId: string,
    userId: string,
    options: { includePolicies?: boolean } = {},
  ): Promise<{ created: number; updated: number; keptEdited: number }> {
    const ctx = await this.periods.loadContext(financialYearId);
    const existing = await this.prisma.note.findMany({
      where: { financialYearId },
      include: { lines: true },
    });

    const bySection = new Map(
      existing.filter((n) => n.section).map((n) => [n.section as string, n]),
    );
    const byTitle = new Map(existing.map((n) => [n.title.trim().toLowerCase(), n]));

    let created = 0;
    let updated = 0;
    let keptEdited = 0;

    await this.prisma.$transaction(async (tx) => {
      // Note numbers are unique per year, and generating renumbers the whole
      // set into statement order. Parking the existing numbers out of range
      // first means no intermediate step can collide with a number that is
      // about to be freed.
      const PARK = 100_000;
      for (const note of existing) {
        await tx.note.update({ where: { id: note.id }, data: { number: note.number + PARK } });
      }

      const placed = new Set<string>();
      let number = 1;

      if (options.includePolicies ?? true) {
        for (const policy of DEFAULT_POLICY_NOTES) {
          const match = byTitle.get(policy.title.toLowerCase());
          if (match) {
            await tx.note.update({
              where: { id: match.id },
              data: {
                number,
                sortOrder: number,
                // Text a preparer has rewritten stays exactly as they left it.
                ...(match.isSystemGenerated ? { body: policy.body } : {}),
              },
            });
            if (match.isSystemGenerated) updated += 1;
            else keptEdited += 1;
            placed.add(match.id);
          } else {
            await tx.note.create({
              data: {
                financialYearId,
                number,
                title: policy.title,
                kind: 'POLICY',
                body: policy.body,
                isSystemGenerated: true,
                sortOrder: number,
              },
            });
            created += 1;
          }
          number += 1;
        }
      }

      const numbering = assignNoteNumbers(ctx.period, number);

      for (const meta of SECTIONS_IN_ORDER) {
        const assigned = numbering.bySection[meta.section];
        if (assigned === undefined) continue;
        number = Math.max(number, assigned + 1);

        const aggregate = ctx.period.sections[meta.section];
        const priorAccounts = new Map(
          (ctx.prior?.sections[meta.section].accounts ?? []).map((a) => [a.code, a.amount]),
        );

        const lines = aggregate.accounts.map((account, index) => ({
          label: account.name,
          currentAmount: toOptionalDecimal(account.amount),
          priorAmount: ctx.prior ? toOptionalDecimal(priorAccounts.get(account.code) ?? 0) : null,
          isSubtotal: false,
          sortOrder: index,
          accountId: account.accountId,
        }));

        const match = bySection.get(meta.section);

        if (match) {
          if (match.isSystemGenerated) {
            await tx.noteLine.deleteMany({ where: { noteId: match.id } });
            await tx.noteLine.createMany({ data: lines.map((l) => ({ ...l, noteId: match.id })) });
            updated += 1;
          } else {
            keptEdited += 1;
          }
          // Numbering follows the statements even for a note that was edited.
          await tx.note.update({
            where: { id: match.id },
            data: {
              number: assigned,
              sortOrder: assigned,
              ...(match.isSystemGenerated ? { title: meta.label } : {}),
            },
          });
          placed.add(match.id);
        } else {
          await tx.note.create({
            data: {
              financialYearId,
              number: assigned,
              title: meta.label,
              kind: 'SECTION',
              section: meta.section,
              isSystemGenerated: true,
              sortOrder: assigned,
              lines: { create: lines },
            },
          });
          created += 1;
        }
      }

      // Anything the preparer added themselves keeps its place, after the
      // generated set, in the order it was already in.
      const leftover = existing
        .filter((n) => !placed.has(n.id))
        .sort((a, b) => a.number - b.number);
      for (const note of leftover) {
        await tx.note.update({
          where: { id: note.id },
          data: { number, sortOrder: number },
        });
        number += 1;
        keptEdited += 1;
      }
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'NOTES_GENERATED',
      entity: 'FinancialYear',
      entityId: financialYearId,
      summary: `Generated notes: ${created} added, ${updated} refreshed, ${keptEdited} left as edited`,
    });

    return { created, updated, keptEdited };
  }

  private async nextNumber(financialYearId: string): Promise<number> {
    const last = await this.prisma.note.findFirst({
      where: { financialYearId },
      orderBy: { number: 'desc' },
      select: { number: true },
    });
    return (last?.number ?? 0) + 1;
  }

  private async assertNumberFree(financialYearId: string, number: number): Promise<void> {
    const clash = await this.prisma.note.findUnique({
      where: { financialYearId_number: { financialYearId, number } },
      select: { title: true },
    });
    if (clash) {
      throw new BadRequestException(`Note ${number} is already used by "${clash.title}".`);
    }
  }
}
