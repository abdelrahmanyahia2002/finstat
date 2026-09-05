/**
 * The statement engine.
 *
 * Pure functions, no database and no framework, so the same code runs on the
 * API when it renders a PDF and in the browser when it previews a figure the
 * user just typed. Everything starts from one trial balance per year.
 *
 * The model is a pre-closing trial balance: it carries the profit and loss
 * accounts alongside retained earnings brought forward. That is what makes the
 * balance sheet balance by construction. If total debits equal total credits
 * then, writing D for debit-positive balances,
 *
 *     assets + expenses - liabilities - equity - income = 0
 *     assets = liabilities + equity + (income - expenses)
 *     assets = liabilities + equity + profit
 *
 * so folding the year's profit into retained earnings closes the balance sheet
 * exactly. Any imbalance the user sees is a real imbalance in their data, never
 * an artefact of the engine.
 */

import { round2, sum, subtract, difference, isZero } from './money';
import {
  SECTION_META,
  SECTIONS_IN_ORDER,
  STATEMENT_SECTIONS,
  type AccountType,
  type SectionMeta,
  type StatementGroup,
  type StatementSection,
} from './taxonomy';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One line of a trial balance, exactly as it is captured or imported. */
export interface AccountBalance {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  section: StatementSection;
  debit: number;
  credit: number;
}

export interface SectionAccount {
  accountId: string;
  code: string;
  name: string;
  /** Presentation-signed: positive means it adds to the section as shown. */
  amount: number;
}

export interface SectionAggregate {
  section: StatementSection;
  meta: SectionMeta;
  amount: number;
  accounts: SectionAccount[];
}

export type SectionTotals = Record<StatementSection, SectionAggregate>;

// ---------------------------------------------------------------------------
// Period computation
// ---------------------------------------------------------------------------

export interface IncomeTotals {
  revenue: number;
  costOfSales: number;
  grossProfit: number;
  otherIncome: number;
  distributionCosts: number;
  administrativeExpenses: number;
  otherOperatingExpenses: number;
  depreciationAmortisation: number;
  totalOperatingExpenses: number;
  operatingProfit: number;
  financeIncome: number;
  financeCosts: number;
  profitBeforeTax: number;
  taxExpense: number;
  profitForYear: number;
}

export interface BalanceTotals {
  nonCurrentAssets: number;
  currentAssets: number;
  totalAssets: number;
  shareCapital: number;
  sharePremium: number;
  otherReserves: number;
  /** Brought forward plus dividends declared plus this year's profit. */
  retainedEarnings: number;
  totalEquity: number;
  nonCurrentLiabilities: number;
  currentLiabilities: number;
  totalLiabilities: number;
  totalEquityAndLiabilities: number;
  /** Assets less equity and liabilities. Zero when the books balance. */
  balanceDifference: number;
}

export interface PeriodComputation {
  financialYearId: string;
  label: string;
  startDate: string;
  endDate: string;
  sections: SectionTotals;
  totalDebits: number;
  totalCredits: number;
  trialBalanceDifference: number;
  isTrialBalanceBalanced: boolean;
  income: IncomeTotals;
  balanceSheet: BalanceTotals;
}

/** Debit-positive balance of one account. */
export function signedBalance(row: Pick<AccountBalance, 'debit' | 'credit'>): number {
  return subtract(row.debit ?? 0, row.credit ?? 0);
}

/**
 * The amount as the statements show it. Liabilities, equity and income read
 * positive when they sit on their natural side.
 */
export function presentationAmount(row: AccountBalance): number {
  const balance = signedBalance(row);
  const meta = SECTION_META[row.section];
  if (!meta) return balance;
  return meta.presentAs === 'DEBIT' ? balance : round2(-balance);
}

function emptySections(): SectionTotals {
  const out = {} as SectionTotals;
  for (const section of STATEMENT_SECTIONS) {
    out[section] = {
      section,
      meta: SECTION_META[section],
      amount: 0,
      accounts: [],
    };
  }
  return out;
}

