import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { formatAmount, parseAmount, round2, sum, tryParseAmount } from './money';
import {
  buildBalanceSheet,
  buildCashFlowStatement,
  buildIncomeStatement,
  computeCashFlow,
  computePeriod,
  netCash,
  type AccountBalance,
  type PeriodInput,
} from './statements';
import { runValidations } from './validation';
import { parsePastedTrialBalance, splitClipboard, toClipboardText } from './paste';
import type { StatementSection } from './taxonomy';

// ---------------------------------------------------------------------------
// Fixtures: two consecutive years of a small trading company.
// ---------------------------------------------------------------------------

type Row = [code: string, name: string, section: StatementSection, debit: number, credit: number];

function toBalances(rows: Row[]): AccountBalance[] {
  return rows.map(([code, name, section, debit, credit]) => ({
    accountId: `acc-${code}`,
    code,
    name,
    type: sectionType(section),
    section,
    debit,
    credit,
  }));
}

function sectionType(section: StatementSection) {
  // Mirrors the taxonomy without importing the whole map, so a broken map in
  // the taxonomy cannot silently make these fixtures agree with it.
  const income: StatementSection[] = ['REVENUE', 'OTHER_INCOME', 'FINANCE_INCOME'];
  const expense: StatementSection[] = [
    'COST_OF_SALES',
    'DISTRIBUTION_COSTS',
    'ADMINISTRATIVE_EXPENSES',
    'OTHER_OPERATING_EXPENSES',
    'DEPRECIATION_AMORTISATION',
    'FINANCE_COSTS',
    'INCOME_TAX_EXPENSE',
  ];
  const equity: StatementSection[] = [
    'SHARE_CAPITAL',
    'SHARE_PREMIUM',
    'OTHER_RESERVES',
    'RETAINED_EARNINGS',
    'DIVIDENDS_DECLARED',
  ];
  const liability: StatementSection[] = [
    'LOANS_NON_CURRENT',
    'LOANS_CURRENT',
    'DEFERRED_TAX_LIABILITY',
    'PROVISIONS_NON_CURRENT',
    'PROVISIONS_CURRENT',
    'BANK_OVERDRAFT',
    'TRADE_PAYABLES',
    'OTHER_PAYABLES',
    'ACCRUALS',
    'CURRENT_TAX_LIABILITY',
  ];
  if (income.includes(section)) return 'INCOME' as const;
  if (expense.includes(section)) return 'EXPENSE' as const;
  if (equity.includes(section)) return 'EQUITY' as const;
  if (liability.includes(section)) return 'LIABILITY' as const;
  return 'ASSET' as const;
}

const PRIOR_ROWS: Row[] = [
  ['1000', 'Property, plant and equipment', 'PROPERTY_PLANT_EQUIPMENT', 500_000, 0],
  ['1200', 'Inventory', 'INVENTORIES', 120_000, 0],
  ['1300', 'Trade receivables', 'TRADE_RECEIVABLES', 180_000, 0],
  ['1500', 'Bank', 'CASH_AND_CASH_EQUIVALENTS', 90_000, 0],
  ['2000', 'Share capital', 'SHARE_CAPITAL', 0, 100_000],
  ['2100', 'Retained earnings', 'RETAINED_EARNINGS', 0, 336_000],
  ['2500', 'Long term loan', 'LOANS_NON_CURRENT', 0, 200_000],
  ['3000', 'Trade payables', 'TRADE_PAYABLES', 0, 150_000],
  ['3100', 'Tax payable', 'CURRENT_TAX_LIABILITY', 0, 20_000],
  ['4000', 'Revenue', 'REVENUE', 0, 900_000],
  ['5000', 'Cost of sales', 'COST_OF_SALES', 540_000, 0],
  ['6000', 'Administrative expenses', 'ADMINISTRATIVE_EXPENSES', 180_000, 0],
  ['6500', 'Depreciation', 'DEPRECIATION_AMORTISATION', 50_000, 0],
  ['7000', 'Interest paid', 'FINANCE_COSTS', 18_000, 0],
  ['8000', 'Income tax', 'INCOME_TAX_EXPENSE', 28_000, 0],
];

