'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, Plus, Save } from 'lucide-react';
import {
  AGEING_BUCKETS,
  AGEING_LABELS,
  formatAmount,
  isYearEditable,
  round2,
  tryParseAmount,
  type AgeingBucket,
  type PartyBalanceDto,
  type PartyType,
  type SubledgerResponse,
} from '@finstat/shared';

import { api, ApiError } from '@/lib/api';
import { AppShell, yearNav } from '@/components/app-shell';
import { useCompany, useSubledger, useYear } from '@/lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Input,
  Modal,
  PageHeader,
  Spinner,
  Stat,
  Textarea,
} from '@/components/ui';

type Edits = Record<string, Partial<Record<AgeingBucket | 'total', string>>>;

export function SubledgerPage({
  companyId,
  yearId,
  type,
}: {
  companyId: string;
  yearId: string;
  type: PartyType;
}) {
  const noun = type === 'DEBTOR' ? 'Debtors' : 'Creditors';
  const company = useCompany(companyId);
  const { year } = useYear(companyId, yearId);
  const subledger = useSubledger(companyId, yearId, type);
  const queryClient = useQueryClient();

  const [edits, setEdits] = useState<Edits>({});
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);

  const editable = year ? isYearEditable(year.status) : false;
  const rows = subledger.data?.rows ?? [];

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['subledger', companyId, yearId, type] });
    await queryClient.invalidateQueries({ queryKey: ['validation', companyId, yearId] });
    await queryClient.invalidateQueries({ queryKey: ['statements', companyId, yearId] });
  };

  function valueOf(row: PartyBalanceDto, field: AgeingBucket | 'total'): number {
    const edited = edits[row.partyId]?.[field];
    if (edited !== undefined) return tryParseAmount(edited) ?? 0;
    return row[field];
  }

  /** Live totals across the listing, including anything typed but not saved. */
  const draft = useMemo(() => {
    const totals: Record<AgeingBucket | 'total', number> = {
      current: 0,
      days30: 0,
      days60: 0,
      days90: 0,
      days120Plus: 0,
      total: 0,
    };
    for (const row of rows) {
      for (const bucket of AGEING_BUCKETS) totals[bucket] += valueOf(row, bucket);
      totals.total += valueOf(row, 'total');
    }
    for (const key of Object.keys(totals) as Array<AgeingBucket | 'total'>) {
      totals[key] = round2(totals[key]);
    }
    return totals;
  }, [rows, edits]);

  const control = subledger.data?.controlAccountTotal ?? 0;
  const difference = round2(control - draft.total);

  const save = useMutation({
    mutationFn: (balances: Array<Record<string, unknown>>) =>
      api.put<SubledgerResponse>(
        `/companies/${companyId}/years/${yearId}/subledger/balances?type=${type}`,
        { balances },
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(['subledger', companyId, yearId, type], result);
      await refresh();
      setEdits({});
      setMessage({
        tone: result.agrees ? 'good' : 'bad',
        text: result.agrees
          ? `Saved. The ${noun.toLowerCase()} listing agrees to the control account.`
          : `Saved, but the listing is out against the control account by ${formatAmount(result.difference)}.`,
      });
    },
    onError: (caught) =>
      setMessage({
        tone: 'bad',
        text: caught instanceof ApiError ? caught.message : 'Could not save those balances.',
      }),
  });

  function commit() {
    const balances = Object.keys(edits).map((partyId) => {
      const row = rows.find((candidate) => candidate.partyId === partyId);
      const buckets = Object.fromEntries(
        AGEING_BUCKETS.map((bucket) => [bucket, row ? valueOf(row, bucket) : 0]),
      );
      const statedTotal = edits[partyId]?.total;
      return {
        partyId,
        ...buckets,
        // Leaving the total out lets the API add the buckets up, which is what
        // a preparer expects unless they have deliberately typed a total.
        ...(statedTotal !== undefined ? { total: tryParseAmount(statedTotal) ?? 0 } : {}),
      };
    });
    if (balances.length > 0) save.mutate(balances);
  }

  const addParty = useMutation({
    mutationFn: (input: { code: string; name: string }) =>
      api.post(`/companies/${companyId}/years/${yearId}/subledger/parties?type=${type}`, input),
    onSuccess: async () => {
      await refresh();
      setAddOpen(false);
      setMessage({ tone: 'good', text: 'Account added.' });
    },
    onError: (caught) =>
      setMessage({
        tone: 'bad',
        text: caught instanceof ApiError ? caught.message : 'Could not add that account.',
      }),
  });

  const paste = useMutation({
    mutationFn: (text: string) =>
      api.post<SubledgerResponse>(
        `/companies/${companyId}/years/${yearId}/subledger/paste?type=${type}`,
        { text },
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(['subledger', companyId, yearId, type], result);
      await refresh();
      setPasteOpen(false);
      setEdits({});
      setMessage({
        tone: result.agrees ? 'good' : 'bad',
        text: result.agrees
          ? 'Pasted, and the listing agrees to the control account.'
          : `Pasted, but the listing is out by ${formatAmount(result.difference)}.`,
      });
    },
    onError: (caught) =>
      setMessage({
        tone: 'bad',
        text: caught instanceof ApiError ? caught.message : 'Could not read that block.',
      }),
  });

  return (
    <AppShell
      nav={yearNav(companyId, yearId)}
      contextLabel={`${company.data?.name ?? ''} · ${year?.label ?? ''}`}
      contextHref={`/c/${companyId}/y/${yearId}`}
    >
      <PageHeader
        title={`${noun} listing`}
        description={`Aged balances at year end. The total has to agree to the ${
          type === 'DEBTOR' ? 'trade receivables' : 'trade payables'
        } control account.`}
        actions={
          <>
            <Button onClick={() => setAddOpen(true)} disabled={!editable}>
              <Plus className="h-4 w-4" />
              Add account
            </Button>
            <Button onClick={() => setPasteOpen(true)} disabled={!editable}>
              <ClipboardPaste className="h-4 w-4" />
              Paste listing
            </Button>
            <Button
              variant="primary"
              onClick={commit}
              loading={save.isPending}
              disabled={!editable || Object.keys(edits).length === 0}
            >
              <Save className="h-4 w-4" />
              Save
            </Button>
          </>
        }
      />

      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Listing total" value={formatAmount(draft.total)} />
        <Stat label="Control account" value={formatAmount(control)} />
        <Stat
          label="Difference"
          value={formatAmount(difference)}
          tone={difference === 0 ? 'good' : 'bad'}
          hint={difference === 0 ? 'The listing agrees' : 'These have to match'}
        />
      </div>

      <Card title={`${rows.length} accounts`}>
        {subledger.isLoading ? <Spinner /> : null}

        {rows.length === 0 && !subledger.isLoading ? (
          <EmptyState
            title={`No ${noun.toLowerCase()} captured yet`}
            description="Paste the listing straight out of your accounting system, or add accounts one at a time."
            action={
              <Button variant="primary" onClick={() => setPasteOpen(true)} disabled={!editable}>
                Paste a listing
              </Button>
            }
          />
        ) : null}

        {rows.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-xs text-ink-500">
                  <th className="px-4 py-2 text-left font-medium">Code</th>
                  <th className="px-3 py-2 text-left font-medium">Name</th>
                  {AGEING_BUCKETS.map((bucket) => (
                    <th key={bucket} className="px-2 py-2 text-right font-medium">
                      {AGEING_LABELS[bucket]}
                    </th>
                  ))}
                  <th className="px-3 py-2 text-right font-medium">Total</th>
                  <th className="px-4 py-2 text-right font-medium">Prior</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {rows.map((row) => {
                  const bucketSum = round2(
                    AGEING_BUCKETS.reduce((sum, bucket) => sum + valueOf(row, bucket), 0),
                  );
                  const stated = valueOf(row, 'total');
                  const mismatch = round2(stated - bucketSum) !== 0;

                  return (
                    <tr key={row.partyId} className={edits[row.partyId] ? 'bg-amber-50/60' : ''}>
                      <td className="tabular px-4 py-1.5 text-xs text-ink-500">{row.code}</td>
                      <td className="px-3 py-1.5 text-ink-800">{row.name}</td>
                      {AGEING_BUCKETS.map((bucket) => (
                        <td key={bucket} className="px-1 py-1">
                          <AgeingCell
                            value={
                              edits[row.partyId]?.[bucket] ??
                              (row[bucket] ? String(row[bucket]) : '')
                            }
                            disabled={!editable}
                            ariaLabel={`${AGEING_LABELS[bucket]} for ${row.name}`}
                            onChange={(value) =>
                              setEdits((current) => ({
                                ...current,
                                [row.partyId]: { ...current[row.partyId], [bucket]: value },
                              }))
                            }
                          />
                        </td>
                      ))}
                      <td
                        className={`tabular px-3 py-1.5 text-right font-medium ${
                          mismatch ? 'text-amber-600' : 'text-ink-900'
                        }`}
                        title={mismatch ? `Buckets add up to ${formatAmount(bucketSum)}` : undefined}
                      >
                        {formatAmount(edits[row.partyId] ? bucketSum : stated)}
                      </td>
                      <td className="tabular px-4 py-1.5 text-right text-xs text-ink-400">
                        {row.priorTotal ? formatAmount(row.priorTotal) : ''}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-300 bg-ink-50 font-semibold">
                  <td className="px-4 py-2.5" colSpan={2}>
                    Totals
                  </td>
                  {AGEING_BUCKETS.map((bucket) => (
                    <td key={bucket} className="tabular px-2 py-2.5 text-right">
                      {formatAmount(draft[bucket])}
                    </td>
                  ))}
                  <td className="tabular px-3 py-2.5 text-right">{formatAmount(draft.total)}</td>
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title={`Add ${type.toLowerCase()}`}>
        <AddPartyForm
          busy={addParty.isPending}
          onCancel={() => setAddOpen(false)}
          onSubmit={(input) => addParty.mutate(input)}
        />
      </Modal>

      <Modal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        wide
        title={`Paste the ${noun.toLowerCase()} listing`}
        description="Columns in order: code, name, current, 30, 60, 90, 120 and over, then an optional total. Accounts that are new here are created."
      >
        <PasteListingForm
          busy={paste.isPending}
          onCancel={() => setPasteOpen(false)}
          onSubmit={(text) => paste.mutate(text)}
        />
      </Modal>
    </AppShell>
  );
}

function AgeingCell({
  value,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string;
  disabled: boolean;
  ariaLabel: string;
  onChange: (value: string) => void;
}) {
  return (
    <input
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      inputMode="decimal"
      onFocus={(event) => event.target.select()}
      onChange={(event) => onChange(event.target.value)}
      className="cell-input tabular w-24 rounded border border-transparent bg-transparent px-2 py-1 text-right text-sm hover:border-ink-200 focus:bg-white disabled:cursor-not-allowed"
    />
  );
}

function AddPartyForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: { code: string; name: string }) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ code, name });
      }}
    >
      <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          Add
        </Button>
      </div>
    </form>
  );
}

function PasteListingForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (text: string) => void;
}) {
  const [text, setText] = useState('');

  return (
    <div className="space-y-3">
      <Textarea
        value={text}
        onChange={(event) => setText(event.target.value)}
        rows={9}
        placeholder={'D001\tHarbour Foods\t60000\t15000\t0\t0\t0'}
        className="font-mono text-xs"
      />
      <div className="flex justify-end gap-2">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={() => onSubmit(text)} loading={busy} disabled={!text.trim()}>
          Apply
        </Button>
      </div>
    </div>
  );
}
