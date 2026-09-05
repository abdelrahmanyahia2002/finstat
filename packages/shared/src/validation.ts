/**
 * Financial validation.
 *
 * These are the checks a reviewer would run by hand before signing anything
 * off. They never change a number: they report what does not tie, with the
 * amount, so the preparer can go and fix the source.
 */

import { difference, formatAmount, isZero } from './money';
import { SECTION_META, type StatementSection } from './taxonomy';
import type { PeriodComputation } from './statements';
import { computeCashFlow, netCash } from './statements';

export const VALIDATION_CODES = [
  'TRIAL_BALANCE_BALANCED',
  'BALANCE_SHEET_BALANCED',
  'ACCOUNTS_MAPPED',
  'DUPLICATE_ACCOUNT_CODES',
  'DEBTORS_CONTROL_AGREES',
  'CREDITORS_CONTROL_AGREES',
  'DEBTOR_AGEING_TOTALS',
  'CREDITOR_AGEING_TOTALS',
  'OPENING_RETAINED_EARNINGS',
  'COMPARATIVES_PRESENT',
  'CASH_FLOW_RECONCILES',
  'NOTES_TIE_TO_STATEMENTS',
  'UNUSUAL_ACCOUNT_SIGN',
  'NEGATIVE_CASH',
  'EMPTY_TRIAL_BALANCE',
] as const;
export type ValidationCode = (typeof VALIDATION_CODES)[number];

export type Severity = 'ERROR' | 'WARNING' | 'INFO';

export interface ValidationIssue {
  code: ValidationCode;
  severity: Severity;
  title: string;
  detail: string;
  amount?: number;
  entityType?: 'ACCOUNT' | 'PARTY' | 'NOTE' | 'FINANCIAL_YEAR';
  entityId?: string;
  entityLabel?: string;
}

export interface ValidationReport {
  issues: ValidationIssue[];
  errorCount: number;
  warningCount: number;
  infoCount: number;
  /** True when nothing is at ERROR severity. Warnings do not block. */
  passed: boolean;
  checkedAt: string;
}

export interface SubledgerTotals {
  /** Sum of every debtor balance captured for the year. */
  debtors: number;
  /** Sum of every creditor balance captured for the year. */
  creditors: number;
  /** Parties whose ageing buckets do not add up to their stated balance. */
  ageingMismatches: Array<{
    partyId: string;
    partyName: string;
    type: 'DEBTOR' | 'CREDITOR';
    stated: number;
    bucketed: number;
  }>;
}

export interface NoteTieCheck {
  noteId: string;
  noteNumber: number;
  title: string;
  section: StatementSection | null;
  noteTotal: number;
  statementAmount: number;
}

export interface ValidationInput {
  current: PeriodComputation;
  prior?: PeriodComputation | null;
  accounts: Array<{
    id: string;
    code: string;
    name: string;
    section: StatementSection | null;
    isActive: boolean;
  }>;
  subledger?: SubledgerTotals;
  notes?: NoteTieCheck[];
  currency?: string;
}

function money(value: number, currency?: string): string {
  return formatAmount(value, { currency, accounting: true });
}

function issue(
  code: ValidationCode,
  severity: Severity,
  title: string,
  detail: string,
  extra: Partial<ValidationIssue> = {},
): ValidationIssue {
  return { code, severity, title, detail, ...extra };
}