export function aggregateBySection(rows: AccountBalance[]): SectionTotals {
  const sections = emptySections();

  for (const row of rows) {
    const bucket = sections[row.section];
    if (!bucket) continue; // an unmapped account is reported by validation, not silently dropped here
    const amount = presentationAmount(row);
    bucket.accounts.push({
      accountId: row.accountId,
      code: row.code,
      name: row.name,
      amount,
    });
  }

  for (const bucket of Object.values(sections)) {
    bucket.amount = sum(bucket.accounts.map((a) => a.amount));
    bucket.accounts.sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true }));
  }

  return sections;
}

function groupTotal(sections: SectionTotals, group: StatementGroup): number {
  return sum(
    SECTIONS_IN_ORDER.filter((m) => m.group === group).map((m) => sections[m.section].amount),
  );
}

export function computeIncomeTotals(sections: SectionTotals): IncomeTotals {
  const revenue = sections.REVENUE.amount;
  const costOfSales = sections.COST_OF_SALES.amount;
  const grossProfit = subtract(revenue, costOfSales);
  const otherIncome = sections.OTHER_INCOME.amount;

  const distributionCosts = sections.DISTRIBUTION_COSTS.amount;
  const administrativeExpenses = sections.ADMINISTRATIVE_EXPENSES.amount;
  const otherOperatingExpenses = sections.OTHER_OPERATING_EXPENSES.amount;
  const depreciationAmortisation = sections.DEPRECIATION_AMORTISATION.amount;
  const totalOperatingExpenses = sum([
    distributionCosts,
    administrativeExpenses,
    otherOperatingExpenses,
    depreciationAmortisation,
  ]);

  const operatingProfit = subtract(sum([grossProfit, otherIncome]), totalOperatingExpenses);
  const financeIncome = sections.FINANCE_INCOME.amount;
  const financeCosts = sections.FINANCE_COSTS.amount;
  const profitBeforeTax = subtract(sum([operatingProfit, financeIncome]), financeCosts);
  const taxExpense = sections.INCOME_TAX_EXPENSE.amount;
  const profitForYear = subtract(profitBeforeTax, taxExpense);

  return {
    revenue,
    costOfSales,
    grossProfit,
    otherIncome,
    distributionCosts,
    administrativeExpenses,
    otherOperatingExpenses,
    depreciationAmortisation,
    totalOperatingExpenses,
    operatingProfit,
    financeIncome,
    financeCosts,
    profitBeforeTax,
    taxExpense,
    profitForYear,
  };
}

export function computeBalanceTotals(
  sections: SectionTotals,
  profitForYear: number,
): BalanceTotals {
  const nonCurrentAssets = groupTotal(sections, 'NON_CURRENT_ASSETS');
  const currentAssets = groupTotal(sections, 'CURRENT_ASSETS');
  const totalAssets = sum([nonCurrentAssets, currentAssets]);

  const shareCapital = sections.SHARE_CAPITAL.amount;
  const sharePremium = sections.SHARE_PREMIUM.amount;
  const otherReserves = sections.OTHER_RESERVES.amount;
  const retainedEarnings = sum([
    sections.RETAINED_EARNINGS.amount,
    sections.DIVIDENDS_DECLARED.amount,
    profitForYear,
  ]);
  const totalEquity = sum([shareCapital, sharePremium, otherReserves, retainedEarnings]);

  const nonCurrentLiabilities = groupTotal(sections, 'NON_CURRENT_LIABILITIES');
  const currentLiabilities = groupTotal(sections, 'CURRENT_LIABILITIES');
  const totalLiabilities = sum([nonCurrentLiabilities, currentLiabilities]);
  const totalEquityAndLiabilities = sum([totalEquity, totalLiabilities]);

  return {
    nonCurrentAssets,
    currentAssets,
    totalAssets,
    shareCapital,
    sharePremium,
    otherReserves,
    retainedEarnings,
    totalEquity,
    nonCurrentLiabilities,
    currentLiabilities,
    totalLiabilities,
    totalEquityAndLiabilities,
    balanceDifference: difference(totalAssets, totalEquityAndLiabilities),
  };
}

export interface PeriodInput {
  financialYearId: string;
  label: string;
  startDate: string;
  endDate: string;
  rows: AccountBalance[];
}

