import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import type { CompanySettings } from '@finstat/shared';

import { SettingsService } from './settings.service';
import { CompanyAccessGuard } from '../common/guards';
import { CurrentUser, RequireCompanyRole } from '../common/decorators';

class UpdateSettingsDto {
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string;
  @IsOptional() @IsString() @MaxLength(5) currencySymbol?: string;
  @IsOptional() @IsString() @MaxLength(20) locale?: string;
  @IsOptional() @IsInt() @Min(0) @Max(4) decimals?: number;
  @IsOptional() @IsIn(['PARENTHESES', 'MINUS']) negativeStyle?: 'PARENTHESES' | 'MINUS';
  @IsOptional() @IsBoolean() showCents?: boolean;
  @IsOptional() @IsString() @MaxLength(500) reportFooter?: string;
  @IsOptional() @IsString() @MaxLength(120) preparedBy?: string;
  @IsOptional() @IsString() @MaxLength(120) approvedBy?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
}

@ApiTags('settings')
@Controller('companies/:companyId/settings')
@UseGuards(CompanyAccessGuard)
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  get(@Param('companyId') companyId: string): Promise<CompanySettings> {
    return this.settings.get(companyId);
  }

  @Patch()
  @RequireCompanyRole('ADMIN')
  update(
    @Param('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateSettingsDto,
  ): Promise<CompanySettings> {
    return this.settings.update(companyId, userId, dto);
  }
}