const CURRENT_ROWS: Row[] = [
  ['1000', 'Property, plant and equipment', 'PROPERTY_PLANT_EQUIPMENT', 520_000, 0],
  ['1200', 'Inventory', 'INVENTORIES', 140_000, 0],
  ['1300', 'Trade receivables', 'TRADE_RECEIVABLES', 210_000, 0],
  ['1500', 'Bank', 'CASH_AND_CASH_EQUIVALENTS', 140_000, 0],
  ['2000', 'Share capital', 'SHARE_CAPITAL', 0, 150_000],
  ['2100', 'Retained earnings', 'RETAINED_EARNINGS', 0, 420_000],
  ['2200', 'Dividends declared', 'DIVIDENDS_DECLARED', 40_000, 0],
  ['2500', 'Long term loan', 'LOANS_NON_CURRENT', 0, 170_000],
  ['3000', 'Trade payables', 'TRADE_PAYABLES', 0, 165_000],
  ['3100', 'Tax payable', 'CURRENT_TAX_LIABILITY', 0, 25_000],
  ['4000', 'Revenue', 'REVENUE', 0, 1_050_000],
  ['5000', 'Cost of sales', 'COST_OF_SALES', 620_000, 0],
  ['6000', 'Administrative expenses', 'ADMINISTRATIVE_EXPENSES', 200_000, 0],
  ['6500', 'Depreciation', 'DEPRECIATION_AMORTISATION', 60_000, 0],
  ['7000', 'Interest paid', 'FINANCE_COSTS', 15_000, 0],
  ['8000', 'Income tax', 'INCOME_TAX_EXPENSE', 35_000, 0],
];

function period(label: string, rows: Row[], start: string, end: string): PeriodInput {
  return { financialYearId: label, label, startDate: start, endDate: end, rows: toBalances(rows) };
}

const prior = computePeriod(period('FY2024', PRIOR_ROWS, '2024-01-01', '2024-12-31'));
const current = computePeriod(period('FY2025', CURRENT_ROWS, '2025-01-01', '2025-12-31'));

// ---------------------------------------------------------------------------

describe('money', () => {
  test('rounds half away from zero', () => {
    assert.equal(round2(2.005), 2.01);
    assert.equal(round2(-2.005), -2.01);
    assert.equal(round2(1.005), 1.01);
  });

  test('sums without floating point drift', () => {
    assert.equal(sum([0.1, 0.2]), 0.3);
    assert.equal(sum(Array.from({ length: 1000 }, () => 0.01)), 10);
  });

  test('parses the shapes a spreadsheet produces', () => {
    assert.equal(parseAmount('1,234.56'), 1234.56);
    assert.equal(parseAmount('1.234,56'), 1234.56);
    assert.equal(parseAmount('(1,234.56)'), -1234.56);
    assert.equal(parseAmount('R 1 234.56'), 1234.56);
    assert.equal(parseAmount('1234.56-'), -1234.56);
    assert.equal(parseAmount('$-99.99'), -99.99);
    assert.equal(parseAmount('1.234.567'), 1234567);
    assert.equal(parseAmount('1,234'), 1234);
    assert.equal(parseAmount('1,23'), 1.23);
  });

  test('tells an empty cell apart from a zero', () => {
    assert.equal(tryParseAmount(''), null);
    assert.equal(tryParseAmount('   '), null);
    assert.equal(tryParseAmount('n/a'), null);
    assert.equal(tryParseAmount('0'), 0);
  });

  test('formats negatives in accounting style', () => {
    assert.equal(formatAmount(-1234.5), '(1,234.50)');
    assert.equal(formatAmount(-1234.5, { accounting: false }), '-1,234.50');
    assert.equal(formatAmount(0, { blankOnZero: true }), '');
  });
});

