'use client';

import { use, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Download, FileDown, FileSpreadsheet, FileText, Upload } from 'lucide-react';
import {
  REPORT_KINDS,
  REPORT_LABELS,
  formatAmount,
  isYearEditable,
  type ImportPreview,
  type JobDto,
  type ReportKind,
} from '@finstat/shared';

import { api, ApiError, downloadFile } from '@/lib/api';
import { AppShell, yearNav } from '@/components/app-shell';
import { useCompany, useJobs, useYear } from '@/lib/queries';
import { Alert, Badge, Button, Card, EmptyState, Modal, PageHeader } from '@/components/ui';

export default function ReportsPage({
  params,
}: {
  params: Promise<{ companyId: string; yearId: string }>;
}) {
  const { companyId, yearId } = use(params);
  const company = useCompany(companyId);
  const { year } = useYear(companyId, yearId);
  const jobs = useJobs(companyId);
  const queryClient = useQueryClient();

  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const editable = year ? isYearEditable(year.status) : false;
  const refreshJobs = () => queryClient.invalidateQueries({ queryKey: ['jobs', companyId] });

  function report(caught: unknown, fallback: string) {
    setMessage({ tone: 'bad', text: caught instanceof ApiError ? caught.message : fallback });
  }

  const requestPdf = useMutation({
    mutationFn: (kind: ReportKind) =>
      api.post<JobDto>(`/companies/${companyId}/years/${yearId}/reports/pdf`, { kind }),
    onSuccess: async () => {
      await refreshJobs();
      setMessage({ tone: 'good', text: 'Building the PDF. It appears below when it is ready.' });
    },
    onError: (caught) => report(caught, 'Could not start that report.'),
  });

  const requestExcel = useMutation({
    mutationFn: (variant: 'STATEMENTS' | 'TRIAL_BALANCE' | 'TEMPLATE') =>
      api.post<JobDto>(`/companies/${companyId}/years/${yearId}/excel/export`, { variant }),
    onSuccess: async () => {
      await refreshJobs();
      setMessage({ tone: 'good', text: 'Building the workbook. It appears below when it is ready.' });
    },
    onError: (caught) => report(caught, 'Could not start that export.'),
  });

  return (
    <AppShell
      nav={yearNav(companyId, yearId)}
      contextLabel={`${company.data?.name ?? ''} · ${year?.label ?? ''}`}
      contextHref={`/c/${companyId}/y/${yearId}`}
    >
      <PageHeader
        title="Reports"
        description="Generate a PDF or a workbook, or bring a trial balance in from Excel."
        actions={
          <Button variant="primary" onClick={() => setImportOpen(true)} disabled={!editable}>
            <Upload className="h-4 w-4" />
            Import a workbook
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

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="PDF" description="Typeset for issuing and for the file.">
          <ul className="divide-y divide-ink-100">
            {REPORT_KINDS.map((kind) => (
              <li key={kind} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="flex items-center gap-2.5 text-sm text-ink-700">
                  <FileText className="h-4 w-4 text-ink-400" />
                  {REPORT_LABELS[kind]}
                </span>
                <Button
                  size="sm"
                  onClick={() => requestPdf.mutate(kind)}
                  loading={requestPdf.isPending && requestPdf.variables === kind}
                >
                  Generate
                </Button>
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Excel" description="Workbooks you can carry on working in.">
          <ul className="divide-y divide-ink-100">
            {(
              [
                ['STATEMENTS', 'Full pack: statements, notes, listings, trial balance, validation'],
                ['TRIAL_BALANCE', 'Trial balance with last year alongside'],
                ['TEMPLATE', 'Empty import template with the valid categories'],
              ] as const
            ).map(([variant, label]) => (
              <li key={variant} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <span className="flex items-start gap-2.5 text-sm text-ink-700">
                  <FileSpreadsheet className="mt-0.5 h-4 w-4 shrink-0 text-ink-400" />
                  {label}
                </span>
                <Button
                  size="sm"
                  onClick={() => requestExcel.mutate(variant)}
                  loading={requestExcel.isPending && requestExcel.variables === variant}
                >
                  Generate
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4">
        <Card
          title="Recent files"
          description="Reports build in the background, so you can carry on working while they run."
        >
          {jobs.data?.length === 0 ? (
            <EmptyState
              title="Nothing generated yet"
              description="Pick a report above and it will show up here."
            />
          ) : (
            <ul className="divide-y divide-ink-100">
              {jobs.data?.map((job) => (
                <JobRow key={job.id} job={job} companyId={companyId} />
              ))}
            </ul>
          )}
        </Card>
      </div>

      <ImportModal
        open={importOpen}
        onClose={() => setImportOpen(false)}
        companyId={companyId}
        yearId={yearId}
        onQueued={async () => {
          setImportOpen(false);
          await refreshJobs();
          setMessage({
            tone: 'good',
            text: 'The import is running. Watch it below, then check the trial balance.',
          });
        }}
      />
    </AppShell>
  );
}

function JobRow({ job, companyId }: { job: JobDto; companyId: string }) {
  const busy = job.status === 'QUEUED' || job.status === 'PROCESSING';

  return (
    <li className="flex items-center gap-3 px-5 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-ink-800">{job.fileName ?? job.type}</span>
          <Badge
            tone={
              job.status === 'COMPLETED'
                ? 'good'
                : job.status === 'FAILED'
                  ? 'bad'
                  : 'info'
            }
          >
            {job.status.toLowerCase()}
          </Badge>
        </div>
        <p className="mt-0.5 text-xs text-ink-400">
          {job.error ?? job.message ?? new Date(job.createdAt).toLocaleString()}
        </p>
        {busy ? (
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded bg-ink-100">
            <div
              className="h-full rounded bg-accent-500 transition-all"
              style={{ width: `${Math.max(job.progress, 8)}%` }}
            />
          </div>
        ) : null}
      </div>

      {job.status === 'COMPLETED' ? (
        <Button
          size="sm"
          onClick={() =>
            void downloadFile(
              `/companies/${companyId}/jobs/${job.id}/download`,
              job.fileName ?? 'download',
            )
          }
        >
          <Download className="h-3.5 w-3.5" />
          Download
        </Button>
      ) : null}
    </li>
  );
}

function ImportModal({
  open,
  onClose,
  companyId,
  yearId,
  onQueued,
}: {
  open: boolean;
  onClose: () => void;
  companyId: string;
  yearId: string;
  onQueued: () => void | Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<(ImportPreview & { sheetNames: string[] }) | null>(null);
  const [sheetName, setSheetName] = useState('');
  const [createMissing, setCreateMissing] = useState(false);
  const [replaceAll, setReplaceAll] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function runPreview(chosenSheet?: string) {
    if (!file) return;
    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      if (chosenSheet ?? sheetName) form.append('sheetName', chosenSheet ?? sheetName);

      const result = await api.upload<ImportPreview & { sheetNames: string[] }>(
        `/companies/${companyId}/years/${yearId}/excel/preview`,
        form,
      );
      setPreview(result);
      if (!sheetName && result.sheetNames.length > 0) setSheetName(chosenSheet ?? result.sheetNames[0]);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not read that workbook.');
    } finally {
      setBusy(false);
    }
  }

  async function startImport() {
    if (!file) return;
    setBusy(true);
    setError(null);

    try {
      const form = new FormData();
      form.append('file', file);
      if (sheetName) form.append('sheetName', sheetName);
      form.append('createMissingAccounts', String(createMissing));
      form.append('replaceAll', String(replaceAll));

      await api.upload<JobDto>(`/companies/${companyId}/years/${yearId}/excel/import`, form);
      await onQueued();
      setFile(null);
      setPreview(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not start the import.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      wide
      title="Import a trial balance"
      description="Upload an .xlsx workbook. Nothing changes until you have seen what it would do."
    >
      <div className="space-y-3">
        {error ? <Alert tone="bad">{error}</Alert> : null}

        <div className="flex items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".xlsx,.xlsm,.xls"
            onChange={(event) => {
              setFile(event.target.files?.[0] ?? null);
              setPreview(null);
              setSheetName('');
            }}
            className="block w-full text-sm text-ink-600 file:mr-3 file:rounded-md file:border file:border-ink-200 file:bg-white file:px-3 file:py-1.5 file:text-sm file:text-ink-700 hover:file:bg-ink-50"
          />
          <Button onClick={() => void runPreview()} loading={busy} disabled={!file}>
            <FileDown className="h-4 w-4" />
            Check it
          </Button>
        </div>

        {preview && preview.sheetNames.length > 1 ? (
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-ink-600">Sheet</span>
            <select
              value={sheetName}
              onChange={(event) => {
                setSheetName(event.target.value);
                void runPreview(event.target.value);
              }}
              className="w-full rounded-md border border-ink-200 px-3 py-2 text-sm"
            >
              {preview.sheetNames.map((name) => (
                <option key={name} value={name}>
                  {name}
                </option>
              ))}
            </select>
          </label>
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
                Debits {formatAmount(preview.totalDebit)} · credits {formatAmount(preview.totalCredit)} ·
                difference {formatAmount(preview.difference)}
              </span>
            </div>
            <div className="max-h-64 overflow-y-auto">
              <table className="w-full text-xs">
                <tbody className="divide-y divide-ink-100">
                  {preview.rows.slice(0, 200).map((row) => (
                    <tr key={row.rowNumber} className={row.action === 'ERROR' ? 'bg-red-50' : ''}>
                      <td className="px-3 py-1 text-ink-400">{row.rowNumber}</td>
                      <td className="tabular px-2 py-1">{row.code}</td>
                      <td className="px-2 py-1">{row.name}</td>
                      <td className="tabular px-2 py-1 text-right">
                        {row.debit ? formatAmount(row.debit) : ''}
                      </td>
                      <td className="tabular px-2 py-1 text-right">
                        {row.credit ? formatAmount(row.credit) : ''}
                      </td>
                      <td className="px-3 py-1">
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
            Clear every account the file does not mention
          </label>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => void startImport()}
            loading={busy}
            disabled={!file || (preview?.errorCount ?? 0) > 0}
          >
            <Upload className="h-4 w-4" />
            Import
          </Button>
        </div>
      </div>
    </Modal>
  );
}
