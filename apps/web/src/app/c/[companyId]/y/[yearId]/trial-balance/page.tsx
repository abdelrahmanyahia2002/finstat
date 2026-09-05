'use client';

import { use, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardPaste, Download, Save, Upload } from 'lucide-react';
import {
  formatAmount,
  isYearEditable,
  round2,
  tryParseAmount,
  parsePastedTrialBalance,
  toClipboardText,
  type ImportPreview,
  type TrialBalanceResponse,
  type TrialBalanceRowDto,
} from '@finstat/shared';

import { api, ApiError } from '@/lib/api';
import { AppShell, yearNav } from '@/components/app-shell';
import { useCompany, useTrialBalance, useYear } from '@/lib/queries';
import {
  Alert,
  Badge,
  Button,
  Card,
  Modal,
  PageHeader,
  Spinner,
  Stat,
  Textarea,
} from '@/components/ui';

type Edits = Record<string, { debit: string; credit: string }>;

export default function TrialBalancePage({
  params,
}: {
  params: Promise<{ companyId: string; yearId: string }>;
}) {
  const { companyId, yearId } = use(params);
  const company = useCompany(companyId);
  const { year } = useYear(companyId, yearId);
  const trialBalance = useTrialBalance(companyId, yearId);
  const queryClient = useQueryClient();

  const [edits, setEdits] = useState<Edits>({});
  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [pasteOpen, setPasteOpen] = useState(false);

  const editable = year ? isYearEditable(year.status) : false;
  const rows = trialBalance.data?.rows ?? [];

  const visibleRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter(
      (row) =>
        row.code.toLowerCase().includes(needle) ||
        row.name.toLowerCase().includes(needle) ||
        (row.section ?? '').toLowerCase().includes(needle),
    );
  }, [rows, filter]);

  /** Live totals: what the grid would total if saved right now. */
  const draftTotals = useMemo(() => {
    let debit = 0;
    let credit = 0;
    for (const row of rows) {
      const edit = edits[row.accountId];
      debit += edit ? (tryParseAmount(edit.debit) ?? 0) : row.debit;
      credit += edit ? (tryParseAmount(edit.credit) ?? 0) : row.credit;
    }
    return { debit: round2(debit), credit: round2(credit), difference: round2(debit - credit) };
  }, [rows, edits]);

  const dirtyCount = Object.keys(edits).length;

  const save = useMutation({
    mutationFn: (entries: Array<{ accountId: string; debit: number; credit: number }>) =>
      api.put<TrialBalanceResponse>(
        `/companies/${companyId}/years/${yearId}/trial-balance`,
        { entries },
      ),
    onSuccess: async (result) => {
      queryClient.setQueryData(['trial-balance', companyId, yearId], result);
      await queryClient.invalidateQueries({ queryKey: ['statements', companyId, yearId] });
      await queryClient.invalidateQueries({ queryKey: ['validation', companyId, yearId] });
      await queryClient.invalidateQueries({ queryKey: ['years', companyId] });
      setEdits({});
      setMessage({
        tone: result.isBalanced ? 'good' : 'bad',
        text: result.isBalanced
          ? 'Saved. The trial balance balances.'
          : `Saved, but the trial balance is out by ${formatAmount(result.difference)}.`,
      });
    },
    onError: (caught) =>
      setMessage({
        tone: 'bad',
        text: caught instanceof ApiError ? caught.message : 'Could not save those figures.',
      }),
  });

  function commit() {
    const entries = Object.entries(edits).map(([accountId, value]) => ({
      accountId,
      debit: tryParseAmount(value.debit) ?? 0,
      credit: tryParseAmount(value.credit) ?? 0,
    }));
    if (entries.length > 0) save.mutate(entries);
  }

  // Ctrl+S saves, the way a spreadsheet would.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        if (editable && dirtyCount > 0) commit();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  });

  const copyAll = useCallback(() => {
    const grid: Array<Array<string | number>> = [
      ['Code', 'Account name', 'Reporting category', 'Debit', 'Credit'],
      ...rows.map((row) => [
        row.code,
        row.name,
        row.section ?? '',
        row.debit || '',
        row.credit || '',
      ]),
    ];
    void navigator.clipboard.writeText(toClipboardText(grid));
    setMessage({ tone: 'good', text: 'The whole trial balance is on the clipboard.' });
  }, [rows]);

  return (
    <AppShell
      nav={yearNav(companyId, yearId)}
      contextLabel={`${company.data?.name ?? ''} · ${year?.label ?? ''}`}
      contextHref={`/c/${companyId}/y/${yearId}`}
    >
      <PageHeader
        title="Trial balance"
        description="Type into the grid, paste a block from Excel, or import a workbook."
        actions={
          <>
            <Button onClick={copyAll}>
              <Download className="h-4 w-4" />
              Copy all
            </Button>
            <Button onClick={() => setPasteOpen(true)} disabled={!editable}>
              <ClipboardPaste className="h-4 w-4" />
              Paste from Excel
            </Button>
            <Button
              variant="primary"
              onClick={commit}
              loading={save.isPending}
              disabled={!editable || dirtyCount === 0}
            >
              <Save className="h-4 w-4" />
              Save{dirtyCount > 0 ? ` ${dirtyCount}` : ''}
            </Button>
          </>
        }
      />

      {!editable && year ? (
        <div className="mb-4">
          <Alert tone="warn" title={`${year.label} is ${year.status.toLowerCase()}`}>
            Figures are read only until the year is reopened. You can still copy, export and report
            on it.
          </Alert>
        </div>
      ) : null}

      {message ? (
        <div className="mb-4">
          <Alert tone={message.tone} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        </div>
      ) : null}

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="Total debits" value={formatAmount(draftTotals.debit)} />
        <Stat label="Total credits" value={formatAmount(draftTotals.credit)} />
        <Stat
          label="Difference"
          value={formatAmount(draftTotals.difference)}
          tone={draftTotals.difference === 0 ? 'good' : 'bad'}
          hint={
            draftTotals.difference === 0
              ? 'Debits equal credits'
              : 'The statements will not balance until this is nil'
          }
        />
      </div>

      <Card
        title={`${visibleRows.length} accounts`}
        actions={
          <input
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder="Filter by code, name or category"
            className="w-64 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs focus:border-accent-500 focus:outline-none"
          />
        }
      >
        {trialBalance.isLoading ? <Spinner /> : null}

        {trialBalance.data ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 z-10 bg-white">
                <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Account</th>
                  <th className="px-3 py-2 font-medium">Reporting category</th>
                  <th className="px-3 py-2 text-right font-medium">Debit</th>
                  <th className="px-3 py-2 text-right font-medium">Credit</th>
                  <th className="px-4 py-2 text-right font-medium">
                    {trialBalance.data.priorYearId ? 'Prior net' : ''}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visibleRows.map((row) => (
                  <BalanceRow
                    key={row.accountId}
                    row={row}
                    edit={edits[row.accountId]}
                    editable={editable}
                    showPrior={Boolean(trialBalance.data?.priorYearId)}
                    onChange={(field, value) =>
                      setEdits((current) => ({
                        ...current,
                        [row.accountId]: {
                          debit: field === 'debit' ? value : (current[row.accountId]?.debit ?? String(row.debit || '')),
                          credit:
                            field === 'credit' ? value : (current[row.accountId]?.credit ?? String(row.credit || '')),
                        },
                      }))
                    }
                  />
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-ink-300 bg-ink-50 font-semibold">
                  <td className="px-4 py-2.5" colSpan={3}>
                    Totals
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {formatAmount(draftTotals.debit)}
                  </td>
                  <td className="tabular px-3 py-2.5 text-right">
                    {formatAmount(draftTotals.credit)}
                  </td>
                  <td className="px-4 py-2.5" />
                </tr>
              </tfoot>
            </table>
          </div>
        ) : null}
      </Card>

      <PasteModal
        open={pasteOpen}
        onClose={() => setPasteOpen(false)}
        companyId={companyId}
        yearId={yearId}
        onApplied={async (text) => {
          setPasteOpen(false);
          setEdits({});
          await queryClient.invalidateQueries({ queryKey: ['trial-balance', companyId, yearId] });
          await queryClient.invalidateQueries({ queryKey: ['statements', companyId, yearId] });
          await queryClient.invalidateQueries({ queryKey: ['validation', companyId, yearId] });
          setMessage({ tone: 'good', text });
        }}
      />
    </AppShell>
  );
}

