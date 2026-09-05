/**
 * Clipboard parsing.
 *
 * Accountants live in Excel. Selecting a block of cells there and pasting it
 * into the grid has to work first time, so this parser handles what Excel
 * actually puts on the clipboard: tab separated cells, CRLF row breaks, quoted
 * cells that contain tabs or line breaks, and amounts written every way a
 * spreadsheet might have formatted them.
 *
 * The same parser runs in the browser for the paste-into-grid path and on the
 * API for the bulk paste endpoint, so both agree on what a block of text means.
 */

import { tryParseAmount } from './money';
import { isStatementSection, type StatementSection } from './taxonomy';

/** Split clipboard text into a grid, honouring quoted cells. */
export function splitClipboard(text: string, delimiter?: string): string[][] {
  if (!text) return [];

  const sep = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"' && cell === '') {
      inQuotes = true;
    } else if (char === sep) {
      row.push(cell);
      cell = '';
    } else if (char === '\r') {
      // Swallow; the \n that follows ends the row.
      if (text[i + 1] !== '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      }
    } else if (char === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += char;
    }
  }

  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  // Excel adds a trailing newline; drop the empty row it leaves behind.
  while (rows.length > 0 && rows[rows.length - 1].every((c) => c.trim() === '')) {
    rows.pop();
  }

  return rows;
}

export function detectDelimiter(text: string): string {
  const sample = text.slice(0, 4000);
  const tabs = (sample.match(/\t/g) ?? []).length;
  const semis = (sample.match(/;/g) ?? []).length;
  const commas = (sample.match(/,/g) ?? []).length;
  if (tabs >= semis && tabs >= commas) return '\t';
  if (semis >= commas) return ';';
  return ',';
}

export type PasteField = 'code' | 'name' | 'debit' | 'credit' | 'amount' | 'section' | 'ignore';

export type ColumnMap = Record<number, PasteField>;

const HEADER_PATTERNS: Array<{ field: PasteField; patterns: RegExp[] }> = [
  { field: 'code', patterns: [/^(account\s*)?(code|no\.?|number|ref)$/i, /^gl\s*(code|account)$/i] },
  {
    field: 'name',
    patterns: [/^(account\s*)?(name|description|title)$/i, /^details?$/i, /^particulars$/i],
  },
  { field: 'debit', patterns: [/^d(e)?b(it)?s?$/i, /^dr\.?$/i] },
  { field: 'credit', patterns: [/^c(re)?d(it)?s?$/i, /^cr\.?$/i] },
  { field: 'amount', patterns: [/^(balance|amount|net|value|total)$/i, /^closing\s*balance$/i] },
  { field: 'section', patterns: [/^(section|category|mapping|classification|fs\s*line)$/i] },
];

function matchHeader(cell: string): PasteField | null {
  const text = cell.trim();
  if (text === '') return null;
  for (const { field, patterns } of HEADER_PATTERNS) {
    if (patterns.some((p) => p.test(text))) return field;
  }
  return null;
}

/**
 * A short non-negative whole number with no decimal separator: what a general
 * ledger code looks like, and what an amount almost never looks like.
 */
function looksLikeAccountCode(value: string): boolean {
  const text = value.trim();
  return /^\d{1,8}$/.test(text);
}

/**
 * Labels a summary row uses. Only consulted when the row has no account code,
 * so a real account genuinely called "Total deposits" still imports.
 */
function isTotalsLabel(name: string): boolean {
  return /^(sub\s*)?totals?$|^grand\s+totals?$|^sum$|^balance$|^difference$|^out\s+of\s+balance(\s+by)?$/i.test(
    name.trim(),
  );
}

/** True when the row reads like column headings rather than data. */
export function looksLikeHeader(row: string[]): boolean {
  const nonEmpty = row.filter((c) => c.trim() !== '');
  if (nonEmpty.length === 0) return false;
  const named = nonEmpty.filter((c) => matchHeader(c) !== null).length;
  const numeric = nonEmpty.filter((c) => tryParseAmount(c) !== null).length;
  return named >= 2 || (named >= 1 && numeric === 0);
}