describe('period computation', () => {
  test('the fixture trial balances balance', () => {
    assert.equal(prior.isTrialBalanceBalanced, true, 'prior year debits should equal credits');
    assert.equal(current.isTrialBalanceBalanced, true, 'current year debits should equal credits');
  });

  test('profit for the year works down the income statement', () => {
    assert.equal(current.income.grossProfit, 430_000);
    assert.equal(current.income.totalOperatingExpenses, 260_000);
    assert.equal(current.income.operatingProfit, 170_000);
    assert.equal(current.income.profitBeforeTax, 155_000);
    assert.equal(current.income.profitForYear, 120_000);
    assert.equal(prior.income.profitForYear, 84_000);
  });

  test('the balance sheet balances once profit lands in retained earnings', () => {
    assert.equal(current.balanceSheet.totalAssets, 1_010_000);
    assert.equal(current.balanceSheet.retainedEarnings, 500_000);
    assert.equal(current.balanceSheet.totalEquity, 650_000);
    assert.equal(current.balanceSheet.totalLiabilities, 360_000);
    assert.equal(current.balanceSheet.balanceDifference, 0);
    assert.equal(prior.balanceSheet.balanceDifference, 0);
  });

  test('a balanced trial balance always produces a balanced balance sheet', () => {
    // Property check: any set of rows whose debits equal credits must close.
    const sections: StatementSection[] = [
      'PROPERTY_PLANT_EQUIPMENT',
      'INVENTORIES',
      'TRADE_RECEIVABLES',
      'CASH_AND_CASH_EQUIVALENTS',
      'SHARE_CAPITAL',
      'RETAINED_EARNINGS',
      'TRADE_PAYABLES',
      'LOANS_NON_CURRENT',
      'REVENUE',
      'COST_OF_SALES',
      'ADMINISTRATIVE_EXPENSES',
      'INCOME_TAX_EXPENSE',
    ];

    let seed = 42;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let iteration = 0; iteration < 200; iteration += 1) {
      const rows: Row[] = [];
      let net = 0;
      sections.forEach((section, index) => {
        const amount = round2(random() * 100_000);
        const onDebit = random() > 0.5;
        rows.push([
          String(1000 + index),
          `Account ${index}`,
          section,
          onDebit ? amount : 0,
          onDebit ? 0 : amount,
        ]);
        net = round2(net + (onDebit ? amount : -amount));
      });
      // One balancing account absorbs the difference.
      rows.push(['9999', 'Suspense', 'OTHER_PAYABLES', net < 0 ? -net : 0, net > 0 ? net : 0]);

      const computed = computePeriod(period('X', rows, '2025-01-01', '2025-12-31'));
      assert.equal(computed.isTrialBalanceBalanced, true, `iteration ${iteration} trial balance`);
      assert.equal(
        computed.balanceSheet.balanceDifference,
        0,
        `iteration ${iteration} balance sheet was out by ${computed.balanceSheet.balanceDifference}`,
      );
    }
  });
});

