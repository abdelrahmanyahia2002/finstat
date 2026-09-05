/**
 * Seed the database.
 *
 * Creates the first administrator and a demo company carrying two complete
 * financial years, so a fresh install opens onto working statements instead of
 * an empty screen. The figures are the same ones the engine tests use, which
 * means the seeded company balances, its cash flow reconciles, and every
 * validation check passes.
 */

import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';

// The Prisma CLI loads .env by itself; running this file directly does not, so
// look in the api folder first and then at the workspace root.
loadEnv({ path: resolve(__dirname, '../.env') });
loadEnv({ path: resolve(__dirname, '../../../.env') });

import { PrismaClient, type Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { STANDARD_CHART } from '../src/accounts/chart-template';

const prisma = new PrismaClient();

type Balance = [code: string, debit: number, credit: number];

const FY2024_BALANCES: Balance[] = [
  ['1010', 500_000, 0], // Plant and machinery
  ['1300', 120_000, 0], // Inventory
  ['1400', 180_000, 0], // Trade receivables control
  ['1500', 90_000, 0], // Bank
  ['2000', 0, 100_000], // Share capital
  ['2100', 0, 336_000], // Retained earnings
  ['2500', 0, 200_000], // Long term borrowings
  ['2700', 0, 150_000], // Trade payables control
  ['2790', 0, 20_000], // Current tax payable
  ['3000', 0, 900_000], // Sales
  ['4010', 540_000, 0], // Purchases
  ['5100', 180_000, 0], // Salaries and wages
  ['5300', 50_000, 0], // Depreciation
  ['6000', 18_000, 0], // Interest paid
  ['7000', 28_000, 0], // Income tax expense
];

const FY2025_BALANCES: Balance[] = [
  ['1010', 520_000, 0],
  ['1300', 140_000, 0],
  ['1400', 210_000, 0],
  ['1500', 140_000, 0],
  ['2150', 40_000, 0], // Dividends declared
  ['2000', 0, 150_000],
  ['2100', 0, 420_000], // Opening retained earnings: last year closed here
  ['2500', 0, 170_000],
  ['2700', 0, 165_000],
  ['2790', 0, 25_000],
  ['3000', 0, 1_050_000],
  ['4010', 620_000, 0],
  ['5100', 200_000, 0],
  ['5300', 60_000, 0],
  ['6000', 15_000, 0],
  ['7000', 35_000, 0],
];

interface AgeingRow {
  code: string;
  name: string;
  contact?: string;
  buckets2024: [number, number, number, number, number];
  buckets2025: [number, number, number, number, number];
}

// Ageing buckets: current, 30, 60, 90, 120+. Each set adds up to the control
// account, which is what makes the debtors and creditors checks pass.
const DEBTORS: AgeingRow[] = [
  {
    code: 'D001',
    name: 'Harbour Foods Ltd',
    contact: 'Ade Okafor',
    buckets2024: [55_000, 10_000, 0, 0, 0],
    buckets2025: [60_000, 15_000, 0, 0, 0],
  },
  {
    code: 'D002',
    name: 'Riverside Cafes',
    contact: 'Marie Dupont',
    buckets2024: [36_000, 6_000, 0, 0, 0],
    buckets2025: [40_000, 8_000, 2_000, 0, 0],
  },
  {
    code: 'D003',
    name: 'Grand Hotel Group',
    contact: 'Sam Whitfield',
    buckets2024: [26_000, 0, 4_000, 0, 0],
    buckets2025: [30_000, 0, 5_000, 0, 0],
  },
  {
    code: 'D004',
    name: 'Metro Retail Partners',
    contact: 'Priya Nair',
    buckets2024: [20_000, 0, 0, 5_000, 0],
    buckets2025: [20_000, 0, 0, 6_000, 0],
  },
  {
    code: 'D005',
    name: 'Coastal Supplies',
    contact: 'Jonas Berg',
    buckets2024: [8_000, 0, 0, 0, 10_000],
    buckets2025: [12_000, 0, 0, 0, 12_000],
  },
];

const CREDITORS: AgeingRow[] = [
  {
    code: 'C001',
    name: 'Atlantic Wholesale',
    contact: 'Lena Fischer',
    buckets2024: [50_000, 12_000, 0, 0, 0],
    buckets2025: [58_000, 12_000, 0, 0, 0],
  },
  {
    code: 'C002',
    name: 'Baltic Packaging',
    contact: 'Tomas Vidal',
    buckets2024: [34_000, 6_000, 0, 0, 0],
    buckets2025: [38_000, 7_000, 0, 0, 0],
  },
  {
    code: 'C003',
    name: 'Northern Logistics',
    contact: 'Chen Wei',
    buckets2024: [24_000, 4_000, 0, 0, 0],
    buckets2025: [26_000, 4_000, 0, 0, 0],
  },
  {
    code: 'C004',
    name: 'City Utilities',
    buckets2024: [20_000, 0, 0, 0, 0],
    buckets2025: [20_000, 0, 0, 0, 0],
  },
];

const POLICY_NOTES = [
  {
    number: 1,
    title: 'Basis of preparation',
    body: 'The financial statements have been prepared on the historical cost basis, and in accordance with the reporting framework stated above. They are presented in the functional currency of the company and rounded to the nearest unit.',
  },
  {
    number: 2,
    title: 'Going concern',
    body: 'The financial statements have been prepared on the going concern basis. The directors have reviewed the position of the company and have no reason to believe it will not continue in operation for the foreseeable future.',
  },
  {
    number: 3,
    title: 'Property, plant and equipment',
    body: 'Property, plant and equipment is carried at cost less accumulated depreciation and any accumulated impairment. Depreciation is charged on a straight line basis over the expected useful life of each asset.',
  },
  {
    number: 4,
    title: 'Revenue recognition',
    body: 'Revenue is measured at the fair value of the consideration received or receivable, net of returns and trade discounts, and is recognised when control of the goods or services passes to the customer.',
  },
];

function money(value: number): Prisma.Decimal.Value {
  return value.toFixed(2);
}

function total(buckets: [number, number, number, number, number]): number {
  return buckets.reduce((sum, value) => sum + value, 0);
}

async function main(): Promise<void> {
  const adminEmail = (process.env.SEED_ADMIN_EMAIL ?? 'admin@finstat.local').toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD ?? 'Admin123!';

  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    update: {},
    create: {
      email: adminEmail,
      name: 'Platform administrator',
      passwordHash: await bcrypt.hash(adminPassword, 12),
      globalRole: 'SUPERADMIN',
    },
  });
  console.log(`Administrator ready: ${admin.email}`);

  const preparer = await prisma.user.upsert({
    where: { email: 'preparer@finstat.local' },
    update: {},
    create: {
      email: 'preparer@finstat.local',
      name: 'Sam Preparer',
      passwordHash: await bcrypt.hash('Preparer123!', 12),
    },
  });

  const existing = await prisma.company.findFirst({ where: { name: 'Northwind Trading Ltd' } });
  if (existing) {
    console.log('Demo company already present. Nothing else to do.');
    return;
  }

  const company = await prisma.company.create({
    data: {
      name: 'Northwind Trading Ltd',
      registrationNumber: '2019/447281/07',
      taxNumber: '9412887206',
      currencyCode: 'USD',
      currencySymbol: '$',
      locale: 'en-US',
      country: 'United States',
      addressLine1: '18 Harbour Way',
      city: 'Portland',
      postalCode: '97209',
      reportingFramework: 'IFRS_FOR_SMES',
      preparedBy: 'Sam Preparer',
      approvedBy: 'The board of directors',
      reportFooter: 'Northwind Trading Ltd — annual financial statements',
      members: {
        create: [
          { userId: admin.id, role: 'OWNER' },
          { userId: preparer.id, role: 'PREPARER' },
        ],
      },
    },
  });
  console.log(`Demo company created: ${company.name}`);

  await prisma.account.createMany({
    data: STANDARD_CHART.map((account, index) => ({
      companyId: company.id,
      code: account.code,
      name: account.name,
      type: account.type,
      section: account.section,
      sortOrder: index,
    })),
  });

  const accounts = await prisma.account.findMany({
    where: { companyId: company.id },
    select: { id: true, code: true },
  });
  const accountId = new Map(accounts.map((a) => [a.code, a.id]));

  const year2024 = await prisma.financialYear.create({
    data: {
      companyId: company.id,
      label: 'FY2024',
      startDate: new Date('2024-01-01T00:00:00.000Z'),
      endDate: new Date('2024-12-31T00:00:00.000Z'),
      status: 'CLOSED',
      closedAt: new Date('2025-02-14T00:00:00.000Z'),
    },
  });

  const year2025 = await prisma.financialYear.create({
    data: {
      companyId: company.id,
      label: 'FY2025',
      startDate: new Date('2025-01-01T00:00:00.000Z'),
      endDate: new Date('2025-12-31T00:00:00.000Z'),
      status: 'OPEN',
      isCurrent: true,
      previousYearId: year2024.id,
    },
  });

  for (const [year, balances, source] of [
    [year2024, FY2024_BALANCES, 'IMPORT'],
    [year2025, FY2025_BALANCES, 'CARRY_FORWARD'],
  ] as const) {
    await prisma.trialBalanceEntry.createMany({
      data: balances.map(([code, debit, credit]) => {
        const id = accountId.get(code);
        if (!id) throw new Error(`The chart has no account ${code}.`);
        return {
          financialYearId: year.id,
          accountId: id,
          debit: money(debit),
          credit: money(credit),
          source,
        };
      }),
    });
  }
  console.log('Trial balances loaded for FY2024 and FY2025.');

  for (const [rows, type] of [
    [DEBTORS, 'DEBTOR'],
    [CREDITORS, 'CREDITOR'],
  ] as const) {
    for (const row of rows) {
      const party = await prisma.party.create({
        data: {
          companyId: company.id,
          type,
          code: row.code,
          name: row.name,
          contactName: row.contact ?? null,
          email: `${row.code.toLowerCase()}@example.com`,
        },
      });

      for (const [year, buckets] of [
        [year2024, row.buckets2024],
        [year2025, row.buckets2025],
      ] as const) {
        await prisma.partyBalance.create({
          data: {
            financialYearId: year.id,
            partyId: party.id,
            current: money(buckets[0]),
            days30: money(buckets[1]),
            days60: money(buckets[2]),
            days90: money(buckets[3]),
            days120Plus: money(buckets[4]),
            total: money(total(buckets)),
          },
        });
      }
    }
  }
  console.log('Debtors and creditors listings loaded, agreeing to their control accounts.');

  for (const year of [year2024, year2025]) {
    await prisma.note.createMany({
      data: POLICY_NOTES.map((note) => ({
        financialYearId: year.id,
        number: note.number,
        title: note.title,
        kind: 'POLICY' as const,
        body: note.body,
        isSystemGenerated: true,
        sortOrder: note.number,
      })),
    });
  }
  console.log('Accounting policy notes added.');

  console.log('');
  console.log('Sign in with:');
  console.log(`  ${adminEmail} / ${adminPassword}   (owner)`);
  console.log('  preparer@finstat.local / Preparer123!   (preparer)');
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
