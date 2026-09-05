import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  FINANCIAL_YEAR_STATUSES,
  type FinancialYearStatus,
  type FinancialYearSummary,
} from '@finstat/shared';

import { FinancialYearsService } from './financial-years.service';
import { FinancialYearScopeGuard } from './year-scope.guard';
import { CompanyAccessGuard } from '../common/guards';
import { CurrentUser, RequireCompanyRole } from '../common/decorators';

class CreateYearDto {
  @IsString() @MinLength(2) @MaxLength(60) label!: string;
  @IsDateString({}, { message: 'Use a date like 2025-01-01.' }) startDate!: string;
  @IsDateString({}, { message: 'Use a date like 2025-12-31.' }) endDate!: string;
  @IsOptional() @IsUUID() previousYearId?: string;
  @IsOptional() @IsBoolean() makeCurrent?: boolean;
}

class UpdateYearDto {
  @IsOptional() @IsString() @MaxLength(60) label?: string;
  @IsOptional() @IsDateString() startDate?: string;
  @IsOptional() @IsDateString() endDate?: string;
  @IsOptional() @IsUUID() previousYearId?: string;
  @IsOptional() @IsBoolean() makeCurrent?: boolean;
  @IsOptional() @IsString() @MaxLength(4000) notesIntro?: string;
}

class StatusDto {
  @IsIn(FINANCIAL_YEAR_STATUSES) status!: FinancialYearStatus;
}

class CarryForwardDto {
  @IsString() @MinLength(2) @MaxLength(60) label!: string;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsBoolean() closeSourceYear?: boolean;
  @IsOptional() @IsBoolean() copyNotes?: boolean;
  @IsOptional() @IsBoolean() copySubledgers?: boolean;
}

@ApiTags('financial-years')
@Controller('companies/:companyId/years')
@UseGuards(CompanyAccessGuard)
export class FinancialYearsController {
  constructor(private readonly years: FinancialYearsService) {}

  @Get()
  list(@Param('companyId') companyId: string): Promise<FinancialYearSummary[]> {
    return this.years.list(companyId);
  }

  @Post()
  @RequireCompanyRole('PREPARER')
  create(
    @Param('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CreateYearDto,
  ) {
    return this.years.create(companyId, userId, dto);
  }

  @Get(':yearId')
  @UseGuards(FinancialYearScopeGuard)
  get(@Param('yearId') yearId: string) {
    return this.years.get(yearId);
  }

  @Patch(':yearId')
  @UseGuards(FinancialYearScopeGuard)
  @RequireCompanyRole('PREPARER')
  update(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateYearDto,
  ) {
    return this.years.update(companyId, yearId, userId, dto);
  }

  @Patch(':yearId/status')
  @UseGuards(FinancialYearScopeGuard)
  @RequireCompanyRole('REVIEWER')
  setStatus(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: StatusDto,
  ) {
    return this.years.setStatus(companyId, yearId, userId, dto.status);
  }

  @Post(':yearId/carry-forward')
  @UseGuards(FinancialYearScopeGuard)
  @RequireCompanyRole('PREPARER')
  carryForward(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: CarryForwardDto,
  ) {
    return this.years.carryForward(companyId, yearId, userId, dto);
  }

  @Delete(':yearId')
  @UseGuards(FinancialYearScopeGuard)
  @RequireCompanyRole('ADMIN')
  @HttpCode(204)
  remove(
    @Param('companyId') companyId: string,
    @Param('yearId') yearId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.years.remove(companyId, yearId, userId);
  }
}
