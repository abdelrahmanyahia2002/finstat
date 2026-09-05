import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import {
  REPORT_KINDS,
  REPORT_LABELS,
  type ImportPreview,
  type JobDto,
  type ReportKind,
} from '@finstat/shared';

import { JobsService, type ExcelExportVariant } from '../jobs/jobs.service';
import { ExcelService } from '../excel/excel.service';
import { FileStorageService } from '../files/file-storage.service';
import { TrialBalanceService } from '../trial-balance/trial-balance.service';
import { PrismaService } from '../common/prisma/prisma.service';
import { CompanyAccessGuard } from '../common/guards';
import { EditableYearGuard, FinancialYearScopeGuard } from '../financial-years/year-scope.guard';
import { CurrentUser, RequireCompanyRole } from '../common/decorators';

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;
const SPREADSHEET_TYPES = [
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'application/vnd.ms-excel.sheet.macroEnabled.12',
];

class PdfReportDto {
  @IsIn(REPORT_KINDS) kind!: ReportKind;
}

class ExcelExportDto {
  @IsIn(['STATEMENTS', 'TRIAL_BALANCE', 'TEMPLATE']) variant!: ExcelExportVariant;
}

class ImportOptionsDto {
  @IsOptional() @IsString() @MaxLength(120) sheetName?: string;
  @IsOptional() @IsBoolean() createMissingAccounts?: boolean;
  @IsOptional() @IsBoolean() replaceAll?: boolean;
}

@ApiTags('reports')
@Controller('companies/:companyId/years/:yearId')
@UseGuards(CompanyAccessGuard, FinancialYearScopeGuard)
export class ReportsController {
  constructor(
    private readonly jobs: JobsService,
    private readonly excel: ExcelService,
    private readonly files: FileStorageService,
    private readonly trialBalance: TrialBalanceService,
    private readonly prisma: PrismaService,
  ) {}

  @Post('reports/pdf')
  @RequireCompanyRole('VIEWER')
  async requestPdf(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PdfReportDto,
  ): Promise<JobDto> {
    const fileName = await this.fileNameFor(companyId, yearId, REPORT_LABELS[dto.kind], 'pdf');
    return this.jobs.enqueuePdf(companyId, yearId, userId, dto.kind, fileName);
  }

  @Post('excel/export')
  @RequireCompanyRole('VIEWER')
  async requestExcel(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: ExcelExportDto,
  ): Promise<JobDto> {
    const label =
      dto.variant === 'TEMPLATE'
        ? 'Import template'
        : dto.variant === 'TRIAL_BALANCE'
          ? 'Trial balance'
          : 'Financial statements';
    const fileName = await this.fileNameFor(companyId, yearId, label, 'xlsx');
    return this.jobs.enqueueExcelExport(companyId, yearId, userId, dto.variant, fileName);
  }

  /**
   * Read an uploaded workbook and report what importing it would do.
   *
   * This one runs in the request rather than as a job: the preparer is looking
   * at the screen waiting to decide, and a preview writes nothing.
   */
  @Post('excel/preview')
  @HttpCode(200)
  @RequireCompanyRole('PREPARER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async previewImport(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ImportOptionsDto,
  ): Promise<ImportPreview & { sheetNames: string[] }> {
    assertSpreadsheet(file);
    const text = await this.excel.workbookToText(file.buffer, dto.sheetName);
    const [preview, sheetNames] = await Promise.all([
      this.trialBalance.previewPaste(companyId, yearId, text),
      this.excel.listSheetNames(file.buffer),
    ]);
    return { ...preview, sheetNames };
  }

  @Post('excel/import')
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_UPLOAD_BYTES } }))
  async importWorkbook(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() dto: ImportOptionsDto,
  ): Promise<JobDto> {
    assertSpreadsheet(file);

    const storedPath = await this.files.save(companyId, file.originalname, file.buffer);

    return this.jobs.enqueueImport(companyId, yearId, userId, {
      storedPath,
      fileName: file.originalname,
      sheetName: dto.sheetName,
      createMissingAccounts: dto.createMissingAccounts ?? false,
      replaceAll: dto.replaceAll ?? false,
    });
  }

  private async fileNameFor(
    companyId: string,
    yearId: string,
    label: string,
    extension: string,
  ): Promise<string> {
    const [company, year] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { name: true },
      }),
      this.prisma.financialYear.findUniqueOrThrow({
        where: { id: yearId },
        select: { label: true },
      }),
    ]);

    const slug = `${company.name} ${year.label} ${label}`
      .replace(/[^a-zA-Z0-9 _-]/g, '')
      .trim()
      .replace(/\s+/g, '-');

    return `${slug}.${extension}`;
  }
}

function assertSpreadsheet(
  file: Express.Multer.File | undefined,
): asserts file is Express.Multer.File {
  if (!file) {
    throw new BadRequestException('Attach a spreadsheet to import.');
  }
  const looksRight =
    SPREADSHEET_TYPES.includes(file.mimetype) || /\.(xlsx|xlsm|xls)$/i.test(file.originalname);
  if (!looksRight) {
    throw new BadRequestException('That file is not an Excel workbook. Use .xlsx.');
  }
}
