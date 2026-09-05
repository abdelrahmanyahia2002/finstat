'use client';

import { use, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { ACCOUNT_TYPES, type AccountDto, type AccountType, type StatementSection } from '@finstat/shared';

import { api, ApiError } from '@/lib/api';
import { AppShell, companyNav } from '@/components/app-shell';
import { useAccounts, useCompany, useSections } from '@/lib/queries';
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

export default function AccountsPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);
  const company = useCompany(companyId);
  const [includeInactive, setIncludeInactive] = useState(false);
  const accounts = useAccounts(companyId, includeInactive);
  const sections = useSections(companyId);
  const queryClient = useQueryClient();

  const [filter, setFilter] = useState('');
  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['accounts', companyId] });

  function report(caught: unknown, fallback: string) {
    setMessage({ tone: 'bad', text: caught instanceof ApiError ? caught.message : fallback });
  }

  /** Categories valid for a given account type, so the two can never disagree. */
  const sectionsByType = useMemo(() => {
    const map = new Map<AccountType, typeof sections.data>();
    for (const type of ACCOUNT_TYPES) {
      map.set(type, sections.data?.filter((section) => section.accountType === type) ?? []);
    }
    return map;
  }, [sections.data]);

  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    if (!needle) return accounts.data ?? [];
    return (accounts.data ?? []).filter(
      (account) =>
        account.code.toLowerCase().includes(needle) ||
        account.name.toLowerCase().includes(needle) ||
        (account.section ?? '').toLowerCase().includes(needle),
    );
  }, [accounts.data, filter]);

  const unmapped = (accounts.data ?? []).filter((account) => !account.section).length;

  const applyTemplate = useMutation({
    mutationFn: () =>
      api.post<{ created: number; skipped: number }>(`/companies/${companyId}/accounts/template`),
    onSuccess: async (result) => {
      await refresh();
      setMessage({
        tone: 'good',
        text: `Added ${result.created} accounts${result.skipped ? `, ${result.skipped} were already there` : ''}.`,
      });
    },
    onError: (caught) => report(caught, 'Could not apply the standard chart.'),
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.patch(`/companies/${companyId}/accounts/${id}`, body),
    onSuccess: () => void refresh(),
    onError: (caught) => report(caught, 'Could not save that change.'),
  });

  const create = useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post(`/companies/${companyId}/accounts`, body),
    onSuccess: async () => {
      await refresh();
      setAddOpen(false);
      setMessage({ tone: 'good', text: 'Account added.' });
    },
    onError: (caught) => report(caught, 'Could not add that account.'),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete<{ deactivated: boolean }>(`/companies/${companyId}/accounts/${id}`),
    onSuccess: async (result) => {
      await refresh();
      setMessage({
        tone: 'good',
        text: result.deactivated
          ? 'That account has balances against it, so it was deactivated rather than deleted.'
          : 'Account deleted.',
      });
    },
    onError: (caught) => report(caught, 'Could not remove that account.'),
  });

  return (
    <AppShell
      nav={companyNav(companyId)}
      contextLabel={company.data?.name}
      contextHref={`/c/${companyId}`}
    >
      <PageHeader
        title="Chart of accounts"
        description="Each account is mapped to one line in the statements. That mapping is what builds every report."
        actions={
          <>
            <Button onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4" />
              Add account
            </Button>
            <Button
              variant="primary"
              onClick={() => applyTemplate.mutate()}
              loading={applyTemplate.isPending}
            >
              <Sparkles className="h-4 w-4" />
              Apply standard chart
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

      {unmapped > 0 ? (
        <div className="mb-4">
          <Alert tone="bad" title={`${unmapped} accounts have no reporting category`}>
            Their balances appear in no statement, and the balance sheet will not close until each
            one is mapped.
          </Alert>
        </div>
      ) : null}

      <Card
        title={`${visible.length} accounts`}
        actions={
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs text-ink-600">
              <input
                type="checkbox"
                checked={includeInactive}
                onChange={(event) => setIncludeInactive(event.target.checked)}
                className="h-3.5 w-3.5 rounded border-ink-300"
              />
              Show inactive
            </label>
            <input
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              placeholder="Filter"
              className="w-52 rounded-md border border-ink-200 px-2.5 py-1.5 text-xs focus:border-accent-500 focus:outline-none"
            />
          </div>
        }
      >
        {accounts.isLoading ? <Spinner /> : null}

        {accounts.data?.length === 0 ? (
          <EmptyState
            title="No accounts yet"
            description="The standard chart gives you around seventy accounts, all mapped, that you can rename or delete."
            action={
              <Button variant="primary" onClick={() => applyTemplate.mutate()}>
                Apply the standard chart
              </Button>
            }
          />
        ) : null}

        {visible.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                  <th className="px-4 py-2 font-medium">Code</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Type</th>
                  <th className="px-3 py-2 font-medium">Reporting category</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-ink-100">
                {visible.map((account) => (
                  <AccountRow
                    key={account.id}
                    account={account}
                    sectionsForType={sectionsByType.get(account.type) ?? []}
                    onChange={(body) => update.mutate({ id: account.id, ...body })}
                    onRemove={() => {
                      if (window.confirm(`Remove ${account.code} ${account.name}?`)) {
                        remove.mutate(account.id);
                      }
                    }}
                  />
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </Card>

      <Modal open={addOpen} onClose={() => setAddOpen(false)} title="Add an account">
        <AddAccountForm
          sections={sections.data ?? []}
          busy={create.isPending}
          onCancel={() => setAddOpen(false)}
          onSubmit={(body) => create.mutate(body)}
        />
      </Modal>
    </AppShell>
  );
}

function AccountRow({
  account,
  sectionsForType,
  onChange,
  onRemove,
}: {
  account: AccountDto;
  sectionsForType: Array<{ section: string; label: string }>;
  onChange: (body: Record<string, unknown>) => void;
  onRemove: () => void;
}) {
  const [name, setName] = useState(account.name);

  return (
    <tr className={account.isActive ? 'hover:bg-ink-50' : 'bg-ink-50/60 opacity-60'}>
      <td className="tabular px-4 py-1.5 text-xs text-ink-500">{account.code}</td>
      <td className="px-3 py-1.5">
        <input
          value={name}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            if (name.trim() && name !== account.name) onChange({ name });
          }}
          aria-label={`Name of account ${account.code}`}
          className="w-full rounded border border-transparent bg-transparent px-2 py-1 text-sm hover:border-ink-200 focus:border-accent-500 focus:bg-white focus:outline-none"
        />
      </td>
      <td className="px-3 py-1.5">
        <span className="text-xs text-ink-500">{account.type.toLowerCase()}</span>
      </td>
      <td className="px-3 py-1.5">
        <select
          value={account.section ?? ''}
          onChange={(event) => onChange({ section: event.target.value || null })}
          aria-label={`Reporting category for ${account.code}`}
          className={`w-full rounded border px-2 py-1 text-xs focus:border-accent-500 focus:outline-none ${
            account.section ? 'border-transparent bg-transparent hover:border-ink-200' : 'border-red-300 bg-red-50'
          }`}
        >
          <option value="">Not mapped</option>
          {sectionsForType.map((section) => (
            <option key={section.section} value={section.section}>
              {section.label}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-1.5 text-right">
        {account.isActive ? (
          <button
            onClick={onRemove}
            className="text-ink-400 hover:text-red-600"
            aria-label={`Remove ${account.code}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        ) : (
          <Badge tone="warn">inactive</Badge>
        )}
      </td>
    </tr>
  );
}

function AddAccountForm({
  sections,
  busy,
  onCancel,
  onSubmit,
}: {
  sections: Array<{ section: string; label: string; accountType: AccountType }>;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [type, setType] = useState<AccountType>('ASSET');
  const [section, setSection] = useState<StatementSection | ''>('');

  const available = sections.filter((candidate) => candidate.accountType === type);

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ code, name, type, section: section || undefined });
      }}
    >
      <div className="grid grid-cols-2 gap-3">
        <Input label="Code" value={code} onChange={(e) => setCode(e.target.value)} required autoFocus />
        <Select
          label="Type"
          value={type}
          onChange={(event) => {
            setType(event.target.value as AccountType);
            setSection('');
          }}
        >
          {ACCOUNT_TYPES.map((value) => (
            <option key={value} value={value}>
              {value.toLowerCase()}
            </option>
          ))}
        </Select>
      </div>

      <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />

      <Select
        label="Reporting category"
        value={section}
        onChange={(event) => setSection(event.target.value as StatementSection)}
      >
        <option value="">Choose one</option>
        {available.map((candidate) => (
          <option key={candidate.section} value={candidate.section}>
            {candidate.label}
          </option>
        ))}
      </Select>

      <p className="text-xs text-ink-400">
        Only categories that match the account type are offered, so a revenue account can never end
        up under current assets.
      </p>

      <div className="flex justify-end gap-2 pt-1">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          Add account
        </Button>
      </div>
    </form>
  );
}