export function computePeriod(input: PeriodInput): PeriodComputation {
  const sections = aggregateBySection(input.rows);
  const totalDebits = sum(input.rows.map((r) => r.debit ?? 0));
  const totalCredits = sum(input.rows.map((r) => r.credit ?? 0));
  const trialBalanceDifference = difference(totalDebits, totalCredits);
  const income = computeIncomeTotals(sections);
  const balanceSheet = computeBalanceTotals(sections, income.profitForYear);

  return {
    financialYearId: input.financialYearId,
    label: input.label,
    startDate: input.startDate,
    endDate: input.endDate,
    sections,
    totalDebits,
    totalCredits,
    trialBalanceDifference,
    isTrialBalanceBalanced: isZero(trialBalanceDifference),
    income,
    balanceSheet,
  };
}

// ---------------------------------------------------------------------------
// Rendered statements
// ---------------------------------------------------------------------------

export type LineStyle = 'HEADING' | 'ITEM' | 'DETAIL' | 'SUBTOTAL' | 'TOTAL' | 'SPACER';

export interface StatementLine {
  key: string;
  label: string;
  style: LineStyle;
  indent: number;
  current: number | null;
  prior: number | null;
  noteNumber?: number | null;
  section?: StatementSection;
  accountIds?: string[];
}

export interface RenderedStatement {
  title: string;
  subtitle: string;
  currentLabel: string;
  priorLabel: string | null;
  lines: StatementLine[];
}

export interface NoteNumbering {
  /** Section to the note number it was assigned. */
  bySection: Partial<Record<StatementSection, number>>;
}

interface BuildOptions {
  current: PeriodComputation;
  prior?: PeriodComputation | null;
  companyName: string;
  currencyLabel?: string;
  notes?: NoteNumbering;
  /** Show every account under its section instead of one section total. */
  detailed?: boolean;
}

function priorSection(
  prior: PeriodComputation | null | undefined,
  section: StatementSection,
): number | null {
  if (!prior) return null;
  return prior.sections[section].amount;
}

function line(
  key: string,
  label: string,
  style: LineStyle,
  indent: number,
  current: number | null,
  prior: number | null,
  extra: Partial<StatementLine> = {},
): StatementLine {
  return { key, label, style, indent, current, prior, ...extra };
}

function spacer(key: string): StatementLine {
  return line(key, '', 'SPACER', 0, null, null);
}

function pushSectionLines(
  out: StatementLine[],
  opts: BuildOptions,
  section: StatementSection,
  options: { skipWhenEmpty?: boolean } = {},
): void {
  const { current, prior, notes, detailed } = opts;
  const agg = current.sections[section];
  const priorAmount = priorSection(prior, section);
  const skipWhenEmpty = options.skipWhenEmpty ?? true;

  if (skipWhenEmpty && isZero(agg.amount) && (priorAmount === null || isZero(priorAmount))) {
    return;
  }

  out.push(
    line(`section:${section}`, agg.meta.label, 'ITEM', 1, agg.amount, priorAmount, {
      noteNumber: notes?.bySection[section] ?? null,
      section,
      accountIds: agg.accounts.map((a) => a.accountId),
    }),
  );

  if (detailed) {
    const priorAccounts = new Map<string, number>();
    if (prior) {
      for (const a of prior.sections[section].accounts) priorAccounts.set(a.code, a.amount);
    }
    for (const account of agg.accounts) {
      out.push(
        line(
          `account:${account.accountId}`,
          `${account.code}  ${account.name}`,
          'DETAIL',
          2,
          account.amount,
          prior ? (priorAccounts.get(account.code) ?? 0) : null,
          { section, accountIds: [account.accountId] },
        ),
      );
    }
  }
}

