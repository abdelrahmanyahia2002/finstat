import { Injectable } from '@nestjs/common';
import PdfPrinter from 'pdfmake';
import type { Content, TDocumentDefinitions, TableCell } from 'pdfmake/interfaces';
import {
  REPORT_LABELS,
  formatAmount,
  type NoteDto,
  type RenderedStatement,
  type ReportKind,
  type StatementLine,
  type StatementsResponse,
  type SubledgerResponse,
  type TrialBalanceResponse,
  type ValidationReport,
} from '@finstat/shared';

/**
 * The fourteen fonts every PDF reader has built in. Using them means the API
 * ships no font files and a report renders the same everywhere.
 */
const FONTS = {
  Helvetica: {
    normal: 'Helvetica',
    bold: 'Helvetica-Bold',
    italics: 'Helvetica-Oblique',
    bolditalics: 'Helvetica-BoldOblique',
  },
};

const INK = '#1f2a44';
const MUTED = '#6b7280';
const RULE = '#d1d5db';
const DANGER = '#b00020';
const WARN = '#b26b00';

export interface ReportContext {
  kind: ReportKind;
  statements: StatementsResponse;
  trialBalance: TrialBalanceResponse;
  notes: NoteDto[];
  debtors: SubledgerResponse;
  creditors: SubledgerResponse;
  company: {
    name: string;
    registrationNumber: string | null;
    currencyCode: string;
    reportingFramework: string;
    preparedBy: string | null;
    approvedBy: string | null;
    reportFooter: string | null;
  };
  yearLabel: string;
  periodEnd: string;
}

@Injectable()
export class PdfService {
  private readonly printer = new PdfPrinter(FONTS);

  async build(context: ReportContext): Promise<Buffer> {
    const definition = this.definitionFor(context);
    return this.render(definition);
  }

  private definitionFor(context: ReportContext): TDocumentDefinitions {
    const body: Content[] = [];

    switch (context.kind) {
      case 'FULL_ANNUAL_FINANCIAL_STATEMENTS':
        body.push(this.coverPage(context));
        body.push(this.statementTable(context.statements.balanceSheet, context, true));
        body.push(this.statementTable(context.statements.incomeStatement, context, true));
        if (context.statements.cashFlow) {
          body.push(this.statementTable(context.statements.cashFlow, context, true));
        }
        body.push(this.notesSection(context));
        break;
      case 'BALANCE_SHEET':
        body.push(this.statementTable(context.statements.balanceSheet, context, false));
        break;
      case 'INCOME_STATEMENT':
        body.push(this.statementTable(context.statements.incomeStatement, context, false));
        break;
      case 'CASH_FLOW':
        body.push(
          context.statements.cashFlow
            ? this.statementTable(context.statements.cashFlow, context, false)
            : this.notice(
                'No cash flow statement',
                'A cash flow statement needs a comparative year. Link a previous year to this one and it will appear.',
              ),
        );
        break;
      case 'TRIAL_BALANCE':
        body.push(this.trialBalanceTable(context));
        break;
      case 'DEBTORS':
        body.push(this.subledgerTable('Debtors listing', context.debtors, context));
        break;
      case 'CREDITORS':
        body.push(this.subledgerTable('Creditors listing', context.creditors, context));
        break;
      case 'VALIDATION':
        body.push(this.validationTable(context.statements.validation, context));
        break;
    }

    return {
      info: {
        title: `${context.company.name} — ${REPORT_LABELS[context.kind]} — ${context.yearLabel}`,
        author: context.company.name,
      },
      pageSize: 'A4',
      pageMargins: [48, 56, 48, 64],
      defaultStyle: { font: 'Helvetica', fontSize: 9.5, color: INK, lineHeight: 1.15 },
      content: body,
      footer: (currentPage, pageCount) => ({
        margin: [48, 12, 48, 0],
        columns: [
          {
            text: context.company.reportFooter ?? `${context.company.name} — ${context.yearLabel}`,
            fontSize: 7.5,
            color: MUTED,
          },
          {
            text: `Page ${currentPage} of ${pageCount}`,
            alignment: 'right',
            fontSize: 7.5,
            color: MUTED,
          },
        ],
      }),
    };
  }

