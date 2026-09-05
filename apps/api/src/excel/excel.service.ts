import { BadRequestException, Injectable } from '@nestjs/common';
import * as ExcelJS from 'exceljs';
import {
  GROUP_LABELS,
  SECTIONS_IN_ORDER,
  formatAmount,
  toClipboardText,
  type NoteDto,
  type RenderedStatement,
  type StatementsResponse,
  type SubledgerResponse,
  type TrialBalanceResponse,
  type ValidationReport,
} from '@finstat/shared';

const MONEY_FORMAT = '#,##0.00;(#,##0.00)';
const HEADER_FILL: ExcelJS.Fill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F2A44' },
};

@Injectable()
export class ExcelService {
  // ---- Export ----------------------------------------------------------

  /** The trial balance, with last year alongside, ready to work in. */
  async buildTrialBalanceWorkbook(
    companyName: string,
    yearLabel: string,
    trialBalance: TrialBalanceResponse,
  ): Promise<Buffer> {
    const workbook = this.newWorkbook(companyName);
    const sheet = workbook.addWorksheet('Trial balance', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    this.addTitle(sheet, companyName, `Trial balance — ${yearLabel}`, 8);

    const header = sheet.addRow([
      'Code',
      'Account name',
      'Type',
      'Reporting category',
      'Debit',
      'Credit',
      'Prior debit',
      'Prior credit',
    ]);
    this.styleHeader(header);

    for (const row of trialBalance.rows) {
      const added = sheet.addRow([
        row.code,
        row.name,
        row.type,
        row.section ?? '',
        row.debit || null,
        row.credit || null,
        row.priorDebit || null,
        row.priorCredit || null,
      ]);
      for (const col of [5, 6, 7, 8]) {
        added.getCell(col).numFmt = MONEY_FORMAT;
      }
      if (!row.section) {
        // An unmapped account appears in no statement; make that impossible to miss.
        added.getCell(4).fill = {
          type: 'pattern',
          pattern: 'solid',
          fgColor: { argb: 'FFFFE0E0' },
        };
      }
    }

    const totals = sheet.addRow([
      '',
      'Totals',
      '',
      '',
      trialBalance.totalDebit,
      trialBalance.totalCredit,
      null,
      null,
    ]);
    totals.font = { bold: true };
    totals.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    for (const col of [5, 6]) totals.getCell(col).numFmt = MONEY_FORMAT;

    if (!trialBalance.isBalanced) {
      const diff = sheet.addRow(['', 'Out of balance by', '', '', trialBalance.difference]);
      diff.font = { bold: true, color: { argb: 'FFB00020' } };
      diff.getCell(5).numFmt = MONEY_FORMAT;
    }

    this.autoWidth(sheet, [12, 42, 12, 30, 16, 16, 16, 16]);
    this.addSectionReferenceSheet(workbook);

    return this.toBuffer(workbook);
  }

  /** The full pack: statements, notes, the trial balance behind them, and the checks. */
  async buildStatementsWorkbook(
    statements: StatementsResponse,
    trialBalance: TrialBalanceResponse,
    notes: NoteDto[],
    subledgers: { debtors: SubledgerResponse; creditors: SubledgerResponse },
  ): Promise<Buffer> {
    const workbook = this.newWorkbook(statements.company.name);

    this.addStatementSheet(workbook, 'Balance sheet', statements.balanceSheet);
    this.addStatementSheet(workbook, 'Profit and loss', statements.incomeStatement);
    if (statements.cashFlow) {
      this.addStatementSheet(workbook, 'Cash flow', statements.cashFlow);
    }
    this.addNotesSheet(workbook, statements.company.name, notes);
    this.addSubledgerSheet(workbook, 'Debtors', subledgers.debtors);
    this.addSubledgerSheet(workbook, 'Creditors', subledgers.creditors);
    this.addTrialBalanceSheet(workbook, trialBalance);
    this.addValidationSheet(workbook, statements.validation);

    return this.toBuffer(workbook);
  }

  /** An empty workbook shaped the way the importer expects. */
  async buildImportTemplate(companyName: string): Promise<Buffer> {
    const workbook = this.newWorkbook(companyName);
    const sheet = workbook.addWorksheet('Trial balance', {
      views: [{ state: 'frozen', ySplit: 4 }],
    });

    this.addTitle(sheet, companyName, 'Trial balance import template', 5);
    const header = sheet.addRow(['Code', 'Account name', 'Reporting category', 'Debit', 'Credit']);
    this.styleHeader(header);

    const examples = [
      ['1500', 'Bank current account', 'CASH_AND_CASH_EQUIVALENTS', 125000, null],
      ['2700', 'Trade payables control', 'TRADE_PAYABLES', null, 84000],
      ['3000', 'Sales', 'REVENUE', null, 950000],
    ];
    for (const example of examples) {
      const row = sheet.addRow(example);
      row.font = { italic: true, color: { argb: 'FF8A8A8A' } };
      row.getCell(4).numFmt = MONEY_FORMAT;
      row.getCell(5).numFmt = MONEY_FORMAT;
    }

    const guidance = sheet.addRow([]);
    sheet.addRow(['Delete the three grey example rows before importing.']);
    sheet.addRow([
      'The reporting category column is only needed for accounts that are not on the chart yet.',
    ]);
    sheet.addRow(['Valid categories are listed on the Reporting categories sheet.']);
    guidance.font = { italic: true };

    this.autoWidth(sheet, [12, 42, 32, 16, 16]);
    this.addSectionReferenceSheet(workbook);

    return this.toBuffer(workbook);
  }

  // ---- Import ----------------------------------------------------------

  /**
   * Read an uploaded workbook into the same tab separated form a clipboard
   * paste produces, so importing a file and pasting a block go through one
   * parser and can never disagree about what a row means.
   */
  async workbookToText(buffer: Buffer, sheetName?: string): Promise<string> {
    const workbook = new ExcelJS.Workbook();
    try {
      await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    } catch {
      throw new BadRequestException('That file could not be read as an Excel workbook.');
    }

    const sheet = sheetName
      ? workbook.getWorksheet(sheetName)
      : workbook.worksheets.find((w) => w.rowCount > 0);

    if (!sheet) {
      throw new BadRequestException(
        sheetName ? `The workbook has no sheet called ${sheetName}.` : 'That workbook is empty.',
      );
    }

    const grid: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      const cells: string[] = [];
      const count = Math.max(row.cellCount, row.actualCellCount);
      for (let col = 1; col <= count; col += 1) {
        cells.push(cellToText(row.getCell(col)));
      }
      if (cells.some((c) => c.trim() !== '')) grid.push(cells);
    });