function BalanceRow({
  row,
  edit,
  editable,
  showPrior,
  onChange,
}: {
  row: TrialBalanceRowDto;
  edit?: { debit: string; credit: string };
  editable: boolean;
  showPrior: boolean;
  onChange: (field: 'debit' | 'credit', value: string) => void;
}) {
  const debitValue = edit ? edit.debit : row.debit ? String(row.debit) : '';
  const creditValue = edit ? edit.credit : row.credit ? String(row.credit) : '';
  const priorNet = round2(row.priorDebit - row.priorCredit);

  return (
    <tr className={edit ? 'bg-amber-50/60' : 'hover:bg-ink-50'}>
      <td className="tabular px-4 py-1.5 text-xs text-ink-500">{row.code}</td>
      <td className="px-3 py-1.5 text-ink-800">{row.name}</td>
      <td className="px-3 py-1.5">
        {row.section ? (
          <span className="text-xs text-ink-500">{row.section.replace(/_/g, ' ').toLowerCase()}</span>
        ) : (
          <Badge tone="bad">not mapped</Badge>
        )}
      </td>
      <td className="px-1 py-1">
        <CellInput
          value={debitValue}
          disabled={!editable}
          onChange={(value) => onChange('debit', value)}
          ariaLabel={`Debit for ${row.code} ${row.name}`}
        />
      </td>
      <td className="px-1 py-1">
        <CellInput
          value={creditValue}
          disabled={!editable}
          onChange={(value) => onChange('credit', value)}
          ariaLabel={`Credit for ${row.code} ${row.name}`}
        />
      </td>
      <td className="tabular px-4 py-1.5 text-right text-xs text-ink-400">
        {showPrior && priorNet !== 0 ? formatAmount(priorNet) : ''}
      </td>
    </tr>
  );
}

