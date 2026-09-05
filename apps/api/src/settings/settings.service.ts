import { Injectable } from '@nestjs/common';
import type { CompanySettings } from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

const DISPLAY_KEY = 'display';

interface DisplayPreferences {
  decimals: number;
  negativeStyle: 'PARENTHESES' | 'MINUS';
  showCents: boolean;
}

const DISPLAY_DEFAULTS: DisplayPreferences = {
  decimals: 2,
  negativeStyle: 'PARENTHESES',
  showCents: true,
};

@Injectable()
export class SettingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Settings come from two places: the ones that identify the company live on
   * the company record, and the ones that only affect how figures are drawn
   * live in a key value row. This merges both into the one shape the UI wants.
   */
  async get(companyId: string): Promise<CompanySettings> {
    const [company, setting] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId } }),
      this.prisma.setting.findUnique({
        where: { companyId_key: { companyId, key: DISPLAY_KEY } },
      }),
    ]);

    const display = { ...DISPLAY_DEFAULTS, ...(setting?.value as Partial<DisplayPreferences> | null) };

    return {
      currencyCode: company.currencyCode,
      currencySymbol: company.currencySymbol,
      locale: company.locale,
      decimals: display.decimals,
      negativeStyle: display.negativeStyle,
      showCents: display.showCents,
      reportFooter: company.reportFooter,
      preparedBy: company.preparedBy,
      approvedBy: company.approvedBy,
      logoUrl: company.logoUrl,
    };
  }

  async update(
    companyId: string,
    userId: string,
    input: Partial<CompanySettings>,
  ): Promise<CompanySettings> {
    const companyFields = {
      ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode } : {}),
      ...(input.currencySymbol !== undefined ? { currencySymbol: input.currencySymbol } : {}),
      ...(input.locale !== undefined ? { locale: input.locale } : {}),
      ...(input.reportFooter !== undefined ? { reportFooter: input.reportFooter || null } : {}),
      ...(input.preparedBy !== undefined ? { preparedBy: input.preparedBy || null } : {}),
      ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy || null } : {}),
      ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
    };

    if (Object.keys(companyFields).length > 0) {
      await this.prisma.company.update({ where: { id: companyId }, data: companyFields });
    }

    const touchesDisplay =
      input.decimals !== undefined ||
      input.negativeStyle !== undefined ||
      input.showCents !== undefined;

    if (touchesDisplay) {
      const current = await this.get(companyId);
      // Written as a literal: a named interface has no index signature, which
      // Prisma's JSON column type requires.
      const display = {
        decimals: input.decimals ?? current.decimals,
        negativeStyle: input.negativeStyle ?? current.negativeStyle,
        showCents: input.showCents ?? current.showCents,
      };

      await this.prisma.setting.upsert({
        where: { companyId_key: { companyId, key: DISPLAY_KEY } },
        create: { companyId, key: DISPLAY_KEY, value: { ...display } },
        update: { value: { ...display } },
      });
    }

    await this.audit.record({
      companyId,
      userId,
      action: 'SETTINGS_UPDATED',
      entity: 'Company',
      entityId: companyId,
      summary: `Updated ${Object.keys(input).join(', ')}`,
    });

    return this.get(companyId);
  }
}
