import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';

import {
  JOBS_QUEUE,
  JobsService,
  type ExcelExportJobData,
  type ExcelImportJobData,
  type PdfJobData,
} from './jobs.service';
import { ReportBuilderService } from './report-builder.service';
import { PdfService } from '../reports/pdf.service';
import { ExcelService } from '../excel/excel.service';
import { FileStorageService } from '../files/file-storage.service';
import { TrialBalanceService } from '../trial-balance/trial-balance.service';
import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Reports and imports run here rather than in the request.
 *
 * A full statements pack for a company with a long chart takes seconds to
 * render, and an import can take longer, so the HTTP call returns a job the UI
 * follows instead of holding a connection open and timing out behind a proxy.
 */
@Processor(JOBS_QUEUE)
export class JobsProcessor extends WorkerHost {
  private readonly logger = new Logger(JobsProcessor.name);

  constructor(
    private readonly jobs: JobsService,
    private readonly reports: ReportBuilderService,
    private readonly pdf: PdfService,
    private readonly excel: ExcelService,
    private readonly files: FileStorageService,
    private readonly trialBalance: TrialBalanceService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job): Promise<void> {
    const data = job.data as { jobId: string };

    try {
      await this.jobs.markProcessing(data.jobId);

      switch (job.name) {
        case 'PDF_REPORT':
          await this.buildPdf(job.data as PdfJobData);
          break;
        case 'EXCEL_EXPORT':
          await this.buildExcel(job.data as ExcelExportJobData);
          break;
        case 'EXCEL_IMPORT':
          await this.runImport(job.data as ExcelImportJobData);
          break;
        default:
          throw new Error(`There is no handler for ${job.name}.`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Job ${job.name} (${data.jobId}) failed: ${message}`);
      await this.jobs.markFailed(data.jobId, message);
      throw error;
    }
  }

  private async buildPdf(data: PdfJobData): Promise<void> {
    await this.jobs.setProgress(data.jobId, 20, 'Gathering the figures');
    const context = await this.reports.build(data.companyId, data.financialYearId, data.kind);

    await this.jobs.setProgress(data.jobId, 60, 'Laying out the report');
    const pdf = await this.pdf.build(context);

    await this.jobs.setProgress(data.jobId, 90, 'Saving');
    const record = await this.prisma.jobRecord.findUniqueOrThrow({ where: { id: data.jobId } });
    const storedPath = await this.files.save(
      data.companyId,
      record.fileName ?? 'report.pdf',
      pdf,
    );

    await this.jobs.markCompleted(data.jobId, {
      filePath: storedPath,
      message: 'Ready to download',
    });
  }

  private async buildExcel(data: ExcelExportJobData): Promise<void> {
    await this.jobs.setProgress(data.jobId, 20, 'Gathering the figures');
    const record = await this.prisma.jobRecord.findUniqueOrThrow({ where: { id: data.jobId } });

    let workbook: Buffer;

    if (data.variant === 'TEMPLATE') {
      const company = await this.prisma.company.findUniqueOrThrow({
        where: { id: data.companyId },
        select: { name: true },
      });
      workbook = await this.excel.buildImportTemplate(company.name);
    } else if (data.variant === 'TRIAL_BALANCE') {
      const [trialBalance, year] = await Promise.all([
        this.trialBalance.get(data.companyId, data.financialYearId),
        this.prisma.financialYear.findUniqueOrThrow({
          where: { id: data.financialYearId },
          include: { company: { select: { name: true } } },
        }),
      ]);
      await this.jobs.setProgress(data.jobId, 60, 'Building the workbook');
      workbook = await this.excel.buildTrialBalanceWorkbook(
        year.company.name,
        year.label,
        trialBalance,
      );
    } else {
      const context = await this.reports.build(
        data.companyId,
        data.financialYearId,
        'FULL_ANNUAL_FINANCIAL_STATEMENTS',
      );
      await this.jobs.setProgress(data.jobId, 60, 'Building the workbook');
      workbook = await this.excel.buildStatementsWorkbook(
        context.statements,
        context.trialBalance,
        context.notes,
        { debtors: context.debtors, creditors: context.creditors },
      );
    }

    await this.jobs.setProgress(data.jobId, 90, 'Saving');
    const storedPath = await this.files.save(
      data.companyId,
      record.fileName ?? 'export.xlsx',
      workbook,
    );

    await this.jobs.markCompleted(data.jobId, {
      filePath: storedPath,
      message: 'Ready to download',
    });
  }

  private async runImport(data: ExcelImportJobData): Promise<void> {
    await this.jobs.setProgress(data.jobId, 15, 'Reading the workbook');

    const { stream } = await this.files.open(data.storedPath);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const buffer = Buffer.concat(chunks);

    const text = await this.excel.workbookToText(buffer, data.sheetName);

    await this.jobs.setProgress(data.jobId, 55, 'Checking the rows');
    const { preview } = await this.trialBalance.commitPaste(
      data.companyId,
      data.financialYearId,
      data.userId,
      text,
      {
        createMissingAccounts: data.createMissingAccounts,
        replaceAll: data.replaceAll,
      },
    );

    // The uploaded file has served its purpose.
    await this.files.remove(data.storedPath);

    await this.jobs.markCompleted(data.jobId, {
      message: `Imported ${preview.rows.length} rows: ${preview.updateCount} updated, ${preview.createCount} accounts created.`,
    });
  }
}