  // ---- Pages ------------------------------------------------------------

  private coverPage(context: ReportContext): Content {
    const validation = context.statements.validation;

    return {
      stack: [
        { text: context.company.name, fontSize: 26, bold: true, margin: [0, 120, 0, 6] },
        {
          text: 'Annual financial statements',
          fontSize: 15,
          color: MUTED,
          margin: [0, 0, 0, 2],
        },
        { text: `For the year ended ${context.periodEnd}`, fontSize: 12, color: MUTED },
        {
          canvas: [{ type: 'line', x1: 0, y1: 0, x2: 200, y2: 0, lineWidth: 2, lineColor: INK }],
          margin: [0, 20, 0, 24],
        },
        {
          table: {
            widths: [140, '*'],
            body: [
              ...(context.company.registrationNumber
                ? [this.metaRow('Registration number', context.company.registrationNumber)]
                : []),
              this.metaRow('Reporting framework', frameworkLabel(context.company.reportingFramework)),
              this.metaRow('Presentation currency', context.company.currencyCode),
              this.metaRow('Financial year', context.yearLabel),
              ...(context.company.preparedBy
                ? [this.metaRow('Prepared by', context.company.preparedBy)]
                : []),
              ...(context.company.approvedBy
                ? [this.metaRow('Approved by', context.company.approvedBy)]
                : []),
            ],
          },
          layout: 'noBorders',
        },
        validation.passed
          ? {
              text: 'All validation checks passed.',
              color: '#1b7f3b',
              fontSize: 9,
              margin: [0, 28, 0, 0],
            }
          : {
              text: `Draft: ${validation.errorCount} validation ${
                validation.errorCount === 1 ? 'check has' : 'checks have'
              } not passed.`,
              color: DANGER,
              bold: true,
              fontSize: 9,
              margin: [0, 28, 0, 0],
            },
        { text: '', pageBreak: 'after' },
      ],
    };
  }

