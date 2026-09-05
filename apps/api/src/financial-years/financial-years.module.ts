import { Module } from '@nestjs/common';

import { FinancialYearsController } from './financial-years.controller';
import { FinancialYearsService } from './financial-years.service';
import { FinancialYearScopeGuard } from './year-scope.guard';
import { StatementsModule } from '../statements/statements.module';

@Module({
  imports: [StatementsModule],
  controllers: [FinancialYearsController],
  providers: [FinancialYearsService, FinancialYearScopeGuard],
  exports: [FinancialYearsService],
})
export class FinancialYearsModule {}