describe('cash flow', () => {
  const cf = computeCashFlow(current, prior);

  test('reconciles to the movement in cash exactly', () => {
    assert.equal(cf.openingCash, 90_000);
    assert.equal(cf.closingCash, 140_000);
    assert.equal(cf.netMovement, 50_000);
    assert.equal(cf.reconciliationDifference, 0);
  });

  test('classifies the year the way a preparer would', () => {
    assert.equal(cf.operatingBeforeWorkingCapital, 230_000);
    assert.equal(cf.inventoryMovement, -20_000);
    assert.equal(cf.receivablesMovement, -30_000);
    assert.equal(cf.payablesMovement, 15_000);
    assert.equal(cf.cashGeneratedFromOperations, 195_000);
    assert.equal(cf.taxPaid, -30_000);
    assert.equal(cf.netOperating, 150_000);
    // Additions of 80,000 against depreciation of 60,000 and a net book value
    // that only moved 20,000.
    assert.equal(cf.netInvesting, -80_000);
    assert.equal(cf.borrowingsMovement, -30_000);
    assert.equal(cf.equityIssued, 50_000);
    assert.equal(cf.dividendsPaid, -40_000);
    assert.equal(cf.netFinancing, -20_000);
  });

  test('refuses to reconcile when opening retained earnings were edited', () => {
    // The statement is only sound if this year opens where last year closed.
    // When somebody overrides that, the difference has to show rather than
    // being absorbed into a plug.
    const rows: Row[] = CURRENT_ROWS.map((r) =>
      r[0] === '2100' ? [r[0], r[1], r[2], 0, 400_000] : r,
    );
    rows.push(['9998', 'Plug', 'OTHER_PAYABLES', 0, 20_000]);
    const drifted = computePeriod(period('Drift', rows, '2025-01-01', '2025-12-31'));
    // Equity is 20,000 lighter and the plug sits in payables, so the computed
    // movement overstates cash by exactly that much.
    const flow = computeCashFlow(drifted, prior);
    assert.equal(flow.reconciliationDifference, 20_000);
  });

  test('treats an overdraft as negative cash', () => {
    const withOverdraft = computePeriod(
      period(
        'OD',
        [
          ...CURRENT_ROWS.filter((r) => r[0] !== '1500'),
          ['1500', 'Bank', 'CASH_AND_CASH_EQUIVALENTS', 0, 0],
          ['1600', 'Overdraft', 'BANK_OVERDRAFT', 0, 140_000],
          ['1700', 'Call account', 'CASH_AND_CASH_EQUIVALENTS', 280_000, 0],
        ],
        '2025-01-01',
        '2025-12-31',
      ),
    );
    assert.equal(netCash(withOverdraft), 140_000);
  });

  test('reconciles across many randomised second years', () => {
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let iteration = 0; iteration < 100; iteration += 1) {
      // Move a handful of balances, then let the bank absorb the difference so
      // the books still balance, exactly as a real year would. Opening retained
      // earnings stay put, because carrying a year forward is what sets them.
      const rows: Row[] = CURRENT_ROWS.map((row) => {
        if (row[0] === '1500' || row[0] === '2100') return row;
        const delta = round2((random() - 0.5) * 40_000);
        const debit = row[3] > 0 ? round2(row[3] + delta) : 0;
        const credit = row[4] > 0 ? round2(row[4] + delta) : 0;
        return [row[0], row[1], row[2], Math.max(debit, 0), Math.max(credit, 0)];
      });

      const withoutBank = rows.filter((r) => r[0] !== '1500');
      const netDebit = sum(withoutBank.map((r) => r[3]));
      const netCredit = sum(withoutBank.map((r) => r[4]));
      const plug = round2(netCredit - netDebit);
      rows.length = 0;
      rows.push(...withoutBank);
      rows.push(['1500', 'Bank', 'CASH_AND_CASH_EQUIVALENTS', plug > 0 ? plug : 0, plug < 0 ? -plug : 0]);

      const year = computePeriod(period('FY', rows, '2025-01-01', '2025-12-31'));
      assert.equal(year.isTrialBalanceBalanced, true, `iteration ${iteration} trial balance`);
      const flow = computeCashFlow(year, prior);
      assert.equal(
        flow.reconciliationDifference,
        0,
        `iteration ${iteration} cash flow was out by ${flow.reconciliationDifference}`,
      );
    }
  });
});

describe('rendered statements', () => {
  test('the balance sheet totals line agrees with the computation', () => {
    const rendered = buildBalanceSheet({ current, prior, companyName: 'Test Co' });
    const assets = rendered.lines.find((l) => l.key === 't:assets');
    const equityAndLiabilities = rendered.lines.find((l) => l.key === 't:eandl');
    assert.equal(assets?.current, 1_010_000);
    assert.equal(equityAndLiabilities?.current, 1_010_000);
    assert.equal(assets?.prior, 890_000);
    assert.equal(equityAndLiabilities?.prior, 890_000);
  });

  test('the income statement carries a comparative column', () => {
    const rendered = buildIncomeStatement({ current, prior, companyName: 'Test Co' });
    const profit = rendered.lines.find((l) => l.key === 't:pat');
    assert.equal(profit?.current, 120_000);
    assert.equal(profit?.prior, 84_000);
    assert.equal(rendered.priorLabel, 'FY2024');
  });

  test('the cash flow statement closes on the bank balance', () => {
    const rendered = buildCashFlowStatement({ current, prior, companyName: 'Test Co' });
    const closing = rendered.lines.find((l) => l.key === 'cf:close');
    assert.equal(closing?.current, 140_000);
    assert.equal(rendered.totals.reconciliationDifference, 0);
  });

  test('the cash flow prints no comparative column', () => {
    // Every line carries a current figure only, so a prior column would render
    // as a header over nothing.
    const rendered = buildCashFlowStatement({ current, prior, companyName: 'Test Co' });
    assert.equal(rendered.priorLabel, null);
    assert.equal(
      rendered.lines.every((line) => line.prior === null),
      true,
    );
  });
});

