'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  AccountDto,
  AuditLogDto,
  CompanySettings,
  CompanySummary,
  FinancialYearSummary,
  JobDto,
  NoteDto,
  Paginated,
  PartyType,
  StatementsResponse,
  SubledgerResponse,
  TrialBalanceResponse,
  ValidationReport,
} from '@finstat/shared';

import { api } from './api';

export interface CompanyDetail {
  id: string;
  name: string;
  registrationNumber: string | null;
  taxNumber: string | null;
  currencyCode: string;
  currencySymbol: string;
  locale: string;
  country: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  postalCode: string | null;
  reportingFramework: CompanySummary['reportingFramework'];
  preparedBy: string | null;
  approvedBy: string | null;
  reportFooter: string | null;
  isActive: boolean;
}

export interface MemberDto {
  id: string;
  userId: string;
  name: string;
  email: string;
  role: CompanySummary['role'];
  isActive: boolean;
  joinedAt: string;
}

export interface SectionOption {
  section: string;
  label: string;
  statement: 'BALANCE_SHEET' | 'INCOME_STATEMENT';
  group: string;
  accountType: AccountDto['type'];
}

export const useCompanies = () =>
  useQuery({ queryKey: ['companies'], queryFn: () => api.get<CompanySummary[]>('/companies') });

export const useCompany = (companyId: string) =>
  useQuery({
    queryKey: ['company', companyId],
    queryFn: () => api.get<CompanyDetail>(`/companies/${companyId}`),
    enabled: Boolean(companyId),
  });

export const useYears = (companyId: string) =>
  useQuery({
    queryKey: ['years', companyId],
    queryFn: () => api.get<FinancialYearSummary[]>(`/companies/${companyId}/years`),
    enabled: Boolean(companyId),
  });

export const useAccounts = (companyId: string, includeInactive = false) =>
  useQuery({
    queryKey: ['accounts', companyId, includeInactive],
    queryFn: () =>
      api.get<AccountDto[]>(
        `/companies/${companyId}/accounts${includeInactive ? '?includeInactive=true' : ''}`,
      ),
    enabled: Boolean(companyId),
  });

export const useSections = (companyId: string) =>
  useQuery({
    queryKey: ['sections', companyId],
    queryFn: () => api.get<SectionOption[]>(`/companies/${companyId}/accounts/sections`),
    enabled: Boolean(companyId),
    // The taxonomy only changes when the app is redeployed.
    staleTime: Infinity,
  });

export const useMembers = (companyId: string) =>
  useQuery({
    queryKey: ['members', companyId],
    queryFn: () => api.get<MemberDto[]>(`/companies/${companyId}/members`),
    enabled: Boolean(companyId),
  });

export const useSettings = (companyId: string) =>
  useQuery({
    queryKey: ['settings', companyId],
    queryFn: () => api.get<CompanySettings>(`/companies/${companyId}/settings`),
    enabled: Boolean(companyId),
  });

export const useAuditTrail = (companyId: string, page: number) =>
  useQuery({
    queryKey: ['audit', companyId, page],
    queryFn: () =>
      api.get<Paginated<AuditLogDto>>(`/companies/${companyId}/audit?page=${page}&pageSize=50`),
    enabled: Boolean(companyId),
  });

export const useTrialBalance = (companyId: string, yearId: string) =>
  useQuery({
    queryKey: ['trial-balance', companyId, yearId],
    queryFn: () =>
      api.get<TrialBalanceResponse>(`/companies/${companyId}/years/${yearId}/trial-balance`),
    enabled: Boolean(companyId && yearId),
  });

export const useStatements = (companyId: string, yearId: string, detailed = false) =>
  useQuery({
    queryKey: ['statements', companyId, yearId, detailed],
    queryFn: () =>
      api.get<StatementsResponse>(
        `/companies/${companyId}/years/${yearId}/statements${detailed ? '?detailed=true' : ''}`,
      ),
    enabled: Boolean(companyId && yearId),
  });

export const useValidation = (companyId: string, yearId: string) =>
  useQuery({
    queryKey: ['validation', companyId, yearId],
    queryFn: () =>
      api.get<ValidationReport>(`/companies/${companyId}/years/${yearId}/validation`),
    enabled: Boolean(companyId && yearId),
  });

export const useSubledger = (companyId: string, yearId: string, type: PartyType) =>
  useQuery({
    queryKey: ['subledger', companyId, yearId, type],
    queryFn: () =>
      api.get<SubledgerResponse>(
        `/companies/${companyId}/years/${yearId}/subledger?type=${type}`,
      ),
    enabled: Boolean(companyId && yearId),
  });

export const useNotes = (companyId: string, yearId: string) =>
  useQuery({
    queryKey: ['notes', companyId, yearId],
    queryFn: () => api.get<NoteDto[]>(`/companies/${companyId}/years/${yearId}/notes`),
    enabled: Boolean(companyId && yearId),
  });

/**
 * Jobs are the one thing worth polling: a report is being built somewhere else
 * and nothing else will tell the page it finished. Polling stops as soon as
 * everything has settled.
 */
export const useJobs = (companyId: string) =>
  useQuery({
    queryKey: ['jobs', companyId],
    queryFn: () => api.get<JobDto[]>(`/companies/${companyId}/jobs?limit=20`),
    enabled: Boolean(companyId),
    refetchInterval: (query) => {
      const jobs = query.state.data;
      if (!jobs) return false;
      const busy = jobs.some((job) => job.status === 'QUEUED' || job.status === 'PROCESSING');
      return busy ? 1200 : false;
    },
  });

/** Everything a year page needs to render its header and guard its writes. */
export function useYear(companyId: string, yearId: string) {
  const years = useYears(companyId);
  const year = years.data?.find((candidate) => candidate.id === yearId) ?? null;
  return { ...years, year };
}
