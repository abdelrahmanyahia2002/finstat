import { Controller, Get, Param, Query, Res, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import type { JobDto } from '@finstat/shared';

import { JobsService } from './jobs.service';
import { CompanyAccessGuard } from '../common/guards';

const CONTENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

@ApiTags('jobs')
@Controller('companies/:companyId/jobs')
@UseGuards(CompanyAccessGuard)
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@Param('companyId') companyId: string, @Query('limit') limit?: string): Promise<JobDto[]> {
    return this.jobs.list(companyId, limit ? Number(limit) : undefined);
  }

  @Get(':jobId')
  get(@Param('companyId') companyId: string, @Param('jobId') jobId: string): Promise<JobDto> {
    return this.jobs.get(companyId, jobId);
  }

  @Get(':jobId/download')
  async download(
    @Param('companyId') companyId: string,
    @Param('jobId') jobId: string,
    @Res() res: Response,
  ): Promise<void> {
    const { stream, size, fileName } = await this.jobs.download(companyId, jobId);
    const extension = fileName.split('.').pop()?.toLowerCase() ?? '';

    res.setHeader('Content-Type', CONTENT_TYPES[extension] ?? 'application/octet-stream');
    res.setHeader('Content-Length', size);
    // The name is quoted and stripped of anything that could break the header.
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${fileName.replace(/["\\\r\n]/g, '')}"`,
    );

    stream.pipe(res);
  }
}
