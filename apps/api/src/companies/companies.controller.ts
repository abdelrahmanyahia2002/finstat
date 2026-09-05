import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  MinLength,
} from 'class-validator';
import {
  COMPANY_ROLES,
  REPORTING_FRAMEWORKS,
  type AuditLogDto,
  type CompanyRole,
  type CompanySummary,
  type Paginated,
  type ReportingFramework,
} from '@finstat/shared';

import { CompaniesService } from './companies.service';
import { AuditService } from '../audit/audit.service';
import { CompanyAccessGuard } from '../common/guards';
import { CurrentUser, RequireCompanyRole, type RequestUser } from '../common/decorators';

class CreateCompanyDto {
  @IsString()
  @MinLength(2, { message: 'Give the company a name.' })
  @MaxLength(200)
  name!: string;

  @IsOptional() @IsString() @MaxLength(60) registrationNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) taxNumber?: string;
  @IsOptional() @IsString() @Length(3, 3, { message: 'Use a three letter currency code.' }) currencyCode?: string;
  @IsOptional() @IsString() @MaxLength(5) currencySymbol?: string;
  @IsOptional() @IsString() @MaxLength(20) locale?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsIn(REPORTING_FRAMEWORKS) reportingFramework?: ReportingFramework;
}

class UpdateCompanyDto {
  @IsOptional() @IsString() @MaxLength(200) name?: string;
  @IsOptional() @IsString() @MaxLength(60) registrationNumber?: string;
  @IsOptional() @IsString() @MaxLength(60) taxNumber?: string;
  @IsOptional() @IsString() @Length(3, 3) currencyCode?: string;
  @IsOptional() @IsString() @MaxLength(5) currencySymbol?: string;
  @IsOptional() @IsString() @MaxLength(20) locale?: string;
  @IsOptional() @IsString() @MaxLength(80) country?: string;
  @IsOptional() @IsIn(REPORTING_FRAMEWORKS) reportingFramework?: ReportingFramework;
  @IsOptional() @IsString() @MaxLength(200) addressLine1?: string;
  @IsOptional() @IsString() @MaxLength(200) addressLine2?: string;
  @IsOptional() @IsString() @MaxLength(120) city?: string;
  @IsOptional() @IsString() @MaxLength(30) postalCode?: string;
  @IsOptional() @IsString() @MaxLength(120) preparedBy?: string;
  @IsOptional() @IsString() @MaxLength(120) approvedBy?: string;
  @IsOptional() @IsString() @MaxLength(500) reportFooter?: string;
  @IsOptional() @IsString() @MaxLength(500) logoUrl?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

class AddMemberDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  email!: string;

  @IsIn(COMPANY_ROLES)
  role!: CompanyRole;
}

class UpdateMemberDto {
  @IsIn(COMPANY_ROLES)
  role!: CompanyRole;
}

@ApiTags('companies')
@Controller('companies')
export class CompaniesController {
  constructor(
    private readonly companies: CompaniesService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  list(@CurrentUser() user: RequestUser): Promise<CompanySummary[]> {
    return this.companies.listForUser(user.id, user.globalRole);
  }

  @Post()
  create(@CurrentUser('id') userId: string, @Body() dto: CreateCompanyDto) {
    return this.companies.create(userId, dto);
  }

  @Get(':companyId')
  @UseGuards(CompanyAccessGuard)
  get(@Param('companyId') companyId: string) {
    return this.companies.get(companyId);
  }

  @Patch(':companyId')
  @UseGuards(CompanyAccessGuard)
  @RequireCompanyRole('ADMIN')
  update(
    @Param('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateCompanyDto,
  ) {
    return this.companies.update(companyId, userId, dto);
  }

  @Delete(':companyId')
  @UseGuards(CompanyAccessGuard)
  @RequireCompanyRole('OWNER')
  @HttpCode(204)
  remove(@Param('companyId') companyId: string, @CurrentUser('id') userId: string): Promise<void> {
    return this.companies.remove(companyId, userId);
  }

  // ---- Members ----------------------------------------------------------

  @Get(':companyId/members')
  @UseGuards(CompanyAccessGuard)
  listMembers(@Param('companyId') companyId: string) {
    return this.companies.listMembers(companyId);
  }

  @Post(':companyId/members')
  @UseGuards(CompanyAccessGuard)
  @RequireCompanyRole('ADMIN')
  addMember(
    @Param('companyId') companyId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: AddMemberDto,
  ) {
    return this.companies.addMember(companyId, userId, dto.email, dto.role);
  }

  @Patch(':companyId/members/:memberId')
  @UseGuards(CompanyAccessGuard)
  @RequireCompanyRole('ADMIN')
  updateMember(
    @Param('companyId') companyId: string,
    @Param('memberId') memberId: string,
    @CurrentUser('id') userId: string,
    @Body() dto: UpdateMemberDto,
  ) {
    return this.companies.updateMemberRole(companyId, userId, memberId, dto.role);
  }

  @Delete(':companyId/members/:memberId')
  @UseGuards(CompanyAccessGuard)
  @RequireCompanyRole('ADMIN')
  @HttpCode(204)
  removeMember(
    @Param('companyId') companyId: string,
    @Param('memberId') memberId: string,
    @CurrentUser('id') userId: string,
  ): Promise<void> {
    return this.companies.removeMember(companyId, userId, memberId);
  }

  // ---- Audit trail ------------------------------------------------------

  @Get(':companyId/audit')
  @UseGuards(CompanyAccessGuard)
  @RequireCompanyRole('REVIEWER')
  auditTrail(
    @Param('companyId') companyId: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('entity') entity?: string,
    @Query('entityId') entityId?: string,
  ): Promise<Paginated<AuditLogDto>> {
    return this.audit.list(companyId, {
      page: page ? Number(page) : undefined,
      pageSize: pageSize ? Number(pageSize) : undefined,
      entity,
      entityId,
    });
  }
}