function CellInput({
  value,
  disabled,
  onChange,
  ariaLabel,
}: {
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  const ref = useRef<HTMLInputElement>(null);

  return (
    <input
      ref={ref}
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      inputMode="decimal"
      onChange={(event) => onChange(event.target.value)}
      onFocus={(event) => event.target.select()}
      onKeyDown={(event) => {
        // Up and down move between rows, the way a spreadsheet does.
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();

        const inputs = Array.from(
          document.querySelectorAll<HTMLInputElement>('input.cell-input:not([disabled])'),
        );
        const index = inputs.indexOf(event.currentTarget);
        if (index === -1) return;

        // Two inputs per row, so a row step is two positions.
        const next = inputs[index + (event.key === 'ArrowDown' ? 2 : -2)];
        next?.focus();
      }}
      className="cell-input tabular w-full rounded border border-transparent bg-transparent px-2 py-1 text-right text-sm hover:border-ink-200 focus:bg-white disabled:cursor-not-allowed"
    />
  );
}

function PasteModal({
  open,
  onClose,
  companyId,
  yearId,
  onApplied,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  yearId: string;
  onApplied: (message: string) => void | Promise<void>;
}) {
  const [text, setText] = useState('');
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [createMissing, setCreateMissing] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [busy, setBusy] = useState(false);

  // Read the block locally as it is typed, so the shape is visible before the
  // server is asked anything.
  const localRead = useMemo(() => (text.trim() ? parsePastedTrialBalance(text) : null), [text]);

  async function runPreview() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<ImportPreview>(
        `/companies/${companyId}/years/${yearId}/trial-balance/paste/preview`,
        { text },
      );
      setPreview(result);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not read that block.');
    } finally {
      setBusy(false);
    }
  }

  async function apply() {
    setBusy(true);
    setError(null);
    try {
      const result = await api.post<{ preview: ImportPreview; result: TrialBalanceResponse }>(
        `/companies/${companyId}/years/${yearId}/trial-balance/paste`,
        { text, createMissingAccounts: createMissing, replaceAll },
      );
      const applied = result.preview.rows.length;
      await onApplied(
        `Pasted ${applied} ${applied === 1 ? 'row' : 'rows'}. ${
          result.result.isBalanced
            ? 'The trial balance balances.'
            : `Out of balance by ${formatAmount(result.result.difference)}.`
        }`,
      );
      setText('');
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not apply that block.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Paste from Excel"
      description="Select the cells in your spreadsheet, copy, and paste them below. Headings are recognised automatically."
    >
      <div className="space-y-3">
        {error ? <Alert tone="bad">{error}</Alert> : null}

        <Textarea
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            setPreview(null);
          }}
          rows={8}
          placeholder={'Code\tAccount name\tDebit\tCredit\n1500\tBank\t125000.00\n2700\tTrade payables\t\t84000.00'}
          className="font-mono text-xs"
        />

        {localRead ? (
          <p className="text-xs text-ink-500">
            Reads as {localRead.rows.length} rows, debits {formatAmount(localRead.totalDebit)},
            credits {formatAmount(localRead.totalCredit)}
            {round2(localRead.totalDebit - localRead.totalCredit) === 0
              ? ', which balances.'
              : `, out by ${formatAmount(round2(localRead.totalDebit - localRead.totalCredit))}.`}
          </p>
        ) : null}

        {preview ? (
          <div className="rounded-md border border-ink-200">
            <div className="flex flex-wrap items-center gap-3 border-b border-ink-100 bg-ink-50 px-3 py-2 text-xs">
              <span>
                <strong>{preview.updateCount}</strong> to update
              </span>
              <span>
                <strong>{preview.createCount}</strong> new accounts
              </span>
              <span className={preview.errorCount ? 'text-red-600' : ''}>
                <strong>{preview.errorCount}</strong> with problems
              </span>
              <span className="ml-auto">
                Difference {formatAmount(preview.difference)}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-ink-100">
                  {preview.rows.map((row) => (
                    <tr key={row.rowNumber} className={row.action === 'ERROR' ? 'bg-red-50' : ''}>
                      <td className="px-3 py-1.5 text-ink-400">{row.rowNumber}</td>
                      <td className="tabular px-2 py-1.5">{row.code}</td>
                      <td className="px-2 py-1.5">{row.name}</td>
                      <td className="tabular px-2 py-1.5 text-right">
                        {row.debit ? formatAmount(row.debit) : ''}
                      </td>
                      <td className="tabular px-2 py-1.5 text-right">
                        {row.credit ? formatAmount(row.credit) : ''}
                      </td>
                      <td className="px-3 py-1.5">
                        {row.action === 'ERROR' ? (
                          <span className="text-red-600">{row.problems[0]}</span>
                        ) : (
                          <Badge tone={row.action === 'CREATE' ? 'info' : 'neutral'}>
                            {row.action.toLowerCase()}
                          </Badge>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-4">
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={createMissing}
              onChange={(event) => setCreateMissing(event.target.checked)}
              className="h-4 w-4 rounded border-ink-300"
            />
            Create accounts that are not on the chart
          </label>
          <label className="flex items-center gap-2 text-sm text-ink-700">
            <input
              type="checkbox"
              checked={replaceAll}
              onChange={(event) => setReplaceAll(event.target.checked)}
              className="h-4 w-4 rounded border-ink-300"
            />
            Clear every account this paste does not mention
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={runPreview} loading={busy} disabled={!text.trim()}>
            Check it first
          </Button>
          <Button
            variant="primary"
            onClick={apply}
            loading={busy}
            disabled={!text.trim() || (preview?.errorCount ?? 0) > 0}
          >
            <Upload className="h-4 w-4" />
            Apply
          </Button>
        </div>
      </div>
    </Modal>
  );
}