    if (grid.length === 0) {
      throw new BadRequestException('That sheet had no rows in it.');
    }

    return toClipboardText(grid);
  }

  listSheetNames(buffer: Buffer): Promise<string[]> {
    const workbook = new ExcelJS.Workbook();
    return workbook.xlsx
      .load(buffer as unknown as ArrayBuffer)
      .then(() => workbook.worksheets.map((w) => w.name));
  }

  // ---- Sheet builders --------------------------------------------------

  private addStatementSheet(
    workbook: ExcelJS.Workbook,
    name: string,
    statement: RenderedStatement,
  ): void {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });
    this.addTitle(sheet, statement.title, statement.subtitle, 4);

    const header = sheet.addRow([
      '',
      'Note',
      statement.currentLabel,
      statement.priorLabel ?? '',
    ]);
    this.styleHeader(header);

    for (const line of statement.lines) {
      if (line.style === 'SPACER') {
        sheet.addRow([]);
        continue;
      }

      const row = sheet.addRow([
        `${'    '.repeat(line.indent)}${line.label}`,
        line.noteNumber ?? '',
        line.current,
        line.prior,
      ]);

      row.getCell(3).numFmt = MONEY_FORMAT;
      row.getCell(4).numFmt = MONEY_FORMAT;

      if (line.style === 'HEADING') row.font = { bold: true };
      if (line.style === 'SUBTOTAL') {
        row.font = { bold: true };
        row.border = { top: { style: 'thin' } };
      }
      if (line.style === 'TOTAL') {
        row.font = { bold: true };
        row.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
      }
      if (line.style === 'DETAIL') {
        row.font = { color: { argb: 'FF666666' } };
      }
    }

    this.autoWidth(sheet, [52, 8, 18, 18]);
  }

  private addNotesSheet(workbook: ExcelJS.Workbook, companyName: string, notes: NoteDto[]): void {
    const sheet = workbook.addWorksheet('Notes');
    this.addTitle(sheet, 'Notes to the financial statements', companyName, 4);

    for (const note of notes) {
      const heading = sheet.addRow([`${note.number}. ${note.title}`]);
      heading.font = { bold: true, size: 12 };

      if (note.body) {
        const body = sheet.addRow([note.body]);
        body.alignment = { wrapText: true, vertical: 'top' };
        sheet.mergeCells(body.number, 1, body.number, 4);
        body.height = Math.min(120, 15 * Math.ceil(note.body.length / 90));
      }

      if (note.lines.length > 0) {
        const header = sheet.addRow(['', '', 'Current', 'Prior']);
        header.font = { bold: true };
        for (const line of note.lines) {
          const row = sheet.addRow(['', line.label, line.currentAmount, line.priorAmount]);
          row.getCell(3).numFmt = MONEY_FORMAT;
          row.getCell(4).numFmt = MONEY_FORMAT;
          if (line.isSubtotal) {
            row.font = { bold: true };
            row.border = { top: { style: 'thin' } };
          }
        }
        if (note.total !== null) {
          const total = sheet.addRow(['', 'Total', note.total, note.priorTotal]);
          total.font = { bold: true };
          total.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
          total.getCell(3).numFmt = MONEY_FORMAT;
          total.getCell(4).numFmt = MONEY_FORMAT;

          if (!note.ties) {
            const warn = sheet.addRow([
              '',
              `Does not agree to the statements (${formatAmount(note.statementAmount ?? 0)})`,
            ]);
            warn.font = { color: { argb: 'FFB00020' }, italic: true };
          }
        }
      }

      sheet.addRow([]);
    }

    this.autoWidth(sheet, [6, 52, 18, 18]);
  }

  private addSubledgerSheet(
    workbook: ExcelJS.Workbook,
    name: string,
    subledger: SubledgerResponse,
  ): void {
    const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 4 }] });
    this.addTitle(sheet, `${name} listing`, `Ageing at year end`, 9);

    const header = sheet.addRow([
      'Code',
      'Name',
      'Current',
      '30 days',
      '60 days',
      '90 days',
      '120+ days',
      'Total',
      'Prior total',
    ]);
    this.styleHeader(header);

    for (const row of subledger.rows) {
      const added = sheet.addRow([
        row.code,
        row.name,
        row.current,
        row.days30,
        row.days60,
        row.days90,
        row.days120Plus,
        row.total,
        row.priorTotal,
      ]);
      for (let col = 3; col <= 9; col += 1) added.getCell(col).numFmt = MONEY_FORMAT;
    }

    const totals = sheet.addRow([
      '',
      'Totals',
      subledger.totals.current,
      subledger.totals.days30,
      subledger.totals.days60,
      subledger.totals.days90,
      subledger.totals.days120Plus,
      subledger.totals.total,
      null,
    ]);
    totals.font = { bold: true };
    totals.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    for (let col = 3; col <= 9; col += 1) totals.getCell(col).numFmt = MONEY_FORMAT;

    sheet.addRow([]);
    const control = sheet.addRow(['', 'Control account', '', '', '', '', '', subledger.controlAccountTotal]);
    control.getCell(8).numFmt = MONEY_FORMAT;
    const diff = sheet.addRow(['', 'Difference', '', '', '', '', '', subledger.difference]);
    diff.getCell(8).numFmt = MONEY_FORMAT;
    diff.font = { bold: true, color: { argb: subledger.agrees ? 'FF1B7F3B' : 'FFB00020' } };

    this.autoWidth(sheet, [14, 40, 15, 15, 15, 15, 15, 16, 16]);
  }

  private addTrialBalanceSheet(
    workbook: ExcelJS.Workbook,
    trialBalance: TrialBalanceResponse,
  ): void {
    const sheet = workbook.addWorksheet('Trial balance', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    const header = sheet.addRow([
      'Code',
      'Account name',
      'Type',
      'Reporting category',
      'Debit',
      'Credit',
    ]);
    this.styleHeader(header);

    for (const row of trialBalance.rows) {
      const added = sheet.addRow([
        row.code,
        row.name,
        row.type,
        row.section ?? '',
        row.debit || null,
        row.credit || null,
      ]);
      added.getCell(5).numFmt = MONEY_FORMAT;
      added.getCell(6).numFmt = MONEY_FORMAT;
    }

    const totals = sheet.addRow([
      '',
      'Totals',
      '',
      '',
      trialBalance.totalDebit,
      trialBalance.totalCredit,
    ]);
    totals.font = { bold: true };
    totals.border = { top: { style: 'thin' }, bottom: { style: 'double' } };
    totals.getCell(5).numFmt = MONEY_FORMAT;
    totals.getCell(6).numFmt = MONEY_FORMAT;

    this.autoWidth(sheet, [12, 42, 12, 30, 16, 16]);
  }

  private addValidationSheet(workbook: ExcelJS.Workbook, report: ValidationReport): void {
    const sheet = workbook.addWorksheet('Validation');
    this.addTitle(
      sheet,
      'Validation',
      report.passed
        ? 'Every check passed.'
        : `${report.errorCount} ${report.errorCount === 1 ? 'error' : 'errors'} to resolve.`,
      4,
    );

    const header = sheet.addRow(['Severity', 'Check', 'What was found', 'Amount']);
    this.styleHeader(header);

    if (report.issues.length === 0) {
      sheet.addRow(['', 'Nothing to report', 'All checks passed.', null]);
    }

    for (const issue of report.issues) {
      const row = sheet.addRow([issue.severity, issue.title, issue.detail, issue.amount ?? null]);
      row.getCell(4).numFmt = MONEY_FORMAT;
      row.getCell(3).alignment = { wrapText: true, vertical: 'top' };
      row.getCell(1).font = {
        bold: true,
        color: {
          argb:
            issue.severity === 'ERROR'
              ? 'FFB00020'
              : issue.severity === 'WARNING'
                ? 'FFB26B00'
                : 'FF4A6FA5',
        },
      };
    }

    this.autoWidth(sheet, [12, 40, 70, 16]);
  }

  /** A reference sheet so a preparer can look up a valid category. */
  private addSectionReferenceSheet(workbook: ExcelJS.Workbook): void {
    const sheet = workbook.addWorksheet('Reporting categories');
    const header = sheet.addRow(['Category', 'Shown as', 'Statement', 'Group', 'Account type']);
    this.styleHeader(header);

    for (const meta of SECTIONS_IN_ORDER) {
      sheet.addRow([
        meta.section,
        meta.label,
        meta.statement === 'BALANCE_SHEET' ? 'Balance sheet' : 'Profit and loss',
        GROUP_LABELS[meta.group],
        meta.accountType,
      ]);
    }

    this.autoWidth(sheet, [34, 34, 18, 28, 14]);
  }

  // ---- Small helpers ---------------------------------------------------

  private newWorkbook(creator: string): ExcelJS.Workbook {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = creator;
    workbook.created = new Date();
    return workbook;
  }

  private addTitle(
    sheet: ExcelJS.Worksheet,
    title: string,
    subtitle: string,
    mergeTo: number,
  ): void {
    const titleRow = sheet.addRow([title]);
    titleRow.font = { bold: true, size: 14 };
    sheet.mergeCells(titleRow.number, 1, titleRow.number, mergeTo);

    const subtitleRow = sheet.addRow([subtitle]);
    subtitleRow.font = { size: 10, color: { argb: 'FF666666' } };
    sheet.mergeCells(subtitleRow.number, 1, subtitleRow.number, mergeTo);

    sheet.addRow([]);
  }

  private styleHeader(row: ExcelJS.Row): void {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.eachCell((cell) => {
      cell.fill = HEADER_FILL;
      cell.alignment = { vertical: 'middle' };
    });
  }

  private autoWidth(sheet: ExcelJS.Worksheet, widths: number[]): void {
    widths.forEach((width, index) => {
      sheet.getColumn(index + 1).width = width;
    });
  }

  private async toBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
    const data = await workbook.xlsx.writeBuffer();
    return Buffer.from(data as ArrayBuffer);
  }
}

/**
 * ExcelJS cell values come in several shapes: a number, a date, a formula
 * result, or rich text. Flatten them all to what the cell displays, because
 * that is what the parser downstream expects to see.
 */
function cellToText(cell: ExcelJS.Cell): string {
  const value = cell.value;
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (value instanceof Date) return value.toISOString().slice(0, 10);

  if (typeof value === 'object') {
    if ('result' in value && value.result !== undefined) return String(value.result ?? '');
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join('');
    }
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('error' in value) return '';
  }

  return String(value);
}
