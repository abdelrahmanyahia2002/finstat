/**
 * The reporting taxonomy.
 *
 * Every account in a company's chart is mapped to exactly one StatementSection.
 * That single mapping is what lets the balance sheet, the income statement, the
 * cash flow statement and the notes all be generated from one trial balance
 * without anybody re-keying a number.
 */

export const ACCOUNT_TYPES = ['ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE'] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];

/** Which side increases the account. */
export type NormalBalance = 'DEBIT' | 'CREDIT';

export const NORMAL_BALANCE: Record<AccountType, NormalBalance> = {
  ASSET: 'DEBIT',
  EXPENSE: 'DEBIT',
  LIABILITY: 'CREDIT',
  EQUITY: 'CREDIT',
  INCOME: 'CREDIT',
};

export const STATEMENTS = ['BALANCE_SHEET', 'INCOME_STATEMENT'] as const;
export type Statement = (typeof STATEMENTS)[number];

export const STATEMENT_GROUPS = [
  'NON_CURRENT_ASSETS',
  'CURRENT_ASSETS',
  'EQUITY',
  'NON_CURRENT_LIABILITIES',
  'CURRENT_LIABILITIES',
  'REVENUE',
  'COST_OF_SALES',
  'OTHER_INCOME',
  'OPERATING_EXPENSES',
  'FINANCE',
  'TAXATION',
] as const;
export type StatementGroup = (typeof STATEMENT_GROUPS)[number];

/** How a section behaves in the indirect cash flow statement. */
export const CASH_FLOW_ROLES = [
  'CASH', // the cash balance itself
  'WORKING_CAPITAL', // movement lands in operating activities
  'NON_CASH_ADDBACK', // depreciation and friends, added back to profit
  'INVESTING',
  'FINANCING',
  'TAXATION', // feeds the "tax paid" line
  'INTEREST_PAID',
  'INTEREST_RECEIVED',
  'PROFIT', // retained earnings, reconciled separately
  'NONE',
] as const;
export type CashFlowRole = (typeof CASH_FLOW_ROLES)[number];

export const STATEMENT_SECTIONS = [
  // ---- Non-current assets ----
  'PROPERTY_PLANT_EQUIPMENT',
  'INTANGIBLE_ASSETS',
  'INVESTMENTS_NON_CURRENT',
  'LOANS_RECEIVABLE_NON_CURRENT',
  'DEFERRED_TAX_ASSET',
  // ---- Current assets ----
  'INVENTORIES',
  'TRADE_RECEIVABLES',
  'OTHER_RECEIVABLES',
  'PREPAYMENTS',
  'CURRENT_TAX_ASSET',
  'CASH_AND_CASH_EQUIVALENTS',
  // ---- Equity ----
  'SHARE_CAPITAL',
  'SHARE_PREMIUM',
  'OTHER_RESERVES',
  'RETAINED_EARNINGS',
  'DIVIDENDS_DECLARED',
  // ---- Non-current liabilities ----
  'LOANS_NON_CURRENT',
  'DEFERRED_TAX_LIABILITY',
  'PROVISIONS_NON_CURRENT',
  // ---- Current liabilities ----
  'BANK_OVERDRAFT',
  'TRADE_PAYABLES',
  'OTHER_PAYABLES',
  'ACCRUALS',
  'CURRENT_TAX_LIABILITY',
  'LOANS_CURRENT',
  'PROVISIONS_CURRENT',
  // ---- Income statement ----
  'REVENUE',
  'COST_OF_SALES',
  'OTHER_INCOME',
  'DISTRIBUTION_COSTS',
  'ADMINISTRATIVE_EXPENSES',
  'OTHER_OPERATING_EXPENSES',
  'DEPRECIATION_AMORTISATION',
  'FINANCE_INCOME',
  'FINANCE_COSTS',
  'INCOME_TAX_EXPENSE',
] as const;
export type StatementSection = (typeof STATEMENT_SECTIONS)[number];

export interface SectionMeta {
  section: StatementSection;
  label: string;
  statement: Statement;
  group: StatementGroup;
  accountType: AccountType;
  /** Presentation sign: the balance sheet shows liabilities and equity positive. */
  presentAs: NormalBalance;
  cashFlowRole: CashFlowRole;
  /** Sections with a note get one generated automatically. */
  generatesNote: boolean;
  order: number;
  /** Subledger this section reconciles against, when there is one. */
  controlOf?: 'DEBTORS' | 'CREDITORS';
}

function meta(
  section: StatementSection,
  label: string,
  statement: Statement,
  group: StatementGroup,
  accountType: AccountType,
  cashFlowRole: CashFlowRole,
  generatesNote: boolean,
  order: number,
  controlOf?: 'DEBTORS' | 'CREDITORS',
): SectionMeta {
  return {
    section,
    label,
    statement,
    group,
    accountType,
    presentAs: NORMAL_BALANCE[accountType],
    cashFlowRole,
    generatesNote,
    order,
    controlOf,
  };
}

