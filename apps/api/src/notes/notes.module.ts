import { Module } from '@nestjs/common';

import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { StatementsModule } from '../statements/statements.module';
import { FinancialYearScopeGuard, EditableYearGuard } from '../financial-years/year-scope.guard';

@Module({
  imports: [StatementsModule],
  controllers: [NotesController],
  providers: [NotesService, FinancialYearScopeGuard, EditableYearGuard],
  exports: [NotesService],
})
export class NotesModule {}
