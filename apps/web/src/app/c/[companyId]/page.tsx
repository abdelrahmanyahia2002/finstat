'use client';

import Link from 'next/link';
import { use } from 'react';
import { ArrowRight, CalendarRange, ListTree } from 'lucide-react';
import { isYearEditable } from '@finstat/shared';

import { AppShell, companyNav } from '@/components/app-shell';
import { Badge, Button, Card, EmptyState, PageHeader, Spinner, Stat } from '@/components/ui';
import { useAccounts, useCompany, useYears } from '@/lib/queries';

export default function CompanyOverviewPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = use(params);
  const company = useCompany(companyId);
  const years = useYears(companyId);
  const accounts = useAccounts(companyId);

  const current = years.data?.find((year) => year.isCurrent) ?? years.data?.[0];
  const unbalanced = years.data?.filter((year) => !year.isBalanced).length ?? 0;

  return (
    <AppShell
      nav={companyNav(companyId)}
      contextLabel={company.data?.name}
      contextHref={`/c/${companyId}`}
    >
      <PageHeader
        title={company.data?.name ?? 'Company'}
        description={
          company.data?.registrationNumber
            ? `Registration ${company.data.registrationNumber}`
            : 'Overview of this company'
        }
        actions={
          current ? (
            <Link href={`/c/${companyId}/y/${current.id}`}>
              <Button variant="primary">
                Open {current.label}
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          ) : null
        }
      />

      {company.isLoading || years.isLoading ? <Spinner /> : null}

      {years.data ? (
        <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Financial years" value={String(years.data.length)} />
          <Stat label="Accounts on the chart" value={String(accounts.data?.length ?? 0)} />
          <Stat label="Current year" value={current?.label ?? 'None yet'} />
          <Stat
            label="Years out of balance"
            value={String(unbalanced)}
            tone={unbalanced > 0 ? 'bad' : 'good'}
          />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Financial years"
          description="Each year holds its own trial balance, listings and notes."
          actions={
            <Link href={`/c/${companyId}/years`}>
              <Button size="sm">Manage</Button>
            </Link>
          }
        >
          {years.data?.length === 0 ? (
            <EmptyState
              title="No financial years yet"
              description="Add the first year and you can start capturing a trial balance against it."
              action={
                <Link href={`/c/${companyId}/years`}>
                  <Button variant="primary">
                    <CalendarRange className="h-4 w-4" />
                    Add a year
                  </Button>
                </Link>
              }
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {years.data?.map((year) => (
                <li key={year.id}>
                  <Link
                    href={`/c/${companyId}/y/${year.id}`}
                    className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-ink-50"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-ink-900">{year.label}</span>
                        {year.isCurrent ? <Badge tone="info">current</Badge> : null}
                        <Badge tone={isYearEditable(year.status) ? 'neutral' : 'warn'}>
                          {year.status.toLowerCase()}
                        </Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-ink-400">
                        {year.startDate} to {year.endDate}
                        {year.previousYearLabel ? ` · compares to ${year.previousYearLabel}` : ''}
                      </p>
                    </div>
                    <Badge tone={year.isBalanced ? 'good' : 'bad'}>
                      {year.isBalanced ? 'balances' : 'out of balance'}
                    </Badge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card
          title="Chart of accounts"
          description="Every account is mapped to a line in the statements."
          actions={
            <Link href={`/c/${companyId}/accounts`}>
              <Button size="sm">Open</Button>
            </Link>
          }
        >
          {accounts.data?.length === 0 ? (
            <EmptyState
              title="No accounts yet"
              description="Apply the standard chart to get going in one click, then rename anything that does not fit."
              action={
                <Link href={`/c/${companyId}/accounts`}>
                  <Button variant="primary">
                    <ListTree className="h-4 w-4" />
                    Set up the chart
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="px-5 py-4">
              <p className="text-sm text-ink-600">
                {accounts.data?.length} active accounts.{' '}
                {accounts.data?.filter((a) => !a.section).length ?? 0} still need a reporting
                category.
              </p>
              <ul className="mt-3 space-y-1.5">
                {accounts.data?.slice(0, 6).map((account) => (
                  <li key={account.id} className="flex items-center gap-3 text-xs">
                    <span className="tabular w-14 shrink-0 text-ink-400">{account.code}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-700">{account.name}</span>
                    {account.section ? null : <Badge tone="bad">unmapped</Badge>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>
    </AppShell>
  );
}
