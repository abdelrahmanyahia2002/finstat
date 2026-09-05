import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CompanyRole, CompanySummary, ReportingFramework } from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

export interface CreateCompanyInput {
  name: string;
  registrationNumber?: string;
  taxNumber?: string;
  currencyCode?: string;
  currencySymbol?: string;
  locale?: string;
  country?: string;
  reportingFramework?: ReportingFramework;
}

export type UpdateCompanyInput = Partial<
  CreateCompanyInput & {
    addressLine1: string;
    addressLine2: string;
    city: string;
    postalCode: string;
    preparedBy: string;
    approvedBy: string;
    reportFooter: string;
    logoUrl: string;
    isActive: boolean;
  }
>;

@Injectable()
export class CompaniesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async listForUser(userId: string, globalRole: string): Promise<CompanySummary[]> {
    const memberships = await this.prisma.companyUser.findMany({
      where: { userId },
      include: {
        company: {
          include: {
            financialYears: {
              orderBy: { startDate: 'desc' },
              select: { id: true, label: true, isCurrent: true },
            },
          },
        },
      },
      orderBy: { company: { name: 'asc' } },
    });

    const summaries: CompanySummary[] = memberships.map((m) => ({
      id: m.company.id,
      name: m.company.name,
      registrationNumber: m.company.registrationNumber,
      currencyCode: m.company.currencyCode,
      reportingFramework: m.company.reportingFramework,
      isActive: m.company.isActive,
      role: m.role,
      financialYearCount: m.company.financialYears.length,
      currentYearLabel:
        m.company.financialYears.find((y) => y.isCurrent)?.label ??
        m.company.financialYears[0]?.label ??
        null,
    }));

    if (globalRole !== 'SUPERADMIN') return summaries;

    // A platform administrator also sees companies they are not a member of.
    const known = new Set(summaries.map((s) => s.id));
    const others = await this.prisma.company.findMany({
      where: { id: { notIn: [...known] } },
      include: {
        financialYears: {
          orderBy: { startDate: 'desc' },
          select: { id: true, label: true, isCurrent: true },
        },
      },
      orderBy: { name: 'asc' },
    });