export function detectColumns(rows: string[][]): { map: ColumnMap; headerRowIndex: number | null } {
  if (rows.length === 0) return { map: {}, headerRowIndex: null };

  const first = rows[0];
  if (looksLikeHeader(first)) {
    const map: ColumnMap = {};
    first.forEach((cell, index) => {
      map[index] = matchHeader(cell) ?? 'ignore';
    });
    return { map, headerRowIndex: 0 };
  }

  // No headings. Fall back to shape: code, name, then the amount columns.
  const map: ColumnMap = {};
  const sampleRows = rows.slice(0, 20);
  const columnCount = Math.max(...rows.map((r) => r.length));
  const numericColumns: number[] = [];
  const codeLike = new Set<number>();

  for (let col = 0; col < columnCount; col += 1) {
    const values = sampleRows.map((r) => r[col] ?? '').filter((v) => v.trim() !== '');
    if (values.length === 0) {
      map[col] = 'ignore';
      continue;
    }
    const numeric = values.filter((v) => tryParseAmount(v) !== null).length;
    if (numeric / values.length >= 0.8) {
      numericColumns.push(col);
      if (values.every(looksLikeAccountCode)) codeLike.add(col);
    }
  }

  // An account code parses as a number, so the leading column of a ledger
  // export looks numeric too. Only the leftmost column is ever a code, and only
  // when there is another numeric column left to carry the amounts. Whole
  // rand or dollar amounts elsewhere in the row stay amounts.
  let amountColumns = numericColumns;
  if (numericColumns.length >= 2 && numericColumns[0] === 0 && codeLike.has(0)) {
    amountColumns = numericColumns.slice(1);
  }

  // Extra numeric columns are usually last year's figures. Take the first two.
  const chosenAmounts = amountColumns.slice(0, 2);

  let assignedCode = false;
  let assignedName = false;
  for (let col = 0; col < columnCount; col += 1) {
    if (chosenAmounts.includes(col)) continue;
    if (!assignedCode) {
      map[col] = 'code';
      assignedCode = true;
    } else if (!assignedName) {
      map[col] = 'name';
      assignedName = true;
    } else {
      map[col] = 'ignore';
    }
  }

  if (chosenAmounts.length >= 2) {
    map[chosenAmounts[0]] = 'debit';
    map[chosenAmounts[1]] = 'credit';
  } else if (chosenAmounts.length === 1) {
    map[chosenAmounts[0]] = 'amount';
  }

  return { map, headerRowIndex: null };
}

export interface ParsedPasteRow {
  /** 1-based, counting the rows the user actually pasted. */
  rowNumber: number;
  code: string;
  name: string;
  debit: number;
  credit: number;
  section: StatementSection | null;
  raw: string[];
  problems: string[];
}

export interface PasteResult {
  rows: ParsedPasteRow[];
  columnMap: ColumnMap;
  headerRowIndex: number | null;
  skippedRows: number;
  totalDebit: number;
  totalCredit: number;
  problems: string[];
}

export interface PasteOptions {
  /** Override the detected column mapping. */
  columnMap?: ColumnMap;
  delimiter?: string;
  /**
   * With a single amount column, which side a positive number means.
   * Debit-positive is the near-universal export convention.
   */
  amountSign?: 'DEBIT_POSITIVE' | 'CREDIT_POSITIVE';
}