export const SECTION_META: Record<StatementSection, SectionMeta> = {
  PROPERTY_PLANT_EQUIPMENT: meta('PROPERTY_PLANT_EQUIPMENT', 'Property, plant and equipment', 'BALANCE_SHEET', 'NON_CURRENT_ASSETS', 'ASSET', 'INVESTING', true, 100),
  INTANGIBLE_ASSETS: meta('INTANGIBLE_ASSETS', 'Intangible assets', 'BALANCE_SHEET', 'NON_CURRENT_ASSETS', 'ASSET', 'INVESTING', true, 110),
  INVESTMENTS_NON_CURRENT: meta('INVESTMENTS_NON_CURRENT', 'Investments', 'BALANCE_SHEET', 'NON_CURRENT_ASSETS', 'ASSET', 'INVESTING', true, 120),
  LOANS_RECEIVABLE_NON_CURRENT: meta('LOANS_RECEIVABLE_NON_CURRENT', 'Loans receivable', 'BALANCE_SHEET', 'NON_CURRENT_ASSETS', 'ASSET', 'INVESTING', true, 130),
  DEFERRED_TAX_ASSET: meta('DEFERRED_TAX_ASSET', 'Deferred tax asset', 'BALANCE_SHEET', 'NON_CURRENT_ASSETS', 'ASSET', 'TAXATION', true, 140),

  INVENTORIES: meta('INVENTORIES', 'Inventories', 'BALANCE_SHEET', 'CURRENT_ASSETS', 'ASSET', 'WORKING_CAPITAL', true, 200),
  TRADE_RECEIVABLES: meta('TRADE_RECEIVABLES', 'Trade and other receivables', 'BALANCE_SHEET', 'CURRENT_ASSETS', 'ASSET', 'WORKING_CAPITAL', true, 210, 'DEBTORS'),
  OTHER_RECEIVABLES: meta('OTHER_RECEIVABLES', 'Other receivables', 'BALANCE_SHEET', 'CURRENT_ASSETS', 'ASSET', 'WORKING_CAPITAL', true, 220),
  PREPAYMENTS: meta('PREPAYMENTS', 'Prepayments', 'BALANCE_SHEET', 'CURRENT_ASSETS', 'ASSET', 'WORKING_CAPITAL', true, 230),
  CURRENT_TAX_ASSET: meta('CURRENT_TAX_ASSET', 'Current tax receivable', 'BALANCE_SHEET', 'CURRENT_ASSETS', 'ASSET', 'TAXATION', false, 240),
  CASH_AND_CASH_EQUIVALENTS: meta('CASH_AND_CASH_EQUIVALENTS', 'Cash and cash equivalents', 'BALANCE_SHEET', 'CURRENT_ASSETS', 'ASSET', 'CASH', true, 250),

  SHARE_CAPITAL: meta('SHARE_CAPITAL', 'Share capital', 'BALANCE_SHEET', 'EQUITY', 'EQUITY', 'FINANCING', true, 300),
  SHARE_PREMIUM: meta('SHARE_PREMIUM', 'Share premium', 'BALANCE_SHEET', 'EQUITY', 'EQUITY', 'FINANCING', false, 310),
  OTHER_RESERVES: meta('OTHER_RESERVES', 'Other reserves', 'BALANCE_SHEET', 'EQUITY', 'EQUITY', 'FINANCING', false, 320),
  RETAINED_EARNINGS: meta('RETAINED_EARNINGS', 'Retained earnings', 'BALANCE_SHEET', 'EQUITY', 'EQUITY', 'PROFIT', false, 330),
  DIVIDENDS_DECLARED: meta('DIVIDENDS_DECLARED', 'Dividends declared', 'BALANCE_SHEET', 'EQUITY', 'EQUITY', 'FINANCING', false, 335),

  LOANS_NON_CURRENT: meta('LOANS_NON_CURRENT', 'Interest bearing borrowings', 'BALANCE_SHEET', 'NON_CURRENT_LIABILITIES', 'LIABILITY', 'FINANCING', true, 400),
  DEFERRED_TAX_LIABILITY: meta('DEFERRED_TAX_LIABILITY', 'Deferred tax liability', 'BALANCE_SHEET', 'NON_CURRENT_LIABILITIES', 'LIABILITY', 'TAXATION', true, 410),
  PROVISIONS_NON_CURRENT: meta('PROVISIONS_NON_CURRENT', 'Provisions', 'BALANCE_SHEET', 'NON_CURRENT_LIABILITIES', 'LIABILITY', 'WORKING_CAPITAL', true, 420),

  BANK_OVERDRAFT: meta('BANK_OVERDRAFT', 'Bank overdraft', 'BALANCE_SHEET', 'CURRENT_LIABILITIES', 'LIABILITY', 'CASH', false, 500),
  TRADE_PAYABLES: meta('TRADE_PAYABLES', 'Trade and other payables', 'BALANCE_SHEET', 'CURRENT_LIABILITIES', 'LIABILITY', 'WORKING_CAPITAL', true, 510, 'CREDITORS'),
  OTHER_PAYABLES: meta('OTHER_PAYABLES', 'Other payables', 'BALANCE_SHEET', 'CURRENT_LIABILITIES', 'LIABILITY', 'WORKING_CAPITAL', true, 520),
  ACCRUALS: meta('ACCRUALS', 'Accruals', 'BALANCE_SHEET', 'CURRENT_LIABILITIES', 'LIABILITY', 'WORKING_CAPITAL', true, 530),
  CURRENT_TAX_LIABILITY: meta('CURRENT_TAX_LIABILITY', 'Current tax payable', 'BALANCE_SHEET', 'CURRENT_LIABILITIES', 'LIABILITY', 'TAXATION', false, 540),
  LOANS_CURRENT: meta('LOANS_CURRENT', 'Current portion of borrowings', 'BALANCE_SHEET', 'CURRENT_LIABILITIES', 'LIABILITY', 'FINANCING', false, 550),
  PROVISIONS_CURRENT: meta('PROVISIONS_CURRENT', 'Provisions', 'BALANCE_SHEET', 'CURRENT_LIABILITIES', 'LIABILITY', 'WORKING_CAPITAL', true, 560),

  REVENUE: meta('REVENUE', 'Revenue', 'INCOME_STATEMENT', 'REVENUE', 'INCOME', 'NONE', true, 600),
  COST_OF_SALES: meta('COST_OF_SALES', 'Cost of sales', 'INCOME_STATEMENT', 'COST_OF_SALES', 'EXPENSE', 'NONE', true, 610),
  OTHER_INCOME: meta('OTHER_INCOME', 'Other income', 'INCOME_STATEMENT', 'OTHER_INCOME', 'INCOME', 'NONE', true, 620),
  DISTRIBUTION_COSTS: meta('DISTRIBUTION_COSTS', 'Distribution costs', 'INCOME_STATEMENT', 'OPERATING_EXPENSES', 'EXPENSE', 'NONE', true, 630),
  ADMINISTRATIVE_EXPENSES: meta('ADMINISTRATIVE_EXPENSES', 'Administrative expenses', 'INCOME_STATEMENT', 'OPERATING_EXPENSES', 'EXPENSE', 'NONE', true, 640),
  OTHER_OPERATING_EXPENSES: meta('OTHER_OPERATING_EXPENSES', 'Other operating expenses', 'INCOME_STATEMENT', 'OPERATING_EXPENSES', 'EXPENSE', 'NONE', true, 650),
  DEPRECIATION_AMORTISATION: meta('DEPRECIATION_AMORTISATION', 'Depreciation and amortisation', 'INCOME_STATEMENT', 'OPERATING_EXPENSES', 'EXPENSE', 'NON_CASH_ADDBACK', true, 660),
  FINANCE_INCOME: meta('FINANCE_INCOME', 'Finance income', 'INCOME_STATEMENT', 'FINANCE', 'INCOME', 'INTEREST_RECEIVED', true, 670),
  FINANCE_COSTS: meta('FINANCE_COSTS', 'Finance costs', 'INCOME_STATEMENT', 'FINANCE', 'EXPENSE', 'INTEREST_PAID', true, 680),
  INCOME_TAX_EXPENSE: meta('INCOME_TAX_EXPENSE', 'Income tax expense', 'INCOME_STATEMENT', 'TAXATION', 'EXPENSE', 'TAXATION', true, 690),
};

