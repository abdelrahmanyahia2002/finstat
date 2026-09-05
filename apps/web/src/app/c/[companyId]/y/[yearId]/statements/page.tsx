'use client';

import { use, useState } from 'react';
import { Printer } from 'lucide-react';

import { AppShell, yearNav } from '@/components/app-shell';
import { StatementTable } from '@/components/statement-table';
import { useCompany, useStatements, useYear } from '@/lib/queries';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '@/components/ui';
import type { ApiError } from '@/lib/api';

export default function StatementsPage({
  params,
}: {
  params: Promise<{ companyId: string; yearId: string }>;
}) {
  const { companyId, yearId } = use(params);
  const company = useCompany(companyId);
  const { year } = useYear(companyId, yearId);
  const [detailed, setDetailed] = useState(false);
  const statements = useStatements(companyId, yearId, detailed);

  const validation = statements.data?.validation;

  return (
    <AppShell
      nav={yearNav(companyId, yearId)}
      contextLabel={`${company.data?.name ?? ''} · ${year?.label ?? ''}`}
      contextHref={`/c/${companyId}/y/${yearId}`}
    >
      <div className="no-print">
        <PageHeader
          title="Financial statements"
          description="Built from the trial balance every time you open this page. Nothing here is stored."
          actions={
            <>
              <label className="flex items-center gap-2 text-sm text-ink-600">
                <input
                  type="checkbox"
                  checked={detailed}
                  onChange={(event) => setDetailed(event.target.checked)}
                  className="h-4 w-4 rounded border-ink-300"
                />
                Show account detail
              </label>
              <Button onClick={() => window.print()}>
                <Printer className="h-4 w-4" />
                Print
              </Button>
            </>
          }
        />
      </div>

      {statements.isLoading ? <Spinner label="Building the statements" /> : null}

      {statements.isError ? (
        <Alert tone="bad" title="Could not build the statements">
          {(statements.error as ApiError).message}
        </Alert>
      ) : null}

      {validation && !validation.passed ? (
        <div className="no-print mb-4">
          <Alert
            tone="bad"
            title={`${validation.errorCount} validation ${
              validation.errorCount === 1 ? 'check has' : 'checks have'
            } not passed`}
          >
            The statements below still render, so you can see what is going on, but they should not
            be issued until these are resolved.
            <ul className="mt-1.5 list-inside list-disc space-y-0.5">
              {validation.issues
                .filter((issue) => issue.severity === 'ERROR')
                .slice(0, 3)
                .map((issue, index) => (
                  <li key={index}>{issue.detail}</li>
                ))}
            </ul>
          </Alert>
        </div>
      ) : null}

      {statements.data ? (
        <div className="space-y-5">
          <Card
            title={statements.data.balanceSheet.title}
            description={statements.data.balanceSheet.subtitle}
            className="print-page"
            actions={
              <Badge
                tone={statements.data.current.balanceSheet.balanceDifference === 0 ? 'good' : 'bad'}
              >
                {statements.data.current.balanceSheet.balanceDifference === 0
                  ? 'balances'
                  : 'does not balance'}
              </Badge>
            }
          >
            <StatementTable statement={statements.data.balanceSheet} />
          </Card>

          <Card
            title={statements.data.incomeStatement.title}
            description={statements.data.incomeStatement.subtitle}
            className="print-page"
          >
            <StatementTable statement={statements.data.incomeStatement} />
          </Card>

          {statements.data.cashFlow ? (
            <Card
              title={statements.data.cashFlow.title}
              description={statements.data.cashFlow.subtitle}
              className="print-page"
              actions={
                <Badge
                  tone={
                    statements.data.cashFlow.totals.reconciliationDifference === 0 ? 'good' : 'bad'
                  }
                >
                  {statements.data.cashFlow.totals.reconciliationDifference === 0
                    ? 'reconciles'
                    : 'does not reconcile'}
                </Badge>
              }
            >
              <StatementTable statement={statements.data.cashFlow} />
            </Card>
          ) : (
            <Card title="Statement of cash flows">
              <div className="px-5 py-8 text-center text-sm text-ink-500">
                A cash flow statement compares two balance sheets, so this year needs a comparative
                before it can be produced. Link one on the financial years screen.
              </div>
            </Card>
          )}
        </div>
      ) : null}
    </AppShell>
  );
}
