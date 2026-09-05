import { Controller, Get, Param, ParseBoolPipe, Query, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { StatementsResponse, ValidationReport } from '@finstat/shared';

import { StatementsService } from './statements.service';
import { CompanyAccessGuard } from '../common/guards';
import { FinancialYearScopeGuard } from '../financial-years/year-scope.guard';

@ApiTags('statements')
@Controller('companies/:companyId/years/:yearId')
@UseGuards(CompanyAccessGuard, FinancialYearScopeGuard)
export class StatementsController {
  constructor(private readonly statements: StatementsService) {}

  @Get('statements')
  getStatements(
    @Param('yearId') yearId: string,
    @Query('detailed', new ParseBoolPipe({ optional: true })) detailed?: boolean,
  ): Promise<StatementsResponse> {
    return this.statements.getStatements(yearId, detailed ?? false);
  }

  @Get('validation')
  getValidation(@Param('yearId') yearId: string): Promise<ValidationReport> {
    return this.statements.getValidation(yearId);
  }
}
