/** Shapes shared between the API and the web app. */

import type { StatementSection, AccountType } from './taxonomy';
import type { PeriodComputation, RenderedStatement, CashFlowTotals } from './statements';
import type { ValidationReport } from './validation';

// ---------------------------------------------------------------------------
// People and access
// ---------------------------------------------------------------------------

export const GLOBAL_ROLES = ['SUPERADMIN', 'USER'] as const;
export type GlobalRole = (typeof GLOBAL_ROLES)[number];

export const COMPANY_ROLES = ['OWNER', 'ADMIN', 'PREPARER', 'REVIEWER', 'VIEWER'] as const;
export type CompanyRole = (typeof COMPANY_ROLES)[number];

/** Ranked lowest to highest; a role covers everything below it. */
export const COMPANY_ROLE_RANK: Record<CompanyRole, number> = {
  VIEWER: 0,
  REVIEWER: 1,
  PREPARER: 2,
  ADMIN: 3,
  OWNER: 4,
};

export function roleAtLeast(role: CompanyRole, required: CompanyRole): boolean {
  return COMPANY_ROLE_RANK[role] >= COMPANY_ROLE_RANK[required];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  globalRole: GlobalRole;
}

export interface SessionResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: AuthUser;
}

// ---------------------------------------------------------------------------
// Company and year
// ---------------------------------------------------------------------------

export const REPORTING_FRAMEWORKS = ['IFRS', 'IFRS_FOR_SMES', 'LOCAL_GAAP', 'OTHER'] as const;
export type ReportingFramework = (typeof REPORTING_FRAMEWORKS)[number];

export interface CompanySummary {
  id: string;
  name: string;
  registrationNumber: string | null;
  currencyCode: string;
  reportingFramework: ReportingFramework;
  isActive: boolean;
  role: CompanyRole;
  financialYearCount: number;
  currentYearLabel: string | null;
}

export const FINANCIAL_YEAR_STATUSES = ['DRAFT', 'OPEN', 'REVIEW', 'LOCKED', 'CLOSED'] as const;
export type FinancialYearStatus = (typeof FINANCIAL_YEAR_STATUSES)[number];

/** A locked or closed year rejects every write to its figures. */
export function isYearEditable(status: FinancialYearStatus): boolean {
  return status === 'DRAFT' || status === 'OPEN' || status === 'REVIEW';
}

export interface FinancialYearSummary {
  id: string;
  companyId: string;
  label: string;
  startDate: string;
  endDate: string;
  status: FinancialYearStatus;
  isCurrent: boolean;
  previousYearId: string | null;
  previousYearLabel: string | null;
  accountCount: number;
  isBalanced: boolean;
}

// ---------------------------------------------------------------------------
// Chart of accounts and balances
// ---------------------------------------------------------------------------

export interface AccountDto {
  id: string;
  companyId: string;
  code: string;
  name: string;
  type: AccountType;
  section: StatementSection | null;
  isActive: boolean;
  sortOrder: number;
  description: string | null;
}

export interface TrialBalanceRowDto {
  accountId: string;
  code: string;
  name: string;
  type: AccountType;
  section: StatementSection | null;
  debit: number;
  credit: number;
  priorDebit: number;
  priorCredit: number;
  /** Where the figure came from, so a preparer can see what is manual. */
  source: BalanceSource;
  updatedAt: string | null;
}

export const BALANCE_SOURCES = ['MANUAL', 'IMPORT', 'PASTE', 'CARRY_FORWARD', 'ADJUSTMENT'] as const;
export type BalanceSource = (typeof BALANCE_SOURCES)[number];

