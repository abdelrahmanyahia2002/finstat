import { createParamDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import type { CompanyRole, GlobalRole } from '@finstat/shared';

export const IS_PUBLIC_KEY = 'isPublic';
/** Opt a route out of the global JWT guard. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const COMPANY_ROLE_KEY = 'requiredCompanyRole';
/** The lowest company role allowed to call this route. */
export const RequireCompanyRole = (role: CompanyRole) => SetMetadata(COMPANY_ROLE_KEY, role);

export const GLOBAL_ROLE_KEY = 'requiredGlobalRole';
export const RequireGlobalRole = (role: GlobalRole) => SetMetadata(GLOBAL_ROLE_KEY, role);

export interface RequestUser {
  id: string;
  email: string;
  name: string;
  globalRole: GlobalRole;
}

export const CurrentUser = createParamDecorator(
  (field: keyof RequestUser | undefined, ctx: ExecutionContext): RequestUser | string => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user as RequestUser;
    return field ? user?.[field] : user;
  },
);

/**
 * The caller's role in the company this request is scoped to, put on the
 * request by CompanyAccessGuard.
 */
export const CompanyRoleOf = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CompanyRole => {
    const request = ctx.switchToHttp().getRequest();
    return request.companyRole;
  },
);