export function buildBalanceSheet(opts: BuildOptions): RenderedStatement {
  const { current, prior, companyName } = opts;
  const lines: StatementLine[] = [];
  const bs = current.balanceSheet;
  const priorBs = prior?.balanceSheet ?? null;

  lines.push(line('h:assets', 'ASSETS', 'HEADING', 0, null, null));
  lines.push(line('h:nca', 'Non-current assets', 'HEADING', 0, null, null));
  for (const meta of SECTIONS_IN_ORDER.filter((m) => m.group === 'NON_CURRENT_ASSETS')) {
    pushSectionLines(lines, opts, meta.section);
  }
  lines.push(
    line(
      't:nca',
      'Total non-current assets',
      'SUBTOTAL',
      0,
      bs.nonCurrentAssets,
      priorBs?.nonCurrentAssets ?? null,
    ),
  );
  lines.push(spacer('s1'));

  lines.push(line('h:ca', 'Current assets', 'HEADING', 0, null, null));
  for (const meta of SECTIONS_IN_ORDER.filter((m) => m.group === 'CURRENT_ASSETS')) {
    pushSectionLines(lines, opts, meta.section);
  }
  lines.push(
    line(
      't:ca',
      'Total current assets',
      'SUBTOTAL',
      0,
      bs.currentAssets,
      priorBs?.currentAssets ?? null,
    ),
  );
  lines.push(spacer('s2'));
  lines.push(
    line('t:assets', 'TOTAL ASSETS', 'TOTAL', 0, bs.totalAssets, priorBs?.totalAssets ?? null),
  );
  lines.push(spacer('s3'));

  lines.push(line('h:eandl', 'EQUITY AND LIABILITIES', 'HEADING', 0, null, null));
  lines.push(line('h:equity', 'Equity', 'HEADING', 0, null, null));
  pushSectionLines(lines, opts, 'SHARE_CAPITAL');
  pushSectionLines(lines, opts, 'SHARE_PREMIUM');
  pushSectionLines(lines, opts, 'OTHER_RESERVES');
  lines.push(
    line(
      'section:RETAINED_EARNINGS',
      'Retained earnings',
      'ITEM',
      1,
      bs.retainedEarnings,
      priorBs?.retainedEarnings ?? null,
      { section: 'RETAINED_EARNINGS' },
    ),
  );
  lines.push(
    line('t:equity', 'Total equity', 'SUBTOTAL', 0, bs.totalEquity, priorBs?.totalEquity ?? null),
  );
  lines.push(spacer('s4'));

  lines.push(line('h:ncl', 'Non-current liabilities', 'HEADING', 0, null, null));
  for (const meta of SECTIONS_IN_ORDER.filter((m) => m.group === 'NON_CURRENT_LIABILITIES')) {
    pushSectionLines(lines, opts, meta.section);
  }
  lines.push(
    line(
      't:ncl',
      'Total non-current liabilities',
      'SUBTOTAL',
      0,
      bs.nonCurrentLiabilities,
      priorBs?.nonCurrentLiabilities ?? null,
    ),
  );
  lines.push(spacer('s5'));

  lines.push(line('h:cl', 'Current liabilities', 'HEADING', 0, null, null));
  for (const meta of SECTIONS_IN_ORDER.filter((m) => m.group === 'CURRENT_LIABILITIES')) {
    pushSectionLines(lines, opts, meta.section);
  }
  lines.push(
    line(
      't:cl',
      'Total current liabilities',
      'SUBTOTAL',
      0,
      bs.currentLiabilities,
      priorBs?.currentLiabilities ?? null,
    ),
  );
  lines.push(spacer('s6'));
  lines.push(
    line(
      't:eandl',
      'TOTAL EQUITY AND LIABILITIES',
      'TOTAL',
      0,
      bs.totalEquityAndLiabilities,
      priorBs?.totalEquityAndLiabilities ?? null,
    ),
  );

  return {
    title: 'Statement of Financial Position',
    subtitle: `${companyName} — as at ${current.endDate}`,
    currentLabel: current.label,
    priorLabel: prior?.label ?? null,
    lines,
  };
}