export function parsePastedTrialBalance(text: string, options: PasteOptions = {}): PasteResult {
  const grid = splitClipboard(text, options.delimiter);
  const detection = detectColumns(grid);
  const columnMap = options.columnMap ?? detection.map;
  const headerRowIndex = options.columnMap ? null : detection.headerRowIndex;
  const amountSign = options.amountSign ?? 'DEBIT_POSITIVE';

  const problems: string[] = [];
  const fields = new Set(Object.values(columnMap));
  if (!fields.has('code') && !fields.has('name')) {
    problems.push('No account code or name column was found. Map the columns and try again.');
  }
  if (!fields.has('debit') && !fields.has('credit') && !fields.has('amount')) {
    problems.push('No amount column was found. Map the columns and try again.');
  }

  const rows: ParsedPasteRow[] = [];
  let skippedRows = 0;
  let totalDebitCents = 0;
  let totalCreditCents = 0;

  const dataRows = headerRowIndex === null ? grid : grid.slice(headerRowIndex + 1);

  dataRows.forEach((raw, index) => {
    if (raw.every((c) => c.trim() === '')) {
      skippedRows += 1;
      return;
    }

    const get = (field: PasteField): string => {
      const entry = Object.entries(columnMap).find(([, f]) => f === field);
      if (!entry) return '';
      return (raw[Number(entry[0])] ?? '').trim();
    };

    const rowProblems: string[] = [];
    const code = get('code');
    const name = get('name');

    let debit = 0;
    let credit = 0;

    if (fields.has('amount')) {
      const parsed = tryParseAmount(get('amount'));
      if (parsed === null && get('amount') !== '') {
        rowProblems.push(`Could not read the amount "${get('amount')}".`);
      }
      const value = parsed ?? 0;
      const debitPositive = amountSign === 'DEBIT_POSITIVE';
      if (value >= 0) {
        if (debitPositive) debit = value;
        else credit = value;
      } else {
        if (debitPositive) credit = Math.abs(value);
        else debit = Math.abs(value);
      }
    } else {
      const debitText = get('debit');
      const creditText = get('credit');
      const parsedDebit = tryParseAmount(debitText);
      const parsedCredit = tryParseAmount(creditText);
      if (parsedDebit === null && debitText !== '') {
        rowProblems.push(`Could not read the debit "${debitText}".`);
      }
      if (parsedCredit === null && creditText !== '') {
        rowProblems.push(`Could not read the credit "${creditText}".`);
      }
      debit = parsedDebit ?? 0;
      credit = parsedCredit ?? 0;

      // A negative debit is a credit, and the other way round.
      if (debit < 0) {
        credit += Math.abs(debit);
        debit = 0;
      }
      if (credit < 0) {
        debit += Math.abs(credit);
        credit = 0;
      }
    }

    const sectionText = get('section');
    let section: StatementSection | null = null;
    if (sectionText !== '') {
      const normalised = sectionText.trim().toUpperCase().replace(/[\s-]+/g, '_');
      if (isStatementSection(normalised)) {
        section = normalised;
      } else {
        rowProblems.push(`"${sectionText}" is not a known reporting category.`);
      }
    }

    if (code === '' && name === '') {
      skippedRows += 1;
      return;
    }

    // A totals line carries no account code. Exported sheets and hand kept
    // spreadsheets both end in one, and importing it would double the figures
    // it is summarising.
    if (code === '' && isTotalsLabel(name)) {
      skippedRows += 1;
      return;
    }

    totalDebitCents += Math.round(debit * 100);
    totalCreditCents += Math.round(credit * 100);

    rows.push({
      rowNumber: index + 1,
      code,
      name,
      debit,
      credit,
      section,
      raw,
      problems: rowProblems,
    });
  });

  return {
    rows,
    columnMap,
    headerRowIndex,
    skippedRows,
    totalDebit: totalDebitCents / 100,
    totalCredit: totalCreditCents / 100,
    problems,
  };
}

/** Turn a grid back into clipboard text, for copy out of the app. */
export function toClipboardText(rows: Array<Array<string | number | null>>): string {
  return rows
    .map((row) =>
      row
        .map((cell) => {
          const text = cell === null || cell === undefined ? '' : String(cell);
          return /[\t\n\r"]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join('\t'),
    )
    .join('\r\n');
}