  private statementTable(
    statement: RenderedStatement,
    context: ReportContext,
    pageBreakAfter: boolean,
  ): Content {
    const showPrior = statement.priorLabel !== null;
    const widths: Array<string | number> = showPrior ? ['*', 26, 78, 78] : ['*', 26, 78];

    const header: TableCell[] = [
      { text: '', border: [false, false, false, true] },
      { text: 'Note', style: 'columnHead', border: [false, false, false, true] },
      { text: statement.currentLabel, style: 'columnHead', border: [false, false, false, true] },
    ];
    if (showPrior) {
      header.push({
        text: statement.priorLabel ?? '',
        style: 'columnHead',
        border: [false, false, false, true],
      });
    }

    const rows: TableCell[][] = [header];

    for (const line of statement.lines) {
      if (line.style === 'SPACER') {
        rows.push(this.spacerRow(showPrior));
        continue;
      }
      rows.push(this.statementRow(line, showPrior, context));
    }

    return {
      stack: [
        { text: statement.title, fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
        { text: statement.subtitle, fontSize: 9, color: MUTED, margin: [0, 0, 0, 14] },
        {
          table: { headerRows: 1, widths, body: rows },
          layout: {
            hLineColor: () => RULE,
            vLineWidth: () => 0,
            paddingTop: () => 3,
            paddingBottom: () => 3,
            paddingLeft: () => 0,
            paddingRight: () => 0,
          },
        },
        ...(pageBreakAfter ? [{ text: '', pageBreak: 'after' } as Content] : []),
      ],
    };
  }

  private statementRow(
    line: StatementLine,
    showPrior: boolean,
    context: ReportContext,
  ): TableCell[] {
    const bold = line.style === 'HEADING' || line.style === 'SUBTOTAL' || line.style === 'TOTAL';
    const topBorder = line.style === 'SUBTOTAL' || line.style === 'TOTAL';
    const bottomBorder = line.style === 'TOTAL';
    const border: [boolean, boolean, boolean, boolean] = [false, topBorder, false, bottomBorder];

    const label: TableCell = {
      text: line.label,
      bold,
      color: line.style === 'DETAIL' ? MUTED : INK,
      margin: [line.indent * 12, 0, 0, 0],
      border,
    };

    const cells: TableCell[] = [
      label,
      { text: line.noteNumber ? String(line.noteNumber) : '', alignment: 'center', fontSize: 8, border },
      { text: this.money(line.current, context), alignment: 'right', bold, border },
    ];

    if (showPrior) {
      cells.push({ text: this.money(line.prior, context), alignment: 'right', bold, border });
    }

    return cells;
  }

  private spacerRow(showPrior: boolean): TableCell[] {
    const blank: TableCell = { text: ' ', fontSize: 4, border: [false, false, false, false] };
    return showPrior ? [blank, blank, blank, blank] : [blank, blank, blank];
  }

  private notesSection(context: ReportContext): Content {
    if (context.notes.length === 0) {
      return this.notice(
        'Notes to the financial statements',
        'No notes have been prepared yet. Generate them from the notes screen and they will appear here.',
      );
    }

    const stack: Content[] = [
      { text: 'Notes to the financial statements', fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
      {
        text: `${context.company.name} — for the year ended ${context.periodEnd}`,
        fontSize: 9,
        color: MUTED,
        margin: [0, 0, 0, 14],
      },
    ];

    for (const note of context.notes) {
      stack.push({
        text: `${note.number}. ${note.title}`,
        bold: true,
        fontSize: 10.5,
        margin: [0, 10, 0, 4],
      });

      if (note.body) {
        stack.push({ text: note.body, alignment: 'justify', margin: [0, 0, 0, note.lines.length ? 6 : 0] });
      }

      if (note.lines.length > 0) {
        const showPrior = note.lines.some((l) => l.priorAmount !== null);
        const body: TableCell[][] = [];

        for (const line of note.lines) {
          const row: TableCell[] = [
            { text: line.label, bold: line.isSubtotal, margin: [12, 0, 0, 0], border: [false, line.isSubtotal, false, false] },
            {
              text: this.money(line.currentAmount, context),
              alignment: 'right',
              bold: line.isSubtotal,
              border: [false, line.isSubtotal, false, false],
            },
          ];
          if (showPrior) {
            row.push({
              text: this.money(line.priorAmount, context),
              alignment: 'right',
              bold: line.isSubtotal,
              border: [false, line.isSubtotal, false, false],
            });
          }
          body.push(row);
        }

        if (note.total !== null) {
          const totalRow: TableCell[] = [
            { text: 'Total', bold: true, margin: [12, 0, 0, 0], border: [false, true, false, true] },
            { text: this.money(note.total, context), alignment: 'right', bold: true, border: [false, true, false, true] },
          ];
          if (showPrior) {
            totalRow.push({
              text: this.money(note.priorTotal, context),
              alignment: 'right',
              bold: true,
              border: [false, true, false, true],
            });
          }
          body.push(totalRow);
        }

        stack.push({
          table: { widths: showPrior ? ['*', 78, 78] : ['*', 78], body },
          layout: {
            hLineColor: () => RULE,
            vLineWidth: () => 0,
            paddingTop: () => 2,
            paddingBottom: () => 2,
            paddingLeft: () => 0,
            paddingRight: () => 0,
          },
        });

        if (!note.ties) {
          stack.push({
            text: `This note does not agree to the statements, which show ${this.money(
              note.statementAmount,
              context,
            )}.`,
            color: DANGER,
            fontSize: 8,
            italics: true,
            margin: [12, 3, 0, 0],
          });
        }
      }
    }

    return { stack };
  }

  private trialBalanceTable(context: ReportContext): Content {
    const body: TableCell[][] = [
      [
        { text: 'Code', style: 'columnHead', alignment: 'left' },
        { text: 'Account', style: 'columnHead', alignment: 'left' },
        { text: 'Debit', style: 'columnHead' },
        { text: 'Credit', style: 'columnHead' },
      ],
    ];

    for (const row of context.trialBalance.rows) {
      body.push([
        { text: row.code, fontSize: 8.5 },
        { text: row.name, fontSize: 8.5 },
        { text: this.money(row.debit || null, context), alignment: 'right', fontSize: 8.5 },
        { text: this.money(row.credit || null, context), alignment: 'right', fontSize: 8.5 },
      ]);
    }

    body.push([
      { text: '', border: [false, true, false, true] },
      { text: 'Totals', bold: true, border: [false, true, false, true] },
      {
        text: this.money(context.trialBalance.totalDebit, context),
        alignment: 'right',
        bold: true,
        border: [false, true, false, true],
      },
      {
        text: this.money(context.trialBalance.totalCredit, context),
        alignment: 'right',
        bold: true,
        border: [false, true, false, true],
      },
    ]);

    return {
      stack: [
        { text: 'Trial balance', fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
        {
          text: `${context.company.name} — ${context.yearLabel}`,
          fontSize: 9,
          color: MUTED,
          margin: [0, 0, 0, 14],
        },
        {
          table: { headerRows: 1, widths: [50, '*', 78, 78], body },
          layout: this.plainLayout(),
        },
        ...(context.trialBalance.isBalanced
          ? []
          : [
              {
                text: `Out of balance by ${this.money(context.trialBalance.difference, context)}.`,
                color: DANGER,
                bold: true,
                margin: [0, 10, 0, 0],
              } as Content,
            ]),
      ],
    };
  }

  private subledgerTable(
    title: string,
    subledger: SubledgerResponse,
    context: ReportContext,
  ): Content {
    const body: TableCell[][] = [
      [
        { text: 'Code', style: 'columnHead', alignment: 'left' },
        { text: 'Name', style: 'columnHead', alignment: 'left' },
        { text: 'Current', style: 'columnHead' },
        { text: '30', style: 'columnHead' },
        { text: '60', style: 'columnHead' },
        { text: '90', style: 'columnHead' },
        { text: '120+', style: 'columnHead' },
        { text: 'Total', style: 'columnHead' },
      ],
    ];

    for (const row of subledger.rows) {
      body.push([
        { text: row.code, fontSize: 8 },
        { text: row.name, fontSize: 8 },
        { text: this.money(row.current || null, context), alignment: 'right', fontSize: 8 },
        { text: this.money(row.days30 || null, context), alignment: 'right', fontSize: 8 },
        { text: this.money(row.days60 || null, context), alignment: 'right', fontSize: 8 },
        { text: this.money(row.days90 || null, context), alignment: 'right', fontSize: 8 },
        { text: this.money(row.days120Plus || null, context), alignment: 'right', fontSize: 8 },
        { text: this.money(row.total, context), alignment: 'right', fontSize: 8, bold: true },
      ]);
    }

    const t = subledger.totals;
    body.push([
      { text: '', border: [false, true, false, true] },
      { text: 'Totals', bold: true, border: [false, true, false, true] },
      { text: this.money(t.current, context), alignment: 'right', bold: true, border: [false, true, false, true] },
      { text: this.money(t.days30, context), alignment: 'right', bold: true, border: [false, true, false, true] },
      { text: this.money(t.days60, context), alignment: 'right', bold: true, border: [false, true, false, true] },
      { text: this.money(t.days90, context), alignment: 'right', bold: true, border: [false, true, false, true] },
      { text: this.money(t.days120Plus, context), alignment: 'right', bold: true, border: [false, true, false, true] },
      { text: this.money(t.total, context), alignment: 'right', bold: true, border: [false, true, false, true] },
    ]);

    return {
      stack: [
        { text: title, fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
        {
          text: `${context.company.name} — ${context.yearLabel}`,
          fontSize: 9,
          color: MUTED,
          margin: [0, 0, 0, 14],
        },
        {
          table: { headerRows: 1, widths: [44, '*', 52, 46, 46, 46, 52, 58], body },
          layout: this.plainLayout(),
        },
        {
          text: subledger.agrees
            ? `Agrees to the control account of ${this.money(subledger.controlAccountTotal, context)}.`
            : `Does not agree to the control account of ${this.money(
                subledger.controlAccountTotal,
                context,
              )}, out by ${this.money(subledger.difference, context)}.`,
          color: subledger.agrees ? '#1b7f3b' : DANGER,
          margin: [0, 10, 0, 0],
          fontSize: 9,
        },
      ],
    };
  }

  private validationTable(report: ValidationReport, context: ReportContext): Content {
    const body: TableCell[][] = [
      [
        { text: 'Severity', style: 'columnHead', alignment: 'left' },
        { text: 'Check', style: 'columnHead', alignment: 'left' },
        { text: 'What was found', style: 'columnHead', alignment: 'left' },
      ],
    ];

    if (report.issues.length === 0) {
      body.push([
        { text: '', fontSize: 8.5 },
        { text: 'Nothing to report', fontSize: 8.5 },
        { text: 'Every check passed.', fontSize: 8.5 },
      ]);
    }

    for (const issue of report.issues) {
      body.push([
        {
          text: issue.severity,
          fontSize: 8,
          bold: true,
          color: issue.severity === 'ERROR' ? DANGER : issue.severity === 'WARNING' ? WARN : MUTED,
        },
        { text: issue.title, fontSize: 8.5 },
        { text: issue.detail, fontSize: 8.5 },
      ]);
    }

    return {
      stack: [
        { text: 'Validation report', fontSize: 14, bold: true, margin: [0, 0, 0, 2] },
        {
          text: `${context.company.name} — ${context.yearLabel}`,
          fontSize: 9,
          color: MUTED,
          margin: [0, 0, 0, 14],
        },
        {
          table: { headerRows: 1, widths: [56, 140, '*'], body },
          layout: this.plainLayout(),
        },
      ],
    };
  }

  private notice(title: string, message: string): Content {
    return {
      stack: [
        { text: title, fontSize: 14, bold: true, margin: [0, 0, 0, 8] },
        { text: message, color: MUTED },
      ],
    };
  }

  private metaRow(label: string, value: string): TableCell[] {
    return [
      { text: label, color: MUTED, fontSize: 9 },
      { text: value, fontSize: 9 },
    ];
  }

  private plainLayout() {
    return {
      hLineColor: () => RULE,
      hLineWidth: (i: number, node: { table: { body: unknown[] } }) =>
        i === 0 || i === 1 || i === node.table.body.length ? 0.7 : 0,
      vLineWidth: () => 0,
      paddingTop: () => 2.5,
      paddingBottom: () => 2.5,
      paddingLeft: () => 0,
      paddingRight: () => 0,
    };
  }

  private money(value: number | null | undefined, context: ReportContext): string {
    if (value === null || value === undefined) return '';
    return formatAmount(value, { accounting: true, blankOnZero: false });
  }

  private render(definition: TDocumentDefinitions): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = this.printer.createPdfKitDocument({
        ...definition,
        styles: {
          columnHead: { bold: true, fontSize: 8, color: MUTED, alignment: 'right' },
          ...(definition.styles ?? {}),
        },
      });

      const chunks: Buffer[] = [];
      doc.on('data', (chunk: Buffer) => chunks.push(chunk));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
      doc.end();
    });
  }
}

function frameworkLabel(framework: string): string {
  const labels: Record<string, string> = {
    IFRS: 'International Financial Reporting Standards',
    IFRS_FOR_SMES: 'IFRS for Small and Medium-sized Entities',
    LOCAL_GAAP: 'Local generally accepted accounting practice',
    OTHER: 'Other',
  };
  return labels[framework] ?? framework;
}