export function buildIncomeStatement(opts: BuildOptions): RenderedStatement {
  const { current, prior, companyName } = opts;
  const inc = current.income;
  const priorInc = prior?.income ?? null;
  const lines: StatementLine[] = [];

  pushSectionLines(lines, opts, 'REVENUE', { skipWhenEmpty: false });
  pushSectionLines(lines, opts, 'COST_OF_SALES');
  lines.push(
    line('t:gross', 'Gross profit', 'SUBTOTAL', 0, inc.grossProfit, priorInc?.grossProfit ?? null),
  );
  lines.push(spacer('s1'));

  pushSectionLines(lines, opts, 'OTHER_INCOME');
  lines.push(line('h:opex', 'Operating expenses', 'HEADING', 0, null, null));
  for (const meta of SECTIONS_IN_ORDER.filter((m) => m.group === 'OPERATING_EXPENSES')) {
    pushSectionLines(lines, opts, meta.section);
  }
  lines.push(
    line(
      't:opex',
      'Total operating expenses',
      'SUBTOTAL',
      0,
      inc.totalOperatingExpenses,
      priorInc?.totalOperatingExpenses ?? null,
    ),
  );
  lines.push(spacer('s2'));
  lines.push(
    line(
      't:operating',
      'Operating profit',
      'SUBTOTAL',
      0,
      inc.operatingProfit,
      priorInc?.operatingProfit ?? null,
    ),
  );
  lines.push(spacer('s3'));

  pushSectionLines(lines, opts, 'FINANCE_INCOME');
  pushSectionLines(lines, opts, 'FINANCE_COSTS');
  lines.push(
    line(
      't:pbt',
      'Profit before taxation',
      'SUBTOTAL',
      0,
      inc.profitBeforeTax,
      priorInc?.profitBeforeTax ?? null,
    ),
  );
  pushSectionLines(lines, opts, 'INCOME_TAX_EXPENSE');
  lines.push(
    line(
      't:pat',
      'Profit for the year',
      'TOTAL',
      0,
      inc.profitForYear,
      priorInc?.profitForYear ?? null,
    ),
  );

  return {
    title: 'Statement of Profit or Loss',
    subtitle: `${companyName} — for the year ended ${current.endDate}`,
    currentLabel: current.label,
    priorLabel: prior?.label ?? null,
    lines,
  };
}

// ---------------------------------------------------------------------------
// Cash flow (indirect method)
// ---------------------------------------------------------------------------

export interface CashFlowTotals {
  profitBeforeTax: number;
  depreciationAmortisation: number;
  financeCosts: number;
  financeIncome: number;
  operatingBeforeWorkingCapital: number;
  inventoryMovement: number;
  receivablesMovement: number;
  payablesMovement: number;
  cashGeneratedFromOperations: number;
  financeCostsPaid: number;
  financeIncomeReceived: number;
  taxPaid: number;
  netOperating: number;
  investingMovement: number;
  netInvesting: number;
  borrowingsMovement: number;
  equityIssued: number;
  dividendsPaid: number;
  netFinancing: number;
  netMovement: number;
  openingCash: number;
  closingCash: number;
  /** Computed movement less actual movement. Zero when it reconciles. */
  reconciliationDifference: number;
}

/** Net cash and cash equivalents: bank balances less overdrafts. */
export function netCash(period: PeriodComputation): number {
  return subtract(
    period.sections.CASH_AND_CASH_EQUIVALENTS.amount,
    period.sections.BANK_OVERDRAFT.amount,
  );
}

function sectionMovement(
  current: PeriodComputation,
  prior: PeriodComputation,
  sections: StatementSection[],
): number {
  return sum(
    sections.map((s) => difference(current.sections[s].amount, prior.sections[s].amount)),
  );
}

/**
 * Build the cash flow statement from the movement between two balance sheets
 * plus the current year's profit and loss.
 *
 * Every balance sheet section belongs to exactly one bucket below, which is why
 * the statement reconciles to the movement in cash to the cent rather than
 * approximately. Where it does not reconcile, the difference is surfaced as a
 * validation failure instead of being plugged.
 *
 * The reconciliation rests on one assumption: this year's opening retained
 * earnings equal last year's closing retained earnings. That is what carrying a
 * year forward guarantees, and OPENING_RETAINED_EARNINGS in the validation run
 * is the check that says so out loud when somebody has edited the opening
 * figure by hand.
 */
