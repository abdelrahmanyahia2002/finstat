import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import type { Prisma } from '@prisma/client';
import type { JobDto, JobType, ReportKind } from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { FileStorageService } from '../files/file-storage.service';

export const JOBS_QUEUE = 'finstat-jobs';

export type ExcelExportVariant = 'STATEMENTS' | 'TRIAL_BALANCE' | 'TEMPLATE';

export interface PdfJobData {
  jobId: string;
  companyId: string;
  financialYearId: string;
  kind: ReportKind;
}

export interface ExcelExportJobData {
  jobId: string;
  companyId: string;
  financialYearId: string;
  variant: ExcelExportVariant;
}

export interface ExcelImportJobData {
  jobId: string;
  companyId: string;
  financialYearId: string;
  userId: string;
  storedPath: string;
  sheetName?: string;
  createMissingAccounts: boolean;
  replaceAll: boolean;
}

export type JobData = PdfJobData | ExcelExportJobData | ExcelImportJobData;

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly files: FileStorageService,
    @InjectQueue(JOBS_QUEUE) private readonly queue: Queue,
  ) {}

  async list(companyId: string, limit = 25): Promise<JobDto[]> {
    const jobs = await this.prisma.jobRecord.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, limit)),
    });
    return jobs.map(toDto);
  }

  async get(companyId: string, jobId: string): Promise<JobDto> {
    const job = await this.prisma.jobRecord.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== companyId) {
      throw new NotFoundException('That job was not found.');
    }
    return toDto(job);
  }

  async download(companyId: string, jobId: string) {
    const job = await this.prisma.jobRecord.findUnique({ where: { id: jobId } });
    if (!job || job.companyId !== companyId) {
      throw new NotFoundException('That job was not found.');
    }
    if (job.status !== 'COMPLETED' || !job.filePath) {
      throw new NotFoundException('That job has no file to download.');
    }

    const { stream, size } = await this.files.open(job.filePath);
    return { stream, size, fileName: job.fileName ?? 'download' };
  }

  async enqueuePdf(
    companyId: string,
    financialYearId: string,
    userId: string,
    kind: ReportKind,
    fileName: string,
  ): Promise<JobDto> {
    const job = await this.createRecord({
      companyId,
      financialYearId,
      userId,
      type: 'PDF_REPORT',
      fileName,
      params: { kind },
    });

    await this.queue.add(
      'PDF_REPORT',
      { jobId: job.id, companyId, financialYearId, kind } satisfies PdfJobData,
      DEFAULT_JOB_OPTIONS,
    );

    return toDto(job);
  }

  async enqueueExcelExport(
    companyId: string,
    financialYearId: string,
    userId: string,
    variant: ExcelExportVariant,
    fileName: string,
  ): Promise<JobDto> {
    const job = await this.createRecord({
      companyId,
      financialYearId,
      userId,
      type: 'EXCEL_EXPORT',
      fileName,
      params: { variant },
    });

    await this.queue.add(
      'EXCEL_EXPORT',
      { jobId: job.id, companyId, financialYearId, variant } satisfies ExcelExportJobData,
      DEFAULT_JOB_OPTIONS,
    );

    return toDto(job);
  }

  async enqueueImport(
    companyId: string,
    financialYearId: string,
    userId: string,
    input: {
      storedPath: string;
      fileName: string;
      sheetName?: string;
      createMissingAccounts: boolean;
      replaceAll: boolean;
    },
  ): Promise<JobDto> {
    const job = await this.createRecord({
      companyId,
      financialYearId,
      userId,
      type: 'EXCEL_IMPORT',
      fileName: input.fileName,
      params: {
        sheetName: input.sheetName ?? null,
        createMissingAccounts: input.createMissingAccounts,
        replaceAll: input.replaceAll,
      },
    });

    await this.queue.add(
      'EXCEL_IMPORT',
      {
        jobId: job.id,
        companyId,
        financialYearId,
        userId,
        storedPath: input.storedPath,
        sheetName: input.sheetName,
        createMissingAccounts: input.createMissingAccounts,
        replaceAll: input.replaceAll,
      } satisfies ExcelImportJobData,
      DEFAULT_JOB_OPTIONS,
    );

    return toDto(job);
  }

  // ---- Called by the worker --------------------------------------------

  async markProcessing(jobId: string, message?: string): Promise<void> {
    await this.prisma.jobRecord.update({
      where: { id: jobId },
      data: { status: 'PROCESSING', startedAt: new Date(), progress: 5, message: message ?? null },
    });
  }

  async setProgress(jobId: string, progress: number, message?: string): Promise<void> {
    await this.prisma.jobRecord.update({
      where: { id: jobId },
      data: {
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        ...(message !== undefined ? { message } : {}),
      },
    });
  }

  async markCompleted(
    jobId: string,
    result: { filePath?: string; message?: string } = {},
  ): Promise<void> {
    await this.prisma.jobRecord.update({
      where: { id: jobId },
      data: {
        status: 'COMPLETED',
        progress: 100,
        completedAt: new Date(),
        ...(result.filePath ? { filePath: result.filePath } : {}),
        ...(result.message ? { message: result.message } : {}),
      },
    });
  }

  async markFailed(jobId: string, error: string): Promise<void> {
    await this.prisma.jobRecord.update({
      where: { id: jobId },
      data: {
        status: 'FAILED',
        completedAt: new Date(),
        // Truncated: a stack trace in a UI toast helps nobody.
        error: error.slice(0, 1000),
      },
    });
  }

  private createRecord(input: {
    companyId: string;
    financialYearId: string;
    userId: string;
    type: JobType;
    fileName: string;
    params: Prisma.InputJsonValue;
  }) {
    return this.prisma.jobRecord.create({
      data: {
        companyId: input.companyId,
        financialYearId: input.financialYearId,
        createdById: input.userId,
        type: input.type,
        fileName: input.fileName,
        params: input.params,
        status: 'QUEUED',
      },
    });
  }
}

const DEFAULT_JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 2000 },
  removeOnComplete: 200,
  removeOnFail: 500,
};

function toDto(job: {
  id: string;
  type: JobType;
  status: string;
  progress: number;
  message: string | null;
  error: string | null;
  fileName: string | null;
  filePath: string | null;
  createdAt: Date;
  completedAt: Date | null;
  companyId: string;
}): JobDto {
  return {
    id: job.id,
    type: job.type,
    status: job.status as JobDto['status'],
    progress: job.progress,
    message: job.message,
    error: job.error,
    fileName: job.fileName,
    downloadUrl:
      job.status === 'COMPLETED' && job.filePath
        ? `/api/companies/${job.companyId}/jobs/${job.id}/download`
        : null,
    createdAt: job.createdAt.toISOString(),
    completedAt: job.completedAt?.toISOString() ?? null,
  };
}
