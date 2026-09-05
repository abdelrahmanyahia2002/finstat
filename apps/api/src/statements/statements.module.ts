import { Module } from '@nestjs/common';

import { PeriodService } from './period.service';
import { StatementsService } from './statements.service';
import { StatementsController } from './statements.controller';
import { FinancialYearScopeGuard } from '../financial-years/year-scope.guard';

@Module({
  controllers: [StatementsController],
  providers: [PeriodService, StatementsService, FinancialYearScopeGuard],
  exports: [PeriodService, StatementsService],
})
export class StatementsModule {}
