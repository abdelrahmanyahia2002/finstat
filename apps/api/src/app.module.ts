import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullModule } from '@nestjs/bullmq';

import { PrismaModule } from './common/prisma/prisma.module';
import { GlobalRoleGuard, JwtAuthGuard } from './common/guards';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { CompaniesModule } from './companies/companies.module';
import { FinancialYearsModule } from './financial-years/financial-years.module';
import { AccountsModule } from './accounts/accounts.module';
import { TrialBalanceModule } from './trial-balance/trial-balance.module';
import { PartiesModule } from './parties/parties.module';
import { NotesModule } from './notes/notes.module';
import { StatementsModule } from './statements/statements.module';
import { ExcelModule } from './excel/excel.module';
import { PdfModule } from './reports/pdf.module';
import { ReportsModule } from './reports/reports.module';
import { JobsModule } from './jobs/jobs.module';
import { FilesModule } from './files/files.module';
import { SettingsModule } from './settings/settings.module';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: ['.env', '../../.env'] }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: Number(config.get<string>('REDIS_PORT', '6379')),
          ...(config.get<string>('REDIS_PASSWORD')
            ? { password: config.get<string>('REDIS_PASSWORD') }
            : {}),
        },
      }),
    }),
    PrismaModule,
    FilesModule,
    AuditModule,
    AuthModule,
    CompaniesModule,
    StatementsModule,
    FinancialYearsModule,
    AccountsModule,
    TrialBalanceModule,
    PartiesModule,
    NotesModule,
    ExcelModule,
    PdfModule,
    JobsModule,
    ReportsModule,
    SettingsModule,
  ],
  controllers: [HealthController],
  providers: [
    // Authentication is on by default; a route opts out with @Public().
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: GlobalRoleGuard },
  ],
})
export class AppModule {}
