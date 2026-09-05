'use client';

import { use, useState } from 'react';

import { AppShell, companyNav } from '@/components/app-shell';
import { useAuditTrail, useCompany } from '@/lib/queries';
import { Button, Card, EmptyState, PageHeader, Spinner } from '@/components/ui';

export default function AuditPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);
  const company = useCompany(companyId);
  const [page, setPage] = useState(1);
  const audit = useAuditTrail(companyId, page);

  const totalPages = audit.data ? Math.max(1, Math.ceil(audit.data.total / audit.data.pageSize)) : 1;

  return (
    <AppShell
      nav={companyNav(companyId)}
      contextLabel={company.data?.name}
      contextHref={`/c/${companyId}`}
    >
      <PageHeader
        title="Audit trail"
        description="Every change to this company, who made it and when."
      />

      <Card
        title={audit.data ? `${audit.data.total} entries` : 'Loading'}
        actions={
          <div className="flex items-center gap-2 text-xs text-ink-500">
            <Button size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
              Previous
            </Button>
            <span>
              Page {page} of {totalPages}
            </span>
            <Button
              size="sm"
              onClick={() => setPage((p) => p + 1)}
              disabled={page >= totalPages}
            >
              Next
            </Button>
          </div>
        }
      >
        {audit.isLoading ? <Spinner /> : null}

        {audit.data?.items.length === 0 ? (
          <EmptyState
            title="Nothing recorded yet"
            description="Changes show up here as soon as anybody makes one."
          />
        ) : null}

        {audit.data && audit.data.items.length > 0 ? (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
                <th className="px-5 py-2 font-medium">When</th>
                <th className="px-3 py-2 font-medium">Who</th>
                <th className="px-3 py-2 font-medium">What</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink-100">
              {audit.data.items.map((entry) => (
                <tr key={entry.id} className="hover:bg-ink-50">
                  <td className="whitespace-nowrap px-5 py-2 text-xs text-ink-500">
                    {new Date(entry.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-xs text-ink-600">
                    {entry.userName ?? entry.userEmail ?? 'System'}
                  </td>
                  <td className="px-3 py-2 text-ink-800">{entry.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </Card>
    </AppShell>
  );
}
