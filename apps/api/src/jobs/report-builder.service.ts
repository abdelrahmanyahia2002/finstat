import { Injectable, NotFoundException } from '@nestjs/common';
import type { ReportKind } from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { StatementsService } from '../statements/statements.service';
import { TrialBalanceService } from '../trial-balance/trial-balance.service';
import { NotesService } from '../notes/notes.service';
import { PartiesService } from '../parties/parties.service';
import type { ReportContext } from '../reports/pdf.service';

/**
 * Everything a report needs, gathered once.
 *
 * A PDF, an Excel pack and the on-screen statements all read from the same
 * assembled context, so a figure cannot differ between what a preparer sees and
 * what gets sent to the auditor.
 */
@Injectable()
export class ReportBuilderService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly statements: StatementsService,
    private readonly trialBalance: TrialBalanceService,
    private readonly notes: NotesService,
    private readonly parties: PartiesService,
  ) {}

  async build(companyId: string, financialYearId: string, kind: ReportKind): Promise<ReportContext> {
    const year = await this.prisma.financialYear.findUnique({
      where: { id: financialYearId },
      include: { company: true },
    });
    if (!year || year.companyId !== companyId) {
      throw new NotFoundException('That financial year was not found.');
    }

    const [statements, trialBalance, notes, debtors, creditors] = await Promise.all([
      this.statements.getStatements(financialYearId),
      this.trialBalance.get(companyId, financialYearId),
      this.notes.list(financialYearId),
      this.parties.getSubledger(companyId, financialYearId, 'DEBTOR'),
      this.parties.getSubledger(companyId, financialYearId, 'CREDITOR'),
    ]);

    return {
      kind,
      statements,
      trialBalance,
      notes,
      debtors,
      creditors,
      company: {
        name: year.company.name,
        registrationNumber: year.company.registrationNumber,
        currencyCode: year.company.currencyCode,
        reportingFramework: year.company.reportingFramework,
        preparedBy: year.company.preparedBy,
        approvedBy: year.company.approvedBy,
        reportFooter: year.company.reportFooter,
      },
      yearLabel: year.label,
      periodEnd: year.endDate.toISOString().slice(0, 10),
    };
  }
}
