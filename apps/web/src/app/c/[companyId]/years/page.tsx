'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, CalendarPlus, FastForward, Trash2 } from 'lucide-react';
import {
  FINANCIAL_YEAR_STATUSES,
  type FinancialYearStatus,
  type FinancialYearSummary,
} from '@finstat/shared';

import { api, ApiError } from '@/lib/api';
import { AppShell, companyNav } from '@/components/app-shell';
import { useCompany, useYears } from '@/lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Select,
  Spinner,
} from '@/components/ui';

export default function FinancialYearsPage({
  params,
}: {
  params: Promise<{ companyId: string }>;
}) {
  const { companyId } = use(params);
  const company = useCompany(companyId);
  const years = useYears(companyId);
  const queryClient = useQueryClient();

  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [carryFrom, setCarryFrom] = useState<FinancialYearSummary | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['years', companyId] });

  function report(caught: unknown, fallback: string) {
    setMessage({
      tone: 'bad',
      text: caught instanceof ApiError ? caught.message : fallback,
    });
  }

  const create = useMutation({
    mutationFn: (input: Record<string, unknown>) =>
      api.post(`/companies/${companyId}/years`, input),
    onSuccess: async () => {
      await refresh();
      setCreateOpen(false);
      setMessage({ tone: 'good', text: 'The financial year is ready.' });
    },
    onError: (caught) => report(caught, 'Could not create the year.'),
  });

  const carry = useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) =>
      api.post(`/companies/${companyId}/years/${id}/carry-forward`, input),
    onSuccess: async (result: unknown) => {
      await refresh();
      setCarryFrom(null);
      const count = (result as { openingBalanceCount?: number })?.openingBalanceCount ?? 0;
      setMessage({
        tone: 'good',
        text: `Carried forward with ${count} opening balances. The new year is now the current one.`,
      });
    },
    onError: (caught) => report(caught, 'Could not carry the year forward.'),
  });

  const setStatus = useMutation({
    mutationFn: ({ id, status }: { id: string; status: FinancialYearStatus }) =>
      api.patch(`/companies/${companyId}/years/${id}/status`, { status }),
    onSuccess: async () => {
      await refresh();
      setMessage({ tone: 'good', text: 'Status updated.' });
    },
    onError: (caught) => report(caught, 'Could not change the status.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/companies/${companyId}/years/${id}`),
    onSuccess: async () => {
      await refresh();
      setMessage({ tone: 'good', text: 'The year was deleted.' });
    },
    onError: (caught) => report(caught, 'Could not delete the year.'),
  });

  const latest = years.data?.[0];

  return (
    <AppShell
      nav={companyNav(companyId)}
      contextLabel={company.data?.name}
      contextHref={`/c/${companyId}`}
    >
      <PageHeader
        title="Financial years"
        description="A year holds one trial balance, its listings, its notes and its statements."
        actions={
          <Button variant="primary" onClick={() => setCreateOpen(true)}>
            <CalendarPlus className="h-4 w-4" />
            New year
          </Button>
        }
      />

      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        </div>
      ) : null}

      {years.isLoading ? <Spinner /> : null}

      <Card>
        {years.data?.length === 0 ? (
          <EmptyState
            title="No financial years yet"
            description="Create the first one. After that, each following year is one click from the year before it."
            action={
              <Button variant="primary" onClick={() => setCreateOpen(true)}>
                Create the first year
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-100 text-left text-xs text-ink-500">
                  <th className="px-5 py-2.5 font-medium">Year</th>
                  <th className="px-3 py-2.5 font-medium">Period</th>
                  <th className="px-3 py-2.5 font-medium">Comparative</th>
                  <th className="px-3 py-2.5 font-medium">Balances</th>
                  <th className="px-3 py-2.5 font-medium">Status</th>
                  <th className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {years.data?.map((year) => (
                  <tr key={year.id} className="hover:bg-ink-50">
                    <td className="px-5 py-3">
                      <Link
                        href={`/c/${companyId}/y/${year.id}`}
                        className="font-medium text-ink-900 hover:underline"
                      >
                        {year.label}
                      </Link>
                      {year.isCurrent ? (
                        <span className="ml-2">
                          <Badge tone="info">current</Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-500">
                      {year.startDate} to {year.endDate}
                    </td>
                    <td className="px-3 py-3 text-xs text-ink-500">
                      {year.previousYearLabel ?? 'None'}
                    </td>
                    <td className="px-3 py-3">
                      <Badge tone={year.isBalanced ? 'good' : 'bad'}>
                        {year.isBalanced ? 'balances' : 'out of balance'}
                      </Badge>
                      <span className="ml-2 text-xs text-ink-400">
                        {year.accountCount} accounts
                      </span>
                    </td>
                    <td className="px-3 py-3">
                      <Select
                        value={year.status}
                        onChange={(event) =>
                          setStatus.mutate({
                            id: year.id,
                            status: event.target.value as FinancialYearStatus,
                          })
                        }
                        className="py-1 text-xs"
                      >
                        {FINANCIAL_YEAR_STATUSES.map((status) => (
                          <option key={status} value={status}>
                            {status.toLowerCase()}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="sm"
                          onClick={() => {
                            setMessage(null);
                            setCarryFrom(year);
                          }}
                          title="Open the next year from this one"
                        >
                          <FastForward className="h-3.5 w-3.5" />
                          Carry forward
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => {
                            if (
                              window.confirm(
                                `Delete ${year.label}? Its trial balance, listings and notes go with it.`,
                              )
                            ) {
                              remove.mutate(year.id);
                            }
                          }}
                          aria-label={`Delete ${year.label}`}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                        <Link href={`/c/${companyId}/y/${year.id}`}>
                          <Button size="sm" variant="ghost" aria-label={`Open ${year.label}`}>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <CreateYearModal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        years={years.data ?? []}
        suggestedPrevious={latest?.id ?? null}
        busy={create.isPending}
        onSubmit={(input) => {
          setMessage(null);
          create.mutate(input);
        }}
      />

      <CarryForwardModal
        source={carryFrom}
        onClose={() => setCarryFrom(null)}
        busy={carry.isPending}
        onSubmit={(input) => {
          if (!carryFrom) return;
          setMessage(null);
          carry.mutate({ id: carryFrom.id, ...input });
        }}
      />
    </AppShell>
  );
}

function CreateYearModal({
  open,
  onClose,
  years,
  suggestedPrevious,
  busy,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  years: FinancialYearSummary[];
  suggestedPrevious: string | null;
  busy: boolean;
  onSubmit: (input: Record<string, unknown>) => void;
}) {
  const thisYear = new Date().getFullYear();
  const [label, setLabel] = useState(`FY${thisYear}`);
  const [startDate, setStartDate] = useState(`${thisYear}-01-01`);
  const [endDate, setEndDate] = useState(`${thisYear}-12-31`);
  const [previousYearId, setPreviousYearId] = useState(suggestedPrevious ?? '');
  const [makeCurrent, setMakeCurrent] = useState(true);

  // Years already used as somebody's comparative cannot be reused.
  const takenAsComparative = new Set(years.map((y) => y.previousYearId).filter(Boolean));

  return (
    <Modal open={open} onClose={onClose} title="New financial year">
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({
            label,
            startDate,
            endDate,
            previousYearId: previousYearId || undefined,
            makeCurrent,
          });
        }}
      >
        <Input label="Name" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Starts"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          <Input
            label="Ends"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>

        <Select
          label="Comparative year"
          value={previousYearId}
          onChange={(e) => setPreviousYearId(e.target.value)}
        >
          <option value="">No comparatives</option>
          {years
            .filter((year) => !takenAsComparative.has(year.id))
            .map((year) => (
              <option key={year.id} value={year.id}>
                {year.label}
              </option>
            ))}
        </Select>

        <label className="flex items-center gap-2 pt-1 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={makeCurrent}
            onChange={(e) => setMakeCurrent(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300"
          />
          Make this the current year
        </label>

        <p className="text-xs text-ink-400">
          Without comparatives the statements print one column and no cash flow statement, because a
          cash flow needs two balance sheets to compare.
        </p>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy}>
            Create year
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CarryForwardModal({
  source,
  onClose,
  busy,
  onSubmit,
}: {
  source: FinancialYearSummary | null;
  onClose: () => void;
  busy: boolean;
  onSubmit: (input: Record<string, unknown>) => void;
}) {
  const nextYear = source ? Number(source.endDate.slice(0, 4)) + 1 : new Date().getFullYear();
  const [label, setLabel] = useState(`FY${nextYear}`);
  const [startDate, setStartDate] = useState(`${nextYear}-01-01`);
  const [endDate, setEndDate] = useState(`${nextYear}-12-31`);
  const [closeSourceYear, setCloseSourceYear] = useState(false);

  if (!source) return null;

  return (
    <Modal
      open
      onClose={onClose}
      title={`Carry ${source.label} forward`}
      description="Balance sheet accounts open where they closed. Profit and loss accounts start at nil."
    >
      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit({ label, startDate, endDate, closeSourceYear, copyNotes: true, copySubledgers: true });
        }}
      >
        {source.isBalanced ? null : (
          <Alert tone="bad" title={`${source.label} does not balance`}>
            A year has to balance before it can be carried forward, otherwise the difference travels
            into next year where nobody will recognise it.
          </Alert>
        )}

        <Input label="New year name" value={label} onChange={(e) => setLabel(e.target.value)} required />
        <div className="grid grid-cols-2 gap-3">
          <Input
            label="Starts"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
          />
          <Input
            label="Ends"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            required
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-ink-700">
          <input
            type="checkbox"
            checked={closeSourceYear}
            onChange={(e) => setCloseSourceYear(e.target.checked)}
            className="h-4 w-4 rounded border-ink-300"
          />
          Close {source.label} so its figures stop moving
        </label>

        <div className="rounded-md bg-ink-50 px-3 py-2.5 text-xs text-ink-600">
          <p className="font-medium text-ink-700">What comes across</p>
          <ul className="mt-1 list-inside list-disc space-y-0.5">
            <li>Every balance sheet balance, as an opening figure</li>
            <li>The profit for the year and any dividends, rolled into retained earnings</li>
            <li>The debtors and creditors listings that support the control accounts</li>
            <li>Accounting policy notes, ready to edit</li>
          </ul>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" loading={busy} disabled={!source.isBalanced}>
            Carry forward
          </Button>
        </div>
      </form>
    </Modal>
  );
}