export function computeCashFlow(
  current: PeriodComputation,
  prior: PeriodComputation,
): CashFlowTotals {
  const inc = current.income;

  const depreciationAmortisation = inc.depreciationAmortisation;
  const financeCosts = inc.financeCosts;
  const financeIncome = inc.financeIncome;

  const operatingBeforeWorkingCapital = subtract(
    sum([inc.profitBeforeTax, depreciationAmortisation, financeCosts]),
    financeIncome,
  );

  // An increase in an asset consumes cash; an increase in a liability releases it.
  const inventoryMovement = round2(-sectionMovement(current, prior, ['INVENTORIES']));
  const receivablesMovement = round2(
    -sectionMovement(current, prior, ['TRADE_RECEIVABLES', 'OTHER_RECEIVABLES', 'PREPAYMENTS']),
  );
  const payablesMovement = sectionMovement(current, prior, [
    'TRADE_PAYABLES',
    'OTHER_PAYABLES',
    'ACCRUALS',
    'PROVISIONS_CURRENT',
    'PROVISIONS_NON_CURRENT',
  ]);

  const cashGeneratedFromOperations = sum([
    operatingBeforeWorkingCapital,
    inventoryMovement,
    receivablesMovement,
    payablesMovement,
  ]);

  const financeCostsPaid = round2(-financeCosts);
  const financeIncomeReceived = financeIncome;

  // Tax paid: the charge, adjusted for what stayed on the balance sheet.
  const taxPaid = sum([
    -inc.taxExpense,
    sectionMovement(current, prior, ['CURRENT_TAX_LIABILITY', 'DEFERRED_TAX_LIABILITY']),
    -sectionMovement(current, prior, ['CURRENT_TAX_ASSET', 'DEFERRED_TAX_ASSET']),
  ]);

  const netOperating = sum([
    cashGeneratedFromOperations,
    financeCostsPaid,
    financeIncomeReceived,
    taxPaid,
  ]);

  // Investing: movement in long term assets, grossed back up for the
  // depreciation that was added back above.
  const investingMovement = round2(
    -sectionMovement(current, prior, [
      'PROPERTY_PLANT_EQUIPMENT',
      'INTANGIBLE_ASSETS',
      'INVESTMENTS_NON_CURRENT',
      'LOANS_RECEIVABLE_NON_CURRENT',
    ]),
  );
  const netInvesting = subtract(investingMovement, depreciationAmortisation);

  const borrowingsMovement = sectionMovement(current, prior, [
    'LOANS_NON_CURRENT',
    'LOANS_CURRENT',
  ]);
  const equityIssued = sectionMovement(current, prior, [
    'SHARE_CAPITAL',
    'SHARE_PREMIUM',
    'OTHER_RESERVES',
  ]);
  // Dividends declared this year, not the movement: carrying a year forward
  // closes the prior year's dividends into retained earnings, so the prior
  // figure is not a comparative to net against. The debit balance already
  // presents negative.
  const dividendsPaid = current.sections.DIVIDENDS_DECLARED.amount;
  const netFinancing = sum([borrowingsMovement, equityIssued, dividendsPaid]);

  const netMovement = sum([netOperating, netInvesting, netFinancing]);
  const openingCash = netCash(prior);
  const closingCash = netCash(current);
  const actualMovement = difference(closingCash, openingCash);

  return {
    profitBeforeTax: inc.profitBeforeTax,
    depreciationAmortisation,
    financeCosts,
    financeIncome,
    operatingBeforeWorkingCapital,
    inventoryMovement,
    receivablesMovement,
    payablesMovement,
    cashGeneratedFromOperations,
    financeCostsPaid,
    financeIncomeReceived,
    taxPaid,
    netOperating,
    investingMovement,
    netInvesting,
    borrowingsMovement,
    equityIssued,
    dividendsPaid,
    netFinancing,
    netMovement,
    openingCash,
    closingCash,
    reconciliationDifference: difference(netMovement, actualMovement),
  };
}