describe('validation', () => {
  const accounts = CURRENT_ROWS.map(([code, name, section]) => ({
    id: `acc-${code}`,
    code,
    name,
    section,
    isActive: true,
  }));

  test('a clean set of books raises no errors', () => {
    const report = runValidations({ current, prior, accounts });
    const errors = report.issues.filter((i) => i.severity === 'ERROR');
    assert.deepEqual(errors, [], `unexpected errors: ${JSON.stringify(errors, null, 2)}`);
    assert.equal(report.passed, true);
  });

  test('catches a trial balance that is out', () => {
    const broken = computePeriod(
      period('Broken', [...CURRENT_ROWS, ['9000', 'Oops', 'OTHER_PAYABLES', 0, 1_000]], '2025-01-01', '2025-12-31'),
    );
    const report = runValidations({ current: broken, prior, accounts });
    assert.equal(report.passed, false);
    assert.ok(report.issues.some((i) => i.code === 'TRIAL_BALANCE_BALANCED'));
  });

  test('catches opening retained earnings that do not follow last year', () => {
    const rows: Row[] = CURRENT_ROWS.map((r) =>
      r[0] === '2100' ? [r[0], r[1], r[2], 0, 400_000] : r,
    );
    // Keep the books balanced so only the carry forward check fires.
    rows.push(['9998', 'Plug', 'OTHER_PAYABLES', 0, 20_000]);
    const drifted = computePeriod(period('Drift', rows, '2025-01-01', '2025-12-31'));
    const report = runValidations({ current: drifted, prior, accounts });
    const issue = report.issues.find((i) => i.code === 'OPENING_RETAINED_EARNINGS');
    assert.ok(issue, 'expected the opening retained earnings check to fire');
    assert.equal(issue?.amount, -20_000);
  });

  test('catches a debtors listing that does not agree to the control account', () => {
    const report = runValidations({
      current,
      prior,
      accounts,
      subledger: { debtors: 200_000, creditors: 165_000, ageingMismatches: [] },
    });
    const issue = report.issues.find((i) => i.code === 'DEBTORS_CONTROL_AGREES');
    assert.ok(issue);
    assert.equal(issue?.amount, 10_000);
  });

  test('does not treat contra accounts as wrong-sided', () => {
    // Dividends declared is a debit inside equity, accumulated depreciation is
    // a credit inside property plant and equipment, and a doubtful debt
    // provision is a credit inside receivables. All three are ordinary.
    const rows: Row[] = [
      ...CURRENT_ROWS,
      ['1050', 'Accumulated depreciation', 'PROPERTY_PLANT_EQUIPMENT', 0, 90_000],
      ['1410', 'Provision for doubtful debts', 'TRADE_RECEIVABLES', 0, 10_000],
      // Balanced with a debit in an asset line, which is its natural side.
      ['9990', 'Balancing', 'OTHER_RECEIVABLES', 100_000, 0],
    ];
    const withContra = computePeriod(period('Contra', rows, '2025-01-01', '2025-12-31'));
    assert.equal(withContra.isTrialBalanceBalanced, true);

    const report = runValidations({
      current: withContra,
      prior,
      accounts: rows.map(([code, name, section]) => ({
        id: `acc-${code}`,
        code,
        name,
        section,
        isActive: true,
      })),
    });

    assert.deepEqual(
      report.issues.filter((i) => i.code === 'UNUSUAL_ACCOUNT_SIGN'),
      [],
    );
  });

  test('flags a whole statement line that lands on the wrong side', () => {
    // Inventory of 140,000 posted as a credit instead of a debit.
    const rows: Row[] = CURRENT_ROWS.map((r) =>
      r[0] === '1200' ? [r[0], r[1], r[2], 0, 140_000] : r,
    );
    rows.push(['9990', 'Balancing', 'OTHER_RECEIVABLES', 280_000, 0]);
    const inverted = computePeriod(period('Inverted', rows, '2025-01-01', '2025-12-31'));
    assert.equal(inverted.isTrialBalanceBalanced, true);

    const report = runValidations({
      current: inverted,
      prior,
      accounts: rows.map(([code, name, section]) => ({
        id: `acc-${code}`,
        code,
        name,
        section,
        isActive: true,
      })),
    });

    const flagged = report.issues.filter((i) => i.code === 'UNUSUAL_ACCOUNT_SIGN');
    assert.equal(flagged.length, 1);
    assert.match(flagged[0].title, /Inventories/);
    assert.equal(flagged[0].severity, 'WARNING');
  });

  test('flags an account with no reporting category', () => {
    const report = runValidations({
      current,
      prior,
      accounts: [...accounts, { id: 'x', code: '9500', name: 'Unmapped', section: null, isActive: true }],
    });
    assert.ok(report.issues.some((i) => i.code === 'ACCOUNTS_MAPPED'));
  });

  test('reports missing comparatives without failing the run', () => {
    const report = runValidations({ current, prior: null, accounts });
    const issue = report.issues.find((i) => i.code === 'COMPARATIVES_PRESENT');
    assert.equal(issue?.severity, 'INFO');
    assert.equal(report.passed, true);
  });
});

