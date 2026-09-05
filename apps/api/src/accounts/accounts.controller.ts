import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import {
  ACCOUNT_TYPES,
  SECTIONS_IN_ORDER,
  STATEMENT_SECTIONS,
  type AccountDto,
  type AccountType,
  type StatementSection,
} from '@finstat/shared';

import { AccountsService } from './accounts.service';
import { CompanyAccessGuard } from '../common/guards';
import { CurrentUser, RequireCompanyRole } from '../common/decorators';

class AccountDtoIn {
  @IsString() @MinLength(1) @MaxLength(30) code!: string;
  @IsString() @MinLength(1) @MaxLength(200) name!: string;
  @IsIn(ACCOUNT_TYPES) type!: AccountType;
  @IsOptional() @IsIn(STATEMENT_SECTIONS) section?: StatementSection;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class UpdateAccountDto {
  @IsOptional() @IsString() @MaxLength(30) code?: string;
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsIn(ACCOUNT_TYPES) type?: AccountType;
  @IsOptional() @IsIn(STATEMENT_SECTIONS) section?: StatementSection;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
  @IsOptional() @IsInt() sortOrder?: number;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class BulkAccountsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AccountDtoIn)
  accounts!: AccountDtoIn[];
}

@ApiTags('accounts')
@Controller('companies/:companyId/accounts')
@UseGuards(CompanyAccessGuard)
export class AccountsController {
  constructor(private readonly accounts: AccountsService) {}

  @Get()
  list(
    @Param('companyId') companyId: string,
    @Query('includeInactive') includeInactive?: string,
  ): Promise<AccountDto[]> {
    return this.accounts.list(companyId, includeInactive === 'true');
  }

  /** The reporting categories an account can be mapped to, for the UI. */
  @Get('sections')
  sections() {
    return SECTIONS_IN_ORDER.map((meta) => ({
      section: meta.section,
      label: meta.label,
      statement: meta.statement,
      group: meta.group,
      accountType: meta.accountType,
    }));
  }

  @Post()
  @RequireCompanyRole('PREPARER')
  create(
    @Param('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AccountDtoIn,
  ): Promise<AccountDto> {
    return this.accounts.create(companyId, userId, dto);
  }

  @Post('bulk')
  @RequireCompanyRole('PREPARER')
  bulk(
    @Param('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: BulkAccountsDto,
  ) {
    return this.accounts.bulkUpsert(companyId, userId, dto.accounts);
  }

  @Post('template')
  @RequireCompanyRole('PREPARER')
  applyTemplate(@Param('companyId') companyId: string, @CurrentUser('id') userId: string) {
    return this.accounts.applyTemplate(companyId, userId);
  }

  @Patch(':accountId')
  @RequireCompanyRole('PREPARER')
  update(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateAccountDto,
  ): Promise<AccountDto> {
    return this.accounts.update(companyId, accountId, userId, dto);
  }

  @Delete(':accountId')
  @RequireCompanyRole('ADMIN')
  remove(
    @Param('companyId') companyId: string,
    @Param('accountId') accountId: string,
    @CurrentUser('id') userId: string,
  ) {
    return this.accounts.remove(companyId, accountId, userId);
  }
}
