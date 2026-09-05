import { Body, Controller, Delete, Get, HttpCode, Param, Post, Put, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';
import type { ColumnMap, ImportPreview, TrialBalanceResponse } from '@finstat/shared';

import { TrialBalanceService } from './trial-balance.service';
import { CompanyAccessGuard } from '../common/guards';
import { EditableYearGuard, FinancialYearScopeGuard } from '../financial-years/year-scope.guard';
import { CurrentUser, RequireCompanyRole } from '../common/decorators';

class EntryDto {
  @IsUUID() accountId!: string;
  @IsNumber({ maxDecimalPlaces: 2 }) debit!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) credit!: number;
  @IsOptional() @IsString() note?: string;
}

class SaveEntriesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EntryDto)
  entries!: EntryDto[];
}

class PasteDto {
  @IsString() text!: string;
  @IsOptional() @IsObject() columnMap?: ColumnMap;
  @IsOptional() @IsIn(['DEBIT_POSITIVE', 'CREDIT_POSITIVE']) amountSign?: 'DEBIT_POSITIVE' | 'CREDIT_POSITIVE';
  @IsOptional() @IsBoolean() createMissingAccounts?: boolean;
  @IsOptional() @IsBoolean() replaceAll?: boolean;
}

@ApiTags('trial-balance')
@Controller('companies/:companyId/years/:yearId/trial-balance')
@UseGuards(CompanyAccessGuard, FinancialYearScopeGuard)
export class TrialBalanceController {
  constructor(private readonly trialBalance: TrialBalanceService) {}

  @Get()
  get(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
  ): Promise<TrialBalanceResponse> {
    return this.trialBalance.get(companyId, yearId);
  }

  @Put()
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  save(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: SaveEntriesDto,
  ): Promise<TrialBalanceResponse> {
    return this.trialBalance.saveEntries(companyId, yearId, userId, dto.entries);
  }

  /** Dry run: says what the paste would do without touching anything. */
  @Post('paste/preview')
  @HttpCode(200)
  @RequireCompanyRole('PREPARER')
  preview(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @Body() dto: PasteDto,
  ): Promise<ImportPreview> {
    return this.trialBalance.previewPaste(companyId, yearId, dto.text, dto);
  }

  @Post('paste')
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('PREPARER')
  paste(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: PasteDto,
  ) {
    return this.trialBalance.commitPaste(companyId, yearId, userId, dto.text, dto);
  }

  @Delete()
  @UseGuards(EditableYearGuard)
  @RequireCompanyRole('ADMIN')
  @HttpCode(204)
  clear(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.trialBalance.clear(companyId, yearId, userId);
  }
}
