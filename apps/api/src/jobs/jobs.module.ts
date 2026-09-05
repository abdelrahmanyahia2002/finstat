import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';

import { JOBS_QUEUE, JobsService } from './jobs.service';
import { JobsController } from './jobs.controller';
import { JobsProcessor } from './jobs.processor';
import { ReportBuilderService } from './report-builder.service';
import { PdfModule } from '../reports/pdf.module';
import { ExcelModule } from '../excel/excel.module';
import { StatementsModule } from '../statements/statements.module';
import { TrialBalanceModule } from '../trial-balance/trial-balance.module';
import { NotesModule } from '../notes/notes.module';
import { PartiesModule } from '../parties/parties.module';

@Module({
  imports: [
    BullModule.registerQueue({ name: JOBS_QUEUE }),
    PdfModule,
    ExcelModule,
    StatementsModule,
    TrialBalanceModule,
    NotesModule,
    PartiesModule,
  ],
  controllers: [JobsController],
  providers: [JobsService, JobsProcessor, ReportBuilderService],
  exports: [JobsService, ReportBuilderService],
})
export class JobsModule {}
