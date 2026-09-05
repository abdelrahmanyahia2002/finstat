import { Module } from '@nestjs/common';

import { TrialBalanceController } from './trial-balance.controller';
import { TrialBalanceService } from './trial-balance.service';
import { FinancialYearScopeGuard, EditableYearGuard } from '../financial-years/year-scope.guard';

@Module({
  controllers: [TrialBalanceController],
  providers: [TrialBalanceService, FinancialYearScopeGuard, EditableYearGuard],
  exports: [TrialBalanceService],
})
export class TrialBalanceModule {}
