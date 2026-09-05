import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { isYearEditable } from '@finstat/shared';

import { PrismaService } from '../common/prisma/prisma.service';

/**
 * Confirms the financial year in the URL belongs to the company in the URL.
 *
 * Without this a member of company A could read company B's figures simply by
 * pairing their own company id with a year id they guessed, because the
 * company guard only ever checks the company.
 *
 * It also puts the year on the request, so routes that write can refuse a year
 * that has been locked or closed without loading it again.
 */
@Injectable()
export class FinancialYearScopeGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const companyId: string | undefined = request.params?.companyId;
    const yearId: string | undefined = request.params?.yearId;

    if (!companyId || !yearId) {
      throw new BadRequestException('A company and a financial year are required.');
    }

    const year = await this.prisma.financialYear.findUnique({
      where: { id: yearId },
      select: { id: true, companyId: true, status: true, label: true },
    });

    if (!year || year.companyId !== companyId) {
      throw new NotFoundException('That financial year was not found.');
    }

    request.financialYear = year;
    return true;
  }
}

/**
 * Applied on top of the scope guard for routes that change figures. Reading a
 * locked year is fine; writing to one is not.
 */
@Injectable()
export class EditableYearGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    const year = request.financialYear as { status: string; label: string } | undefined;

    if (!year) {
      throw new NotFoundException('That financial year was not found.');
    }

    if (!isYearEditable(year.status as never)) {
      throw new ForbiddenException(
        `${year.label} is ${year.status.toLowerCase()}. Reopen it before changing any figures.`,
      );
    }

    return true;
  }
}
