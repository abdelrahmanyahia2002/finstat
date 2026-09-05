'use client';

import { use } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, RefreshCw } from 'lucide-react';
import { formatAmount, type ValidationIssue } from '@finstat/shared';

import { AppShell, yearNav } from '@/components/app-shell';
import { useCompany, useValidation, useYear } from '@/lib/queries';
import { Badge, Button, Card, PageHeader, Spinner, Stat } from '@/components/ui';

const SEVERITY_ORDER = { ERROR: 0, WARNING: 1, INFO: 2 } as const;

export default function ValidationPage({
  params,
}: {
  params: Promise<{ companyId: string; yearId: string }>;
}) {
  const { companyId, yearId } = use(params);
  const company = useCompany(companyId);
  const { year } = useYear(companyId, yearId);
  const validation = useValidation(companyId, yearId);
  const queryClient = useQueryClient();

  const issues = [...(validation.data?.issues ?? [])].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );

  return (
    <AppShell
      nav={yearNav(companyId, yearId)}
      contextLabel={`${company.data?.name ?? ''} · ${year?.label ?? ''}`}
      contextHref={`/c/${companyId}/y/${yearId}`}
    >
      <PageHeader
        title="Validation"
        description="The checks a reviewer would run by hand before signing anything off."
        actions={
          <Button
            onClick={() =>
              void queryClient.invalidateQueries({ queryKey: ['validation', companyId, yearId] })
            }
            loading={validation.isFetching}
          >
            <RefreshCw className="h-4 w-4" />
            Run again
          </Button>
        }
      />

      {validation.isLoading ? <Spinner label="Running the checks" /> : null}

      {validation.data ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Stat
              label="Errors"
              value={String(validation.data.errorCount)}
              tone={validation.data.errorCount > 0 ? 'bad' : 'good'}
              hint="These stop a year from being locked"
            />
            <Stat
              label="Warnings"
              value={String(validation.data.warningCount)}
              tone={validation.data.warningCount > 0 ? 'warn' : 'good'}
              hint="Worth a look, but not blocking"
            />
            <Stat
              label="Notices"
              value={String(validation.data.infoCount)}
              hint="Things to be aware of"
            />
          </div>

          <Card title={`${issues.length} findings`}>
            {issues.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                <CheckCircle2 className="h-8 w-8 text-accent-500" />
                <h3 className="text-sm font-semibold text-ink-800">Everything ties</h3>
                <p className="max-w-md text-sm text-ink-500">
                  The trial balance balances, the balance sheet closes, the listings agree to their
                  control accounts and the cash flow reconciles to the movement in cash.
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-ink-100">
                {issues.map((issue, index) => (
                  <IssueRow key={`${issue.code}-${index}`} issue={issue} />
                ))}
              </ul>
            )}
          </Card>
        </>
      ) : null}
    </AppShell>
  );
}

function IssueRow({ issue }: { issue: ValidationIssue }) {
  return (
    <li className="flex items-start gap-3 px-5 py-3.5">
      <span className="mt-0.5 shrink-0">
        <Badge
          tone={issue.severity === 'ERROR' ? 'bad' : issue.severity === 'WARNING' ? 'warn' : 'info'}
        >
          {issue.severity.toLowerCase()}
        </Badge>
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-ink-900">{issue.title}</div>
        <p className="mt-0.5 text-sm text-ink-600">{issue.detail}</p>
        {issue.entityLabel ? (
          <p className="mt-1 text-xs text-ink-400">{issue.entityLabel}</p>
        ) : null}
      </div>
      {issue.amount !== undefined ? (
        <span className="tabular shrink-0 text-sm font-medium text-ink-700">
          {formatAmount(issue.amount)}
        </span>
      ) : null}
    </li>
  );
}