export interface TrialBalanceResponse {
  financialYearId: string;
  rows: TrialBalanceRowDto[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
  isBalanced: boolean;
  priorYearId: string | null;
}

// ---------------------------------------------------------------------------
// Debtors and creditors
// ---------------------------------------------------------------------------

export const PARTY_TYPES = ['DEBTOR', 'CREDITOR'] as const;
export type PartyType = (typeof PARTY_TYPES)[number];

export const AGEING_BUCKETS = ['current', 'days30', 'days60', 'days90', 'days120Plus'] as const;
export type AgeingBucket = (typeof AGEING_BUCKETS)[number];

export const AGEING_LABELS: Record<AgeingBucket, string> = {
  current: 'Current',
  days30: '30 days',
  days60: '60 days',
  days90: '90 days',
  days120Plus: '120 days and over',
};

export interface PartyBalanceDto {
  id: string;
  partyId: string;
  code: string;
  name: string;
  type: PartyType;
  current: number;
  days30: number;
  days60: number;
  days90: number;
  days120Plus: number;
  total: number;
  priorTotal: number;
  notes: string | null;
}

export interface SubledgerResponse {
  type: PartyType;
  rows: PartyBalanceDto[];
  totals: Record<AgeingBucket | 'total', number>;
  controlAccountTotal: number;
  difference: number;
  agrees: boolean;
}

// ---------------------------------------------------------------------------
// Notes
// ---------------------------------------------------------------------------

export const NOTE_KINDS = ['POLICY', 'SECTION', 'FREE_TEXT'] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export interface NoteLineDto {
  id: string;
  label: string;
  currentAmount: number | null;
  priorAmount: number | null;
  isSubtotal: boolean;
  sortOrder: number;
  accountId: string | null;
}

export interface NoteDto {
  id: string;
  financialYearId: string;
  number: number;
  title: string;
  kind: NoteKind;
  section: StatementSection | null;
  body: string | null;
  isSystemGenerated: boolean;
  sortOrder: number;
  lines: NoteLineDto[];
  total: number | null;
  priorTotal: number | null;
  statementAmount: number | null;
  ties: boolean;
}

// ---------------------------------------------------------------------------
// Statements
// ---------------------------------------------------------------------------

export interface StatementsResponse {
  company: { id: string; name: string; currencyCode: string };
  current: PeriodComputation;
  prior: PeriodComputation | null;
  balanceSheet: RenderedStatement;
  incomeStatement: RenderedStatement;
  cashFlow: (RenderedStatement & { totals: CashFlowTotals }) | null;
  validation: ValidationReport;
  noteNumbers: Partial<Record<StatementSection, number>>;
}

// ---------------------------------------------------------------------------
// Jobs, imports and reports
// ---------------------------------------------------------------------------

export const JOB_TYPES = [
  'EXCEL_IMPORT',
  'EXCEL_EXPORT',
  'PDF_REPORT',
  'YEAR_CARRY_FORWARD',
] as const;
export type JobType = (typeof JOB_TYPES)[number];

export const JOB_STATUSES = ['QUEUED', 'PROCESSING', 'COMPLETED', 'FAILED'] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export interface JobDto {
  id: string;
  type: JobType;
  status: JobStatus;
  progress: number;
  message: string | null;
  error: string | null;
  fileName: string | null;
  downloadUrl: string | null;
  createdAt: string;
  completedAt: string | null;
}

export interface ImportPreviewRow {
  rowNumber: number;
  code: string;
  name: string;
  debit: number;
  credit: number;
  section: StatementSection | null;
  action: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR';
  problems: string[];
}

export interface ImportPreview {
  rows: ImportPreviewRow[];
  totalDebit: number;
  totalCredit: number;
  difference: number;
  createCount: number;
  updateCount: number;
  errorCount: number;
  skippedRows: number;
  problems: string[];
}

export const REPORT_KINDS = [
  'FULL_ANNUAL_FINANCIAL_STATEMENTS',
  'BALANCE_SHEET',
  'INCOME_STATEMENT',
  'CASH_FLOW',
  'TRIAL_BALANCE',
  'DEBTORS',
  'CREDITORS',
  'VALIDATION',
] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];

export const REPORT_LABELS: Record<ReportKind, string> = {
  FULL_ANNUAL_FINANCIAL_STATEMENTS: 'Annual financial statements',
  BALANCE_SHEET: 'Statement of financial position',
  INCOME_STATEMENT: 'Statement of profit or loss',
  CASH_FLOW: 'Statement of cash flows',
  TRIAL_BALANCE: 'Trial balance',
  DEBTORS: 'Debtors listing',
  CREDITORS: 'Creditors listing',
  VALIDATION: 'Validation report',
};

// ---------------------------------------------------------------------------
// Settings and audit
// ---------------------------------------------------------------------------

export interface CompanySettings {
  currencyCode: string;
  currencySymbol: string;
  locale: string;
  decimals: number;
  negativeStyle: 'PARENTHESES' | 'MINUS';
  showCents: boolean;
  reportFooter: string | null;
  preparedBy: string | null;
  approvedBy: string | null;
  logoUrl: string | null;
}

export interface AuditLogDto {
  id: string;
  action: string;
  entity: string;
  entityId: string | null;
  summary: string;
  userName: string | null;
  userEmail: string | null;
  createdAt: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
