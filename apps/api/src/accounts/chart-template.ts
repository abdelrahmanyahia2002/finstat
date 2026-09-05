import type { AccountType, StatementSection } from '@finstat/shared';

export interface ChartTemplateAccount {
  code: string;
  name: string;
  type: AccountType;
  section: StatementSection;
}

/**
 * A starting chart of accounts.
 *
 * Every line is already mapped to a reporting category, so a company created
 * from this template produces a complete set of statements the moment figures
 * are entered. Users are free to rename, delete or extend anything here.
 */
export const STANDARD_CHART: ChartTemplateAccount[] = [
  // ---- Non-current assets ----
  { code: '1000', name: 'Land and buildings', type: 'ASSET', section: 'PROPERTY_PLANT_EQUIPMENT' },
  { code: '1010', name: 'Plant and machinery', type: 'ASSET', section: 'PROPERTY_PLANT_EQUIPMENT' },
  { code: '1020', name: 'Motor vehicles', type: 'ASSET', section: 'PROPERTY_PLANT_EQUIPMENT' },
  { code: '1030', name: 'Office equipment', type: 'ASSET', section: 'PROPERTY_PLANT_EQUIPMENT' },
  { code: '1040', name: 'Computer equipment', type: 'ASSET', section: 'PROPERTY_PLANT_EQUIPMENT' },
  { code: '1050', name: 'Accumulated depreciation', type: 'ASSET', section: 'PROPERTY_PLANT_EQUIPMENT' },
  { code: '1100', name: 'Goodwill', type: 'ASSET', section: 'INTANGIBLE_ASSETS' },
  { code: '1110', name: 'Software and licences', type: 'ASSET', section: 'INTANGIBLE_ASSETS' },
  { code: '1200', name: 'Investments', type: 'ASSET', section: 'INVESTMENTS_NON_CURRENT' },
  { code: '1250', name: 'Loans receivable', type: 'ASSET', section: 'LOANS_RECEIVABLE_NON_CURRENT' },
  { code: '1290', name: 'Deferred tax asset', type: 'ASSET', section: 'DEFERRED_TAX_ASSET' },

  // ---- Current assets ----
  { code: '1300', name: 'Inventory', type: 'ASSET', section: 'INVENTORIES' },
  { code: '1310', name: 'Work in progress', type: 'ASSET', section: 'INVENTORIES' },
  { code: '1400', name: 'Trade receivables control', type: 'ASSET', section: 'TRADE_RECEIVABLES' },
  { code: '1410', name: 'Provision for doubtful debts', type: 'ASSET', section: 'TRADE_RECEIVABLES' },
  { code: '1450', name: 'Other receivables', type: 'ASSET', section: 'OTHER_RECEIVABLES' },
  { code: '1460', name: 'Deposits paid', type: 'ASSET', section: 'OTHER_RECEIVABLES' },
  { code: '1470', name: 'Prepaid expenses', type: 'ASSET', section: 'PREPAYMENTS' },
  { code: '1480', name: 'Current tax receivable', type: 'ASSET', section: 'CURRENT_TAX_ASSET' },
  { code: '1500', name: 'Bank current account', type: 'ASSET', section: 'CASH_AND_CASH_EQUIVALENTS' },
  { code: '1510', name: 'Bank call account', type: 'ASSET', section: 'CASH_AND_CASH_EQUIVALENTS' },
  { code: '1520', name: 'Petty cash', type: 'ASSET', section: 'CASH_AND_CASH_EQUIVALENTS' },

  // ---- Equity ----
  { code: '2000', name: 'Share capital', type: 'EQUITY', section: 'SHARE_CAPITAL' },
  { code: '2010', name: 'Share premium', type: 'EQUITY', section: 'SHARE_PREMIUM' },
  { code: '2050', name: 'Revaluation reserve', type: 'EQUITY', section: 'OTHER_RESERVES' },
  { code: '2100', name: 'Retained earnings', type: 'EQUITY', section: 'RETAINED_EARNINGS' },
  { code: '2150', name: 'Dividends declared', type: 'EQUITY', section: 'DIVIDENDS_DECLARED' },

  // ---- Non-current liabilities ----
  { code: '2500', name: 'Long term borrowings', type: 'LIABILITY', section: 'LOANS_NON_CURRENT' },
  { code: '2510', name: 'Finance lease liability', type: 'LIABILITY', section: 'LOANS_NON_CURRENT' },
  { code: '2550', name: 'Deferred tax liability', type: 'LIABILITY', section: 'DEFERRED_TAX_LIABILITY' },
  { code: '2590', name: 'Long term provisions', type: 'LIABILITY', section: 'PROVISIONS_NON_CURRENT' },

  // ---- Current liabilities ----
  { code: '2600', name: 'Bank overdraft', type: 'LIABILITY', section: 'BANK_OVERDRAFT' },
  { code: '2700', name: 'Trade payables control', type: 'LIABILITY', section: 'TRADE_PAYABLES' },
  { code: '2750', name: 'Other payables', type: 'LIABILITY', section: 'OTHER_PAYABLES' },
  { code: '2760', name: 'Payroll liabilities', type: 'LIABILITY', section: 'OTHER_PAYABLES' },
  { code: '2770', name: 'Value added tax', type: 'LIABILITY', section: 'OTHER_PAYABLES' },
  { code: '2780', name: 'Accrued expenses', type: 'LIABILITY', section: 'ACCRUALS' },
  { code: '2790', name: 'Current tax payable', type: 'LIABILITY', section: 'CURRENT_TAX_LIABILITY' },
  { code: '2800', name: 'Current portion of borrowings', type: 'LIABILITY', section: 'LOANS_CURRENT' },
  { code: '2850', name: 'Short term provisions', type: 'LIABILITY', section: 'PROVISIONS_CURRENT' },

  // ---- Income ----
  { code: '3000', name: 'Sales', type: 'INCOME', section: 'REVENUE' },
  { code: '3010', name: 'Service income', type: 'INCOME', section: 'REVENUE' },
  { code: '3100', name: 'Other income', type: 'INCOME', section: 'OTHER_INCOME' },
  { code: '3110', name: 'Profit on disposal of assets', type: 'INCOME', section: 'OTHER_INCOME' },
  { code: '3200', name: 'Interest received', type: 'INCOME', section: 'FINANCE_INCOME' },

  // ---- Cost of sales ----
  { code: '4000', name: 'Opening inventory', type: 'EXPENSE', section: 'COST_OF_SALES' },
  { code: '4010', name: 'Purchases', type: 'EXPENSE', section: 'COST_OF_SALES' },
  { code: '4020', name: 'Direct labour', type: 'EXPENSE', section: 'COST_OF_SALES' },
  { code: '4030', name: 'Closing inventory', type: 'EXPENSE', section: 'COST_OF_SALES' },

  // ---- Operating expenses ----
  { code: '5000', name: 'Advertising and marketing', type: 'EXPENSE', section: 'DISTRIBUTION_COSTS' },
  { code: '5010', name: 'Delivery and freight', type: 'EXPENSE', section: 'DISTRIBUTION_COSTS' },
  { code: '5100', name: 'Salaries and wages', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5110', name: 'Directors remuneration', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5120', name: 'Rent', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5130', name: 'Insurance', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5140', name: 'Professional fees', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5150', name: 'Audit fees', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5160', name: 'Telephone and internet', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5170', name: 'Utilities', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5180', name: 'Repairs and maintenance', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5190', name: 'Bank charges', type: 'EXPENSE', section: 'ADMINISTRATIVE_EXPENSES' },
  { code: '5200', name: 'Motor vehicle expenses', type: 'EXPENSE', section: 'OTHER_OPERATING_EXPENSES' },
  { code: '5210', name: 'Travel and entertainment', type: 'EXPENSE', section: 'OTHER_OPERATING_EXPENSES' },
  { code: '5220', name: 'Bad debts written off', type: 'EXPENSE', section: 'OTHER_OPERATING_EXPENSES' },
  { code: '5300', name: 'Depreciation', type: 'EXPENSE', section: 'DEPRECIATION_AMORTISATION' },
  { code: '5310', name: 'Amortisation', type: 'EXPENSE', section: 'DEPRECIATION_AMORTISATION' },

  // ---- Finance and tax ----
  { code: '6000', name: 'Interest paid', type: 'EXPENSE', section: 'FINANCE_COSTS' },
  { code: '6010', name: 'Finance charges', type: 'EXPENSE', section: 'FINANCE_COSTS' },
  { code: '7000', name: 'Income tax expense', type: 'EXPENSE', section: 'INCOME_TAX_EXPENSE' },
];
