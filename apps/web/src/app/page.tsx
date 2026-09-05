'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { REPORTING_FRAMEWORKS, type CompanySummary, type ReportingFramework } from '@finstat/shared';

import { api, ApiError } from '@/lib/api';
import { AppShell } from '@/components/app-shell';
import { Alert, Badge, Button, Card, EmptyState, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui';

const FRAMEWORK_LABELS: Record<ReportingFramework, string> = {
  IFRS: 'IFRS',
  IFRS_FOR_SMES: 'IFRS for SMEs',
  LOCAL_GAAP: 'Local GAAP',
  OTHER: 'Other',
};

export default function CompaniesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [currencyCode, setCurrencyCode] = useState('USD');
  const [framework, setFramework] = useState<ReportingFramework>('IFRS_FOR_SMES');

  const companies = useQuery({
    queryKey: ['companies'],
    queryFn: () => api.get<CompanySummary[]>('/companies'),
  });

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) => api.post<{ id: string }>('/companies', input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['companies'] });
      setOpen(false);
      setName('');
      setRegistrationNumber('');
    },
    onError: (caught) =>
      setError(caught instanceof ApiError ? caught.message : 'Could not create the company.'),
  });

  return (
    <AppShell>
      <PageHeader
        title="Companies"
        description="Pick a company to work on, or add a new one."
        actions={
          <Button variant="primary" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" />
            New company
          </Button>
        }
      />

      {companies.isLoading ? <Spinner /> : null}

      {companies.isError ? (
        <Alert tone="bad" title="Could not load your companies">
          {(companies.error as ApiError).message}
        </Alert>
      ) : null}

      {companies.data?.length === 0 ? (
        <Card>
          <EmptyState
            title="Nothing here yet"
            description="Create your first company and FinStat will set up a chart of accounts you can start entering figures against."
            action={
              <Button variant="primary" onClick={() => setOpen(true)}>
                Create a company
              </Button>
            }
          />
        </Card>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {companies.data?.map((company) => (
          <Link
            key={company.id}
            href={`/c/${company.id}`}
            className="group rounded-lg border border-ink-200 bg-white p-4 shadow-sm transition hover:border-ink-300 hover:shadow"
          >
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-900 group-hover:text-ink-700">
                {company.name}
              </h2>
              <Badge tone={company.isActive ? 'neutral' : 'warn'}>
                {company.role.toLowerCase()}
              </Badge>
            </div>

            {company.registrationNumber ? (
              <p className="mt-1 text-xs text-ink-400">{company.registrationNumber}</p>
            ) : null}

            <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-ink-500">
              <div>
                <dt className="inline text-ink-400">Currency </dt>
                <dd className="inline font-medium text-ink-700">{company.currencyCode}</dd>
              </div>
              <div>
                <dt className="inline text-ink-400">Framework </dt>
                <dd className="inline font-medium text-ink-700">
                  {FRAMEWORK_LABELS[company.reportingFramework]}
                </dd>
              </div>
              <div>
                <dt className="inline text-ink-400">Years </dt>
                <dd className="inline font-medium text-ink-700">{company.financialYearCount}</dd>
              </div>
            </dl>

            <p className="mt-3 text-xs text-ink-400">
              {company.currentYearLabel
                ? `Current year: ${company.currentYearLabel}`
                : 'No financial year yet'}
            </p>
          </Link>
        ))}
      </div>

      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title="New company"
        description="You can change any of this later."
      >
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            setError(null);
            create.mutate({
              name,
              registrationNumber: registrationNumber || undefined,
              currencyCode,
              reportingFramework: framework,
            });
          }}
        >
          {error ? <Alert tone="bad">{error}</Alert> : null}

          <Input
            label="Company name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoFocus
          />
          <Input
            label="Registration number"
            value={registrationNumber}
            onChange={(e) => setRegistrationNumber(e.target.value)}
            hint="Optional. It appears on the cover of the statements."
          />
          <div className="grid grid-cols-2 gap-3">
            <Input
              label="Currency"
              value={currencyCode}
              onChange={(e) => setCurrencyCode(e.target.value.toUpperCase().slice(0, 3))}
              maxLength={3}
              required
            />
            <Select
              label="Reporting framework"
              value={framework}
              onChange={(e) => setFramework(e.target.value as ReportingFramework)}
            >
              {REPORTING_FRAMEWORKS.map((value) => (
                <option key={value} value={value}>
                  {FRAMEWORK_LABELS[value]}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" loading={create.isPending}>
              Create company
            </Button>
          </div>
        </form>
      </Modal>
    </AppShell>
  );
}