export const SECTIONS_IN_ORDER: SectionMeta[] = Object.values(SECTION_META).sort(
  (a, b) => a.order - b.order,
);

export function sectionsForGroup(group: StatementGroup): SectionMeta[] {
  return SECTIONS_IN_ORDER.filter((s) => s.group === group);
}

export function sectionsForStatement(statement: Statement): SectionMeta[] {
  return SECTIONS_IN_ORDER.filter((s) => s.statement === statement);
}

export function isBalanceSheetSection(section: StatementSection): boolean {
  return SECTION_META[section].statement === 'BALANCE_SHEET';
}

export function isIncomeStatementSection(section: StatementSection): boolean {
  return SECTION_META[section].statement === 'INCOME_STATEMENT';
}

export const GROUP_LABELS: Record<StatementGroup, string> = {
  NON_CURRENT_ASSETS: 'Non-current assets',
  CURRENT_ASSETS: 'Current assets',
  EQUITY: 'Equity',
  NON_CURRENT_LIABILITIES: 'Non-current liabilities',
  CURRENT_LIABILITIES: 'Current liabilities',
  REVENUE: 'Revenue',
  COST_OF_SALES: 'Cost of sales',
  OTHER_INCOME: 'Other income',
  OPERATING_EXPENSES: 'Operating expenses',
  FINANCE: 'Finance income and costs',
  TAXATION: 'Taxation',
};

/** Guard for untrusted input (an Excel column, a JSON body). */
export function isStatementSection(value: unknown): value is StatementSection {
  return typeof value === 'string' && value in SECTION_META;
}

export function isAccountType(value: unknown): value is AccountType {
  return typeof value === 'string' && (ACCOUNT_TYPES as readonly string[]).includes(value);
}
