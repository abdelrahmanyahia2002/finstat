import { Module } from '@nestjs/common';

import { ReportsController } from './reports.controller';
import { ExcelModule } from '../excel/excel.module';
import { JobsModule } from '../jobs/jobs.module';
import { TrialBalanceModule } from '../trial-balance/trial-balance.module';
import { FinancialYearScopeGuard, EditableYearGuard } from '../financial-years/year-scope.guard';

@Module({
  imports: [ExcelModule, JobsModule, TrialBalanceModule],
  controllers: [ReportsController],
  providers: [FinancialYearScopeGuard, EditableYearGuard],
})
export class ReportsModule {}
