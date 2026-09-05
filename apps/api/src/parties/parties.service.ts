import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  round2,
  splitClipboard,
  sum,
  tryParseAmount,
  type AgeingBucket,
  type PartyBalanceDto,
  type PartyType,
  type SubledgerResponse,
} from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PeriodService } from '../statements/period.service';
import { toDecimal, toNumber } from '../common/decimal';

export interface PartyInput {
  code: string;
  name: string;
  contactName?: string | null;
  email?: string | null;
  phone?: string | null;
  vatNumber?: string | null;
  creditLimit?: number | null;
  isActive?: boolean;
}

export interface BalanceInput {
  partyId: string;
  current?: number;
  days30?: number;
  days60?: number;
  days90?: number;
  days120Plus?: number;
  /** When left out, the ageing buckets are added up to give the total. */
  total?: number;
  notes?: string | null;
}

const CONTROL_SECTION: Record<PartyType, 'TRADE_RECEIVABLES' | 'TRADE_PAYABLES'> = {
  DEBTOR: 'TRADE_RECEIVABLES',
  CREDITOR: 'TRADE_PAYABLES',
};

@Injectable()
export class PartiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly periods: PeriodService,
  ) {}

  async getSubledger(
    companyId: string,
    financialYearId: string,
    type: PartyType,
  ): Promise<SubledgerResponse> {
    const year = await this.prisma.financialYear.findUnique({
      where: { id: financialYearId },
      select: { id: true, previousYearId: true },
    });
    if (!year) throw new NotFoundException('That financial year was not found.');

    const [parties, balances, priorBalances, { period }] = await Promise.all([
      this.prisma.party.findMany({
        where: { companyId, type, isActive: true },
        orderBy: { code: 'asc' },
      }),
      this.prisma.partyBalance.findMany({ where: { financialYearId } }),
      year.previousYearId
        ? this.prisma.partyBalance.findMany({ where: { financialYearId: year.previousYearId } })
        : Promise.resolve([]),
      this.periods.loadPeriod(financialYearId),
    ]);

    const byParty = new Map(balances.map((b) => [b.partyId, b]));
    const priorByParty = new Map(priorBalances.map((b) => [b.partyId, b]));

    const rows: PartyBalanceDto[] = parties.map((party) => {
      const balance = byParty.get(party.id);
      const prior = priorByParty.get(party.id);
      return {
        id: balance?.id ?? '',
        partyId: party.id,
        code: party.code,
        name: party.name,
        type: party.type,
        current: toNumber(balance?.current),
        days30: toNumber(balance?.days30),
        days60: toNumber(balance?.days60),
        days90: toNumber(balance?.days90),
        days120Plus: toNumber(balance?.days120Plus),
        total: toNumber(balance?.total),
        priorTotal: toNumber(prior?.total),
        notes: balance?.notes ?? null,
      };
    });

    const totals = {
      current: sum(rows.map((r) => r.current)),
      days30: sum(rows.map((r) => r.days30)),
      days60: sum(rows.map((r) => r.days60)),
      days90: sum(rows.map((r) => r.days90)),
      days120Plus: sum(rows.map((r) => r.days120Plus)),
      total: sum(rows.map((r) => r.total)),
    } satisfies Record<AgeingBucket | 'total', number>;

    const controlAccountTotal = period.sections[CONTROL_SECTION[type]].amount;
    const difference = round2(controlAccountTotal - totals.total);

    return {
      type,
      rows,
      totals,
      controlAccountTotal,
      difference,
      agrees: difference === 0,
    };
  }

  async createParty(companyId: string, userId: string, type: PartyType, input: PartyInput) {
    const code = input.code.trim();
    const clash = await this.prisma.party.findUnique({
      where: { companyId_type_code: { companyId, type, code } },
    });
    if (clash) {
      throw new ConflictException(`${type === 'DEBTOR' ? 'Debtor' : 'Creditor'} ${code} already exists.`);
    }

    const party = await this.prisma.party.create({
      data: {
        companyId,
        type,
        code,
        name: input.name.trim(),
        contactName: input.contactName ?? null,
        email: input.email ?? null,
        phone: input.phone ?? null,
        vatNumber: input.vatNumber ?? null,
        creditLimit: input.creditLimit != null ? toDecimal(input.creditLimit) : null,
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'PARTY_CREATED',
      entity: 'Party',
      entityId: party.id,
      summary: `Added ${type.toLowerCase()} ${party.code} ${party.name}`,
    });

    return party;
  }

  async updateParty(companyId: string, partyId: string, userId: string, input: Partial<PartyInput>) {
    const existing = await this.prisma.party.findUnique({ where: { id: partyId } });
    if (!existing || existing.companyId !== companyId) {
      throw new NotFoundException('That account was not found.');
    }

    const party = await this.prisma.party.update({
      where: { id: partyId },
      data: {
        ...(input.code !== undefined ? { code: input.code.trim() } : {}),
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.contactName !== undefined ? { contactName: input.contactName } : {}),
        ...(input.email !== undefined ? { email: input.email } : {}),
        ...(input.phone !== undefined ? { phone: input.phone } : {}),
        ...(input.vatNumber !== undefined ? { vatNumber: input.vatNumber } : {}),
        ...(input.creditLimit !== undefined
          ? { creditLimit: input.creditLimit != null ? toDecimal(input.creditLimit) : null }
          : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'PARTY_UPDATED',
      entity: 'Party',
      entityId: partyId,
      summary: `Updated ${party.type.toLowerCase()} ${party.code} ${party.name}`,
    });

    return party;
  }

  async removeParty(companyId: string, partyId: string, userId: string) {
    const party = await this.prisma.party.findUnique({
      where: { id: partyId },
      include: { _count: { select: { balances: true } } },
    });
    if (!party || party.companyId !== companyId) {
      throw new NotFoundException('That account was not found.');
    }

    // Balances captured in a prior year are part of that year's record.
    const inUse = party._count.balances > 0;
    if (inUse) {
      await this.prisma.party.update({ where: { id: partyId }, data: { isActive: false } });
    } else {
      await this.prisma.party.delete({ where: { id: partyId } });
    }

    await this.audit.record({
      companyId,
      userId,
      action: inUse ? 'PARTY_DEACTIVATED' : 'PARTY_DELETED',
      entity: 'Party',
      entityId: partyId,
      summary: `${inUse ? 'Deactivated' : 'Deleted'} ${party.type.toLowerCase()} ${party.code}`,
    });

    return { deactivated: inUse };
  }

  /**
   * Save a block of listing figures.
   *
   * A stated total that differs from the ageing buckets is stored as given
   * rather than corrected, because the difference is exactly what the
   * validation run is there to report.
   */
  async saveBalances(
    companyId: string,
    financialYearId: string,
    type: PartyType,
    userId: string,
    balances: BalanceInput[],
  ): Promise<SubledgerResponse> {
    const partyIds = [...new Set(balances.map((b) => b.partyId))];
    const parties = await this.prisma.party.findMany({
      where: { id: { in: partyIds }, companyId, type },
      select: { id: true },
    });
    if (parties.length !== partyIds.length) {
      throw new BadRequestException('One of those accounts does not belong to this company.');
    }

    await this.prisma.$transaction(async (tx) => {
      for (const balance of balances) {
        const buckets = {
          current: round2(balance.current ?? 0),
          days30: round2(balance.days30 ?? 0),
          days60: round2(balance.days60 ?? 0),
          days90: round2(balance.days90 ?? 0),
          days120Plus: round2(balance.days120Plus ?? 0),
        };
        const total =
          balance.total !== undefined ? round2(balance.total) : sum(Object.values(buckets));

        const isEmpty = total === 0 && Object.values(buckets).every((v) => v === 0);
        if (isEmpty) {
          await tx.partyBalance.deleteMany({ where: { financialYearId, partyId: balance.partyId } });
          continue;
        }

        await tx.partyBalance.upsert({
          where: { financialYearId_partyId: { financialYearId, partyId: balance.partyId } },
          create: {
            financialYearId,
            partyId: balance.partyId,
            current: toDecimal(buckets.current),
            days30: toDecimal(buckets.days30),
            days60: toDecimal(buckets.days60),
            days90: toDecimal(buckets.days90),
            days120Plus: toDecimal(buckets.days120Plus),
            total: toDecimal(total),
            notes: balance.notes ?? null,
          },
          update: {
            current: toDecimal(buckets.current),
            days30: toDecimal(buckets.days30),
            days60: toDecimal(buckets.days60),
            days90: toDecimal(buckets.days90),
            days120Plus: toDecimal(buckets.days120Plus),
            total: toDecimal(total),
            ...(balance.notes !== undefined ? { notes: balance.notes } : {}),
          },
        });
      }
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'SUBLEDGER_SAVED',
      entity: 'FinancialYear',
      entityId: financialYearId,
      summary: `Saved ${balances.length} ${type.toLowerCase()} ${balances.length === 1 ? 'balance' : 'balances'}`,
    });

    return this.getSubledger(companyId, financialYearId, type);
  }

  /**
   * Paste a listing straight out of a spreadsheet.
   *
   * The expected shape is code, name, then the ageing columns in order. Missing
   * accounts are created, because a debtors listing is where new customers
   * normally arrive from.
   */
  async pasteListing(
    companyId: string,
    financialYearId: string,
    type: PartyType,
    userId: string,
    text: string,
  ): Promise<SubledgerResponse> {
    const grid = splitClipboard(text);
    if (grid.length === 0) {
      throw new BadRequestException('There was nothing to paste.');
    }

    // Drop a heading row if there is one.
    const headerLike = grid[0].every((cell) => tryParseAmount(cell) === null);
    const rows = headerLike ? grid.slice(1) : grid;

    const existing = await this.prisma.party.findMany({
      where: { companyId, type },
      select: { id: true, code: true, name: true },
    });
    const byCode = new Map(existing.map((p) => [p.code.trim().toUpperCase(), p.id]));
    const byName = new Map(existing.map((p) => [p.name.trim().toUpperCase(), p.id]));

    const balances: BalanceInput[] = [];
    const problems: string[] = [];

    await this.prisma.$transaction(async (tx) => {
      for (const [index, row] of rows.entries()) {
        if (row.every((c) => c.trim() === '')) continue;

        const code = (row[0] ?? '').trim();
        const name = (row[1] ?? '').trim();
        if (!code && !name) continue;

        let partyId =
          byCode.get(code.toUpperCase()) ?? (name ? byName.get(name.toUpperCase()) : undefined);

        if (!partyId) {
          const created = await tx.party.create({
            data: { companyId, type, code: code || name, name: name || code },
          });
          partyId = created.id;
          byCode.set(created.code.toUpperCase(), created.id);
        }

        const amounts = row.slice(2, 8).map((cell) => tryParseAmount(cell));
        if (amounts.every((a) => a === null)) {
          problems.push(`Row ${index + 1} (${code || name}) had no amounts.`);
          continue;
        }

        // Five ageing buckets, then an optional stated total.
        const [current, days30, days60, days90, days120Plus, statedTotal] = amounts;
        balances.push({
          partyId,
          current: current ?? 0,
          days30: days30 ?? 0,
          days60: days60 ?? 0,
          days90: days90 ?? 0,
          days120Plus: days120Plus ?? 0,
          ...(statedTotal !== null && statedTotal !== undefined ? { total: statedTotal } : {}),
        });
      }
    });

    if (balances.length === 0) {
      throw new BadRequestException(
        problems[0] ?? 'None of those rows had an account and an amount.',
      );
    }

    return this.saveBalances(companyId, financialYearId, type, userId, balances);
  }
}