describe('clipboard', () => {
  test('splits what Excel puts on the clipboard', () => {
    const text = '1000\tBank\t100.00\t\r\n1100\tCash\t50.00\t\r\n';
    const grid = splitClipboard(text);
    assert.equal(grid.length, 2);
    assert.deepEqual(grid[0], ['1000', 'Bank', '100.00', '']);
  });

  test('keeps a quoted cell that contains a tab', () => {
    const grid = splitClipboard('1000\t"Bank\tcurrent"\t100\r\n');
    assert.deepEqual(grid[0], ['1000', 'Bank\tcurrent', '100']);
  });

  test('reads a pasted block with headings', () => {
    const text = [
      'Account Code\tAccount Name\tDebit\tCredit',
      '1000\tProperty, plant and equipment\t500 000.00\t',
      '2000\tShare capital\t\t100,000.00',
      '3000\tTrade payables\t\t(50,000.00)',
    ].join('\r\n');

    const result = parsePastedTrialBalance(text);
    assert.equal(result.headerRowIndex, 0);
    assert.equal(result.rows.length, 3);
    assert.equal(result.rows[0].debit, 500_000);
    assert.equal(result.rows[1].credit, 100_000);
    // A negative credit is really a debit.
    assert.equal(result.rows[2].debit, 50_000);
    assert.equal(result.rows[2].credit, 0);
    assert.equal(result.totalDebit, 550_000);
    assert.equal(result.totalCredit, 100_000);
  });

  test('reads a headerless block by shape', () => {
    const text = ['1000\tBank\t100\t0', '2000\tCapital\t0\t100'].join('\n');
    const result = parsePastedTrialBalance(text);
    assert.equal(result.headerRowIndex, null);
    assert.equal(result.rows.length, 2);
    assert.equal(result.rows[0].code, '1000');
    assert.equal(result.rows[0].name, 'Bank');
    assert.equal(result.rows[0].debit, 100);
  });

  test('reads a single signed amount column', () => {
    const text = ['Code\tName\tBalance', '1000\tBank\t100.00', '2000\tCapital\t-100.00'].join('\n');
    const result = parsePastedTrialBalance(text);
    assert.equal(result.rows[0].debit, 100);
    assert.equal(result.rows[1].credit, 100);
    assert.equal(result.rows[1].debit, 0);
  });

  test('reports a cell it cannot read instead of guessing', () => {
    const text = ['Code\tName\tDebit\tCredit', '1000\tBank\tabc\t'].join('\n');
    const result = parsePastedTrialBalance(text);
    assert.equal(result.rows[0].problems.length, 1);
    assert.match(result.rows[0].problems[0], /abc/);
  });

  test('ignores the totals row an export leaves at the bottom', () => {
    const text = [
      'Code\tAccount name\tDebit\tCredit',
      '1000\tBank\t100.00\t',
      '2000\tCapital\t\t100.00',
      '\tTotals\t100.00\t100.00',
    ].join('\r\n');

    const result = parsePastedTrialBalance(text);
    assert.equal(result.rows.length, 2);
    assert.equal(result.skippedRows, 1);
    assert.equal(result.totalDebit, 100);
    assert.equal(result.totalCredit, 100);
  });

  test('keeps a real account whose name reads like a total', () => {
    // The code is what distinguishes an account from a summary line.
    const text = ['Code\tAccount name\tDebit\tCredit', '1900\tTotal\t250.00\t'].join('\r\n');
    const result = parsePastedTrialBalance(text);
    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0].debit, 250);
  });

  test('round trips through clipboard text', () => {
    const text = toClipboardText([
      ['Code', 'Name', 'Debit'],
      ['1000', 'Bank "main"', 100],
    ]);
    const grid = splitClipboard(text);
    assert.deepEqual(grid[1], ['1000', 'Bank "main"', '100']);
  });
});