export function buildCashFlowStatement(opts: {
  current: PeriodComputation;
  prior: PeriodComputation;
  companyName: string;
}): RenderedStatement & { totals: CashFlowTotals } {
  const cf = computeCashFlow(opts.current, opts.prior);
  const l: StatementLine[] = [];
  const push = (key: string, label: string, style: LineStyle, indent: number, value: number | null) =>
    l.push(line(key, label, style, indent, value, null));

  push('h:op', 'Cash flows from operating activities', 'HEADING', 0, null);
  push('op:pbt', 'Profit before taxation', 'ITEM', 1, cf.profitBeforeTax);
  push('h:adj', 'Adjustments for:', 'HEADING', 1, null);
  push('op:dep', 'Depreciation and amortisation', 'ITEM', 2, cf.depreciationAmortisation);
  push('op:fc', 'Finance costs', 'ITEM', 2, cf.financeCosts);
  push('op:fi', 'Finance income', 'ITEM', 2, round2(-cf.financeIncome));
  push(
    'op:before',
    'Operating profit before working capital changes',
    'SUBTOTAL',
    1,
    cf.operatingBeforeWorkingCapital,
  );
  push('h:wc', 'Changes in working capital:', 'HEADING', 1, null);
  push('op:inv', 'Movement in inventories', 'ITEM', 2, cf.inventoryMovement);
  push('op:rec', 'Movement in trade and other receivables', 'ITEM', 2, cf.receivablesMovement);
  push('op:pay', 'Movement in trade and other payables', 'ITEM', 2, cf.payablesMovement);
  push('op:generated', 'Cash generated from operations', 'SUBTOTAL', 1, cf.cashGeneratedFromOperations);
  push('op:fcpaid', 'Finance costs paid', 'ITEM', 2, cf.financeCostsPaid);
  push('op:fireceived', 'Finance income received', 'ITEM', 2, cf.financeIncomeReceived);
  push('op:tax', 'Taxation paid', 'ITEM', 2, cf.taxPaid);
  push('t:op', 'Net cash from operating activities', 'SUBTOTAL', 0, cf.netOperating);
  l.push(spacer('s1'));

  push('h:inv', 'Cash flows from investing activities', 'HEADING', 0, null);
  push('inv:ppe', 'Additions to non-current assets', 'ITEM', 1, cf.netInvesting);
  push('t:inv', 'Net cash used in investing activities', 'SUBTOTAL', 0, cf.netInvesting);
  l.push(spacer('s2'));

  push('h:fin', 'Cash flows from financing activities', 'HEADING', 0, null);
  push('fin:loans', 'Movement in borrowings', 'ITEM', 1, cf.borrowingsMovement);
  push('fin:equity', 'Proceeds from equity', 'ITEM', 1, cf.equityIssued);
  push('fin:div', 'Dividends paid', 'ITEM', 1, cf.dividendsPaid);
  push('t:fin', 'Net cash from financing activities', 'SUBTOTAL', 0, cf.netFinancing);
  l.push(spacer('s3'));

  push('t:net', 'Net movement in cash and cash equivalents', 'TOTAL', 0, cf.netMovement);
  push('cf:open', 'Cash and cash equivalents at beginning of year', 'ITEM', 1, cf.openingCash);
  push('cf:close', 'Cash and cash equivalents at end of year', 'TOTAL', 0, cf.closingCash);

  return {
    title: 'Statement of Cash Flows',
    subtitle: `${opts.companyName} — for the year ended ${opts.current.endDate}`,
    currentLabel: opts.current.label,
    // The prior year is the source of the movements, not a comparative column.
    // A comparative cash flow would need the year before that one as well, so
    // until there are three years the column is left off rather than printed
    // empty.
    priorLabel: null,
    lines: l,
    totals: cf,
  };
}

/** Note numbers follow the order the sections appear in the statements. */
export function assignNoteNumbers(
  current: PeriodComputation,
  startAt = 1,
): NoteNumbering {
  const bySection: Partial<Record<StatementSection, number>> = {};
  let n = startAt;
  for (const meta of SECTIONS_IN_ORDER) {
    if (!meta.generatesNote) continue;
    const agg = current.sections[meta.section];
    if (isZero(agg.amount) && agg.accounts.length === 0) continue;
    bySection[meta.section] = n;
    n += 1;
  }
  return { bySection };
}