export function runValidations(input: ValidationInput): ValidationReport {
  const { current, prior, accounts, subledger, notes, currency } = input;
  const issues: ValidationIssue[] = [];

  // ---- The trial balance itself -----------------------------------------
  const accountCount = Object.values(current.sections).reduce(
    (n, s) => n + s.accounts.length,
    0,
  );
  if (accountCount === 0) {
    issues.push(
      issue(
        'EMPTY_TRIAL_BALANCE',
        'ERROR',
        'No trial balance captured',
        'This financial year has no balances yet. Enter them, import a spreadsheet, or carry forward from last year.',
      ),
    );
  }

  if (!current.isTrialBalanceBalanced) {
    issues.push(
      issue(
        'TRIAL_BALANCE_BALANCED',
        'ERROR',
        'Trial balance does not balance',
        `Debits of ${money(current.totalDebits, currency)} against credits of ${money(
          current.totalCredits,
          currency,
        )}, out by ${money(current.trialBalanceDifference, currency)}.`,
        { amount: current.trialBalanceDifference },
      ),
    );
  }

  // ---- The balance sheet -------------------------------------------------
  const bsDiff = current.balanceSheet.balanceDifference;
  if (!isZero(bsDiff)) {
    issues.push(
      issue(
        'BALANCE_SHEET_BALANCED',
        'ERROR',
        'Balance sheet does not balance',
        `Total assets of ${money(current.balanceSheet.totalAssets, currency)} against equity and liabilities of ${money(
          current.balanceSheet.totalEquityAndLiabilities,
          currency,
        )}, out by ${money(bsDiff, currency)}.`,
        { amount: bsDiff },
      ),
    );
  }

  // ---- Chart of accounts hygiene ----------------------------------------
  const unmapped = accounts.filter((a) => a.isActive && !a.section);
  for (const account of unmapped) {
    issues.push(
      issue(
        'ACCOUNTS_MAPPED',
        'ERROR',
        'Account is not mapped to a statement line',
        `${account.code} ${account.name} has no reporting category, so its balance appears in no statement.`,
        { entityType: 'ACCOUNT', entityId: account.id, entityLabel: `${account.code} ${account.name}` },
      ),
    );
  }

  const seen = new Map<string, string>();
  for (const account of accounts) {
    const key = account.code.trim().toUpperCase();
    const existing = seen.get(key);
    if (existing) {
      issues.push(
        issue(
          'DUPLICATE_ACCOUNT_CODES',
          'ERROR',
          'Duplicate account code',
          `Code ${account.code} is used by more than one account.`,
          { entityType: 'ACCOUNT', entityId: account.id, entityLabel: `${account.code} ${account.name}` },
        ),
      );
    } else {
      seen.set(key, account.id);
    }
  }

  // ---- Statement lines sitting on the wrong side -------------------------
  //
  // Checked on the section total rather than account by account. Contra
  // accounts are ordinary bookkeeping: accumulated depreciation sits as a
  // credit inside property, plant and equipment, and a doubtful debt provision
  // sits as a credit inside receivables. Flagging those individually would
  // bury the one case that matters, which is a whole statement line ending up
  // on the side it should never be on.
  //
  // Equity is left out entirely, because accumulated losses and dividends
  // declared are both negative by nature, and cash has its own check below.
  for (const aggregate of Object.values(current.sections)) {
    const meta = SECTION_META[aggregate.section];
    if (meta.accountType === 'EQUITY') continue;
    if (aggregate.section === 'CASH_AND_CASH_EQUIVALENTS') continue;
    if (aggregate.accounts.length === 0) continue;
    if (aggregate.amount >= 0 || isZero(aggregate.amount)) continue;

    issues.push(
      issue(
        'UNUSUAL_ACCOUNT_SIGN',
        'WARNING',
        `${meta.label} is on the unexpected side`,
        `${meta.label} totals ${money(aggregate.amount, currency)}, which is the opposite of what this line normally carries. Check the accounts mapped to it.`,
        { amount: aggregate.amount },
      ),
    );
  }

  const cash = netCash(current);
  if (cash < 0) {
    issues.push(
      issue(
        'NEGATIVE_CASH',
        'WARNING',
        'Net cash is negative',
        `Cash and cash equivalents net to ${money(cash, currency)}. If this is an overdraft, map it to the bank overdraft category.`,
        { amount: cash },
      ),
    );
  }

  // ---- Subledgers against their control accounts -------------------------
  if (subledger) {
    const debtorsControl = current.sections.TRADE_RECEIVABLES.amount;
    const debtorsDiff = difference(debtorsControl, subledger.debtors);
    if (!isZero(debtorsDiff)) {
      issues.push(
        issue(
          'DEBTORS_CONTROL_AGREES',
          'ERROR',
          'Debtors listing does not agree to the control account',
          `Trade receivables in the trial balance are ${money(debtorsControl, currency)} but the debtors listing totals ${money(
            subledger.debtors,
            currency,
          )}, out by ${money(debtorsDiff, currency)}.`,
          { amount: debtorsDiff },
        ),
      );
    }

    const creditorsControl = current.sections.TRADE_PAYABLES.amount;
    const creditorsDiff = difference(creditorsControl, subledger.creditors);
    if (!isZero(creditorsDiff)) {
      issues.push(
        issue(
          'CREDITORS_CONTROL_AGREES',
          'ERROR',
          'Creditors listing does not agree to the control account',
          `Trade payables in the trial balance are ${money(creditorsControl, currency)} but the creditors listing totals ${money(
            subledger.creditors,
            currency,
          )}, out by ${money(creditorsDiff, currency)}.`,
          { amount: creditorsDiff },
        ),
      );
    }

    for (const mismatch of subledger.ageingMismatches) {
      issues.push(
        issue(
          mismatch.type === 'DEBTOR' ? 'DEBTOR_AGEING_TOTALS' : 'CREDITOR_AGEING_TOTALS',
          'WARNING',
          'Ageing buckets do not add up to the balance',
          `${mismatch.partyName} has a balance of ${money(mismatch.stated, currency)} but its ageing buckets total ${money(
            mismatch.bucketed,
            currency,
          )}.`,
          {
            amount: difference(mismatch.stated, mismatch.bucketed),
            entityType: 'PARTY',
            entityId: mismatch.partyId,
            entityLabel: mismatch.partyName,
          },
        ),
      );
    }
  }

  // ---- Comparatives and carry forward ------------------------------------
  if (!prior) {
    issues.push(
      issue(
        'COMPARATIVES_PRESENT',
        'INFO',
        'No comparative year linked',
        'Statements will print a single column and the cash flow statement cannot be produced until a previous year is linked.',
      ),
    );
  } else {
    // Last year's closing retained earnings should be this year's opening figure.
    // Dividends declared during the current year sit in their own account and
    // are not part of the opening balance.
    const expectedOpening = prior.balanceSheet.retainedEarnings;
    const actualOpening = current.sections.RETAINED_EARNINGS.amount;
    const reDiff = difference(actualOpening, expectedOpening);
    if (!isZero(reDiff)) {
      issues.push(
        issue(
          'OPENING_RETAINED_EARNINGS',
          'ERROR',
          'Opening retained earnings do not match last year',
          `Last year closed with retained earnings of ${money(expectedOpening, currency)} but this year opens with ${money(
            actualOpening,
            currency,
          )}, a difference of ${money(reDiff, currency)}.`,
          { amount: reDiff },
        ),
      );
    }

    const cf = computeCashFlow(current, prior);
    if (!isZero(cf.reconciliationDifference)) {
      issues.push(
        issue(
          'CASH_FLOW_RECONCILES',
          'ERROR',
          'Cash flow statement does not reconcile',
          `The computed movement of ${money(cf.netMovement, currency)} does not agree to the actual movement in cash of ${money(
            difference(cf.closingCash, cf.openingCash),
            currency,
          )}, out by ${money(cf.reconciliationDifference, currency)}.`,
          { amount: cf.reconciliationDifference },
        ),
      );
    }
  }

  // ---- Notes against the face of the statements --------------------------
  for (const note of notes ?? []) {
    if (!note.section) continue;
    const diff = difference(note.noteTotal, note.statementAmount);
    if (!isZero(diff)) {
      issues.push(
        issue(
          'NOTES_TIE_TO_STATEMENTS',
          'ERROR',
          'Note does not tie to the statements',
          `Note ${note.noteNumber} (${note.title}) totals ${money(note.noteTotal, currency)} but the statements show ${money(
            note.statementAmount,
            currency,
          )}, out by ${money(diff, currency)}.`,
          { amount: diff, entityType: 'NOTE', entityId: note.noteId, entityLabel: note.title },
        ),
      );
    }
  }

  const errorCount = issues.filter((i) => i.severity === 'ERROR').length;
  const warningCount = issues.filter((i) => i.severity === 'WARNING').length;
  const infoCount = issues.filter((i) => i.severity === 'INFO').length;

  return {
    issues,
    errorCount,
    warningCount,
    infoCount,
    passed: errorCount === 0,
    checkedAt: new Date().toISOString(),
  };
}
