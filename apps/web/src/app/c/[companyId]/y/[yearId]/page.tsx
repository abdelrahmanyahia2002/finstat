'use client';

import Link from 'next/link';
import { use } from 'react';
import { ArrowRight } from 'lucide-react';
import { formatAmount, isYearEditable } from '@finstat/shared';

import { AppShell, yearNav } from '@/components/app-shell';
import { useCompany, useStatements, useSubledger, useYear } from '@/lib/queries';
import { Alert, Badge, Button, Card, PageHeader, Spinner, Stat } from '@/components/ui';

export default function YearOverviewPage({
  params,
}: {
  params: Promise<{ companyId: string; yearId: string }>;
}) {
  const { companyId, yearId } = use(params);
  const company = useCompany(companyId);
  const { year, isLoading: yearsLoading } = useYear(companyId, yearId);
  const statements = useStatements(companyId, yearId);
  const debtors = useSubledger(companyId, yearId, 'DEBTOR');
  const creditors = useSubledger(companyId, yearId, 'CREDITOR');

  const current = statements.data?.current;
  const validation = statements.data?.validation;
  const base = `/c/${companyId}/y/${yearId}`;

  return (
    <AppShell
      nav={yearNav(companyId, yearId)}
      contextLabel={`${company.data?.name ?? ''} · ${year?.label ?? ''}`}
      contextHref={base}
    >
      <PageHeader
        title={year?.label ?? 'Financial year'}
        description={
          year ? `${year.startDate} to ${year.endDate}` : 'Loading this financial year'
        }
        actions={
          year ? (
            <>
              <Badge tone={isYearEditable(year.status) ? 'neutral' : 'warn'}>
                {year.status.toLowerCase()}
              </Badge>
              <Link href={`${base}/statements`}>
                <Button variant="primary">
                  Statements
                  <ArrowRight className="h-4 w-4" />
                </Button>
              </Link>
            </>
          ) : null
        }
      />

      {yearsLoading || statements.isLoading ? <Spinner /> : null}

      {validation ? (
        <div className="mb-4">
          {validation.passed ? (
            <Alert tone="good" title="Every check passed">
              This year is ready to report on.
            </Alert>
          ) : (
            <Alert
              tone="bad"
              title={`${validation.errorCount} ${validation.errorCount === 1 ? 'thing needs' : 'things need'} attention`}
            >
              {validation.issues.find((issue) => issue.severity === 'ERROR')?.detail}{' '}
              <Link href={`${base}/validation`} className="font-medium underline">
                See all findings
              </Link>
            </Alert>
          )}
        </div>
      ) : null}

      {current ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat
              label="Total assets"
              value={formatAmount(current.balanceSheet.totalAssets)}
              hint={
                current.balanceSheet.balanceDifference === 0
                  ? 'The balance sheet closes'
                  : `Out by ${formatAmount(current.balanceSheet.balanceDifference)}`
              }
              tone={current.balanceSheet.balanceDifference === 0 ? 'neutral' : 'bad'}
            />
            <Stat label="Revenue" value={formatAmount(current.income.revenue)} />
            <Stat
              label="Profit for the year"
              value={formatAmount(current.income.profitForYear)}
              tone={current.income.profitForYear >= 0 ? 'good' : 'bad'}
            />
            <Stat
              label="Trial balance"
              value={current.isTrialBalanceBalanced ? 'Balanced' : 'Out'}
              tone={current.isTrialBalanceBalanced ? 'good' : 'bad'}
              hint={
                current.isTrialBalanceBalanced
                  ? `${formatAmount(current.totalDebits)} each side`
                  : `Out by ${formatAmount(current.trialBalanceDifference)}`
              }
            />
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Where the figures sit">
              <dl className="divide-y divide-ink-100 text-sm">
                <Row label="Non-current assets" value={current.balanceSheet.nonCurrentAssets} />
                <Row label="Current assets" value={current.balanceSheet.currentAssets} />
                <Row label="Equity" value={current.balanceSheet.totalEquity} />
                <Row label="Non-current liabilities" value={current.balanceSheet.nonCurrentLiabilities} />
                <Row label="Current liabilities" value={current.balanceSheet.currentLiabilities} />
                <Row label="Gross profit" value={current.income.grossProfit} />
                <Row label="Operating profit" value={current.income.operatingProfit} />
                <Row label="Profit before tax" value={current.income.profitBeforeTax} />
              </dl>
            </Card>

            <div className="space-y-4">
              <Card
                title="Debtors and creditors"
                description="Both listings have to agree to their control accounts."
              >
                <dl className="divide-y divide-ink-100 text-sm">
                  <ControlRow
                    label="Debtors"
                    listing={debtors.data?.totals.total}
                    control={debtors.data?.controlAccountTotal}
                    agrees={debtors.data?.agrees}
                    href={`${base}/debtors`}
                  />
                  <ControlRow
                    label="Creditors"
                    listing={creditors.data?.totals.total}
                    control={creditors.data?.controlAccountTotal}
                    agrees={creditors.data?.agrees}
                    href={`${base}/creditors`}
                  />
                </dl>
              </Card>

              {statements.data?.cashFlow ? (
                <Card title="Cash movement">
                  <dl className="divide-y divide-ink-100 text-sm">
                    <Row label="Opening cash" value={statements.data.cashFlow.totals.openingCash} />
                    <Row
                      label="From operating activities"
                      value={statements.data.cashFlow.totals.netOperating}
                    />
                    <Row
                      label="Used in investing activities"
                      value={statements.data.cashFlow.totals.netInvesting}
                    />
                    <Row
                      label="From financing activities"
                      value={statements.data.cashFlow.totals.netFinancing}
                    />
                    <Row label="Closing cash" value={statements.data.cashFlow.totals.closingCash} />
                  </dl>
                </Card>
              ) : (
                <Card title="Cash movement">
                  <p className="px-5 py-6 text-sm text-ink-500">
                    Link a comparative year and the cash flow statement appears here.
                  </p>
                </Card>
              )}
            </div>
          </div>
        </>
      ) : null}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex items-center justify-between px-5 py-2">
      <dt className="text-ink-600">{label}</dt>
      <dd className={`tabular font-medium ${value < 0 ? 'text-red-600' : 'text-ink-900'}`}>
        {formatAmount(value)}
      </dd>
    </div>
  );
}

function ControlRow({
  label,
  listing,
  control,
  agrees,
  href,
}: {
  label: string;
  listing?: number;
  control?: number;
  agrees?: boolean;
  href: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <div>
        <Link href={href} className="text-ink-700 hover:underline">
          {label}
        </Link>
        <p className="text-xs text-ink-400">
          Listing {formatAmount(listing ?? 0)} against control {formatAmount(control ?? 0)}
        </p>
      </div>
      <Badge tone={agrees === undefined ? 'neutral' : agrees ? 'good' : 'bad'}>
        {agrees === undefined ? '—' : agrees ? 'agrees' : 'does not agree'}
      </Badge>
    </div>
  );
}
