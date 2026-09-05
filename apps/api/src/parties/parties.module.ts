import { Module } from '@nestjs/common';

import { PartiesController } from './parties.controller';
import { PartiesService } from './parties.service';
import { StatementsModule } from '../statements/statements.module';
import { FinancialYearScopeGuard, EditableYearGuard } from '../financial-years/year-scope.guard';

@Module({
  imports: [StatementsModule],
  controllers: [PartiesController],
  providers: [PartiesService, FinancialYearScopeGuard, EditableYearGuard],
  exports: [PartiesService],
})
export class PartiesModule {}