    return [
      ...summaries,
      ...others.map((c) => ({
        id: c.id,
        name: c.name,
        registrationNumber: c.registrationNumber,
        currencyCode: c.currencyCode,
        reportingFramework: c.reportingFramework,
        isActive: c.isActive,
        role: 'OWNER' as CompanyRole,
        financialYearCount: c.financialYears.length,
        currentYearLabel:
          c.financialYears.find((y) => y.isCurrent)?.label ?? c.financialYears[0]?.label ?? null,
      })),
    ];
  }

  async get(companyId: string) {
    const company = await this.prisma.company.findUnique({ where: { id: companyId } });
    if (!company) throw new NotFoundException('That company was not found.');
    return company;
  }

  async create(userId: string, input: CreateCompanyInput) {
    const company = await this.prisma.company.create({
      data: {
        name: input.name.trim(),
        registrationNumber: input.registrationNumber?.trim() || null,
        taxNumber: input.taxNumber?.trim() || null,
        currencyCode: input.currencyCode ?? 'USD',
        currencySymbol: input.currencySymbol ?? '$',
        locale: input.locale ?? 'en-US',
        country: input.country?.trim() || null,
        reportingFramework: input.reportingFramework ?? 'IFRS_FOR_SMES',
        members: { create: { userId, role: 'OWNER' } },
      },
    });

    await this.audit.record({
      companyId: company.id,
      userId,
      action: 'COMPANY_CREATED',
      entity: 'Company',
      entityId: company.id,
      summary: `Created ${company.name}`,
    });

    return company;
  }

  async update(companyId: string, userId: string, input: UpdateCompanyInput) {
    const before = await this.get(companyId);

    const company = await this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...(input.name !== undefined ? { name: input.name.trim() } : {}),
        ...(input.registrationNumber !== undefined
          ? { registrationNumber: input.registrationNumber || null }
          : {}),
        ...(input.taxNumber !== undefined ? { taxNumber: input.taxNumber || null } : {}),
        ...(input.currencyCode !== undefined ? { currencyCode: input.currencyCode } : {}),
        ...(input.currencySymbol !== undefined ? { currencySymbol: input.currencySymbol } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
        ...(input.country !== undefined ? { country: input.country || null } : {}),
        ...(input.reportingFramework !== undefined
          ? { reportingFramework: input.reportingFramework }
          : {}),
        ...(input.addressLine1 !== undefined ? { addressLine1: input.addressLine1 || null } : {}),
        ...(input.addressLine2 !== undefined ? { addressLine2: input.addressLine2 || null } : {}),
        ...(input.city !== undefined ? { city: input.city || null } : {}),
        ...(input.postalCode !== undefined ? { postalCode: input.postalCode || null } : {}),
        ...(input.preparedBy !== undefined ? { preparedBy: input.preparedBy || null } : {}),
        ...(input.approvedBy !== undefined ? { approvedBy: input.approvedBy || null } : {}),
        ...(input.reportFooter !== undefined ? { reportFooter: input.reportFooter || null } : {}),
        ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl || null } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
      },
    });

    await this.audit.record({
      companyId,
      userId,
      action: 'COMPANY_UPDATED',
      entity: 'Company',
      entityId: companyId,
      summary: `Updated ${company.name}`,
      before: { name: before.name, currencyCode: before.currencyCode },
      after: { name: company.name, currencyCode: company.currencyCode },
    });

    return company;
  }

  async remove(companyId: string, userId: string): Promise<void> {
    const company = await this.get(companyId);
    await this.prisma.company.delete({ where: { id: companyId } });
    await this.audit.record({
      userId,
      action: 'COMPANY_DELETED',
      entity: 'Company',
      entityId: companyId,
      summary: `Deleted ${company.name}`,
    });
  }

  // ---- Members ----------------------------------------------------------

  async listMembers(companyId: string) {
    const members = await this.prisma.companyUser.findMany({
      where: { companyId },
      include: { user: { select: { id: true, name: true, email: true, isActive: true } } },
      orderBy: { createdAt: 'asc' },
    });

    return members.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.user.name,
      email: m.user.email,
      role: m.role,
      isActive: m.user.isActive,
      joinedAt: m.createdAt.toISOString(),
    }));
  }

  async addMember(companyId: string, actorId: string, email: string, role: CompanyRole) {
    const user = await this.prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (!user) {
      throw new NotFoundException('No account uses that email address yet.');
    }

    const existing = await this.prisma.companyUser.findUnique({
      where: { companyId_userId: { companyId, userId: user.id } },
    });
    if (existing) {
      throw new BadRequestException(`${user.name} is already on this company.`);
    }

    const membership = await this.prisma.companyUser.create({
      data: { companyId, userId: user.id, role },
    });

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'MEMBER_ADDED',
      entity: 'CompanyUser',
      entityId: membership.id,
      summary: `Added ${user.email} as ${role.toLowerCase()}`,
    });

    return membership;
  }

  async updateMemberRole(companyId: string, actorId: string, memberId: string, role: CompanyRole) {
    const membership = await this.prisma.companyUser.findUnique({
      where: { id: memberId },
      include: { user: { select: { email: true } } },
    });
    if (!membership || membership.companyId !== companyId) {
      throw new NotFoundException('That member was not found.');
    }

    if (membership.role === 'OWNER' && role !== 'OWNER') {
      await this.assertNotLastOwner(companyId, memberId);
    }

    const updated = await this.prisma.companyUser.update({
      where: { id: memberId },
      data: { role },
    });

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'MEMBER_ROLE_CHANGED',
      entity: 'CompanyUser',
      entityId: memberId,
      summary: `${membership.user.email} is now ${role.toLowerCase()}`,
    });

    return updated;
  }

  async removeMember(companyId: string, actorId: string, memberId: string): Promise<void> {
    const membership = await this.prisma.companyUser.findUnique({
      where: { id: memberId },
      include: { user: { select: { email: true } } },
    });
    if (!membership || membership.companyId !== companyId) {
      throw new NotFoundException('That member was not found.');
    }

    if (membership.role === 'OWNER') {
      await this.assertNotLastOwner(companyId, memberId);
    }

    await this.prisma.companyUser.delete({ where: { id: memberId } });

    await this.audit.record({
      companyId,
      userId: actorId,
      action: 'MEMBER_REMOVED',
      entity: 'CompanyUser',
      entityId: memberId,
      summary: `Removed ${membership.user.email}`,
    });
  }

  /** A company without an owner can never be administered again. */
  private async assertNotLastOwner(companyId: string, memberId: string): Promise<void> {
    const owners = await this.prisma.companyUser.count({
      where: { companyId, role: 'OWNER', id: { not: memberId } },
    });
    if (owners === 0) {
      throw new ForbiddenException(
        'This is the only owner. Make somebody else an owner first.',
      );
    }
  }
}
