'use client';

import { use, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Trash2, UserPlus } from 'lucide-react';
import { COMPANY_ROLES, type CompanyRole } from '@finstat/shared';

import { api, ApiError } from '@/lib/api';
import { AppShell, companyNav } from '@/components/app-shell';
import { useCompany, useMembers } from '@/lib/queries';
import { Alert, Badge, Button, Card, Input, Modal, PageHeader, Select, Spinner } from '@/components/ui';

const ROLE_DESCRIPTIONS: Record<CompanyRole, string> = {
  OWNER: 'Everything, including deleting the company',
  ADMIN: 'Everything except deleting the company',
  PREPARER: 'Enter and change figures, notes and listings',
  REVIEWER: 'Read everything, and lock or reopen a year',
  VIEWER: 'Read only',
};

export default function MembersPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);
  const company = useCompany(companyId);
  const members = useMembers(companyId);
  const queryClient = useQueryClient();

  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['members', companyId] });

  function report(caught: unknown, fallback: string) {
    setMessage({ tone: 'bad', text: caught instanceof ApiError ? caught.message : fallback });
  }

  const addMember = useMutation({
    mutationFn: (body: { email: string; role: CompanyRole }) =>
      api.post(`/companies/${companyId}/members`, body),
    onSuccess: async () => {
      await refresh();
      setAddOpen(false);
      setMessage({ tone: 'good', text: 'They can see this company now.' });
    },
    onError: (caught) => report(caught, 'Could not add that person.'),
  });

  const changeRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: CompanyRole }) =>
      api.patch(`/companies/${companyId}/members/${id}`, { role }),
    onSuccess: async () => {
      await refresh();
      setMessage({ tone: 'good', text: 'Role updated.' });
    },
    onError: (caught) => report(caught, 'Could not change that role.'),
  });

  const removeMember = useMutation({
    mutationFn: (id: string) => api.delete(`/companies/${companyId}/members/${id}`),
    onSuccess: async () => {
      await refresh();
      setMessage({ tone: 'good', text: 'They no longer have access.' });
    },
    onError: (caught) => report(caught, 'Could not remove that person.'),
  });

  return (
    <AppShell
      nav={companyNav(companyId)}
      contextLabel={company.data?.name}
      contextHref={`/c/${companyId}`}
    >
      <PageHeader
        title="People"
        description="Who can see this company, and what they are allowed to do."
        actions={
          <Button variant="primary" onClick={() => setAddOpen(true)}>
            <UserPlus className="h-4 w-4" />
            Add person
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

      <Card>
        {members.isLoading ? <Spinner /> : null}

        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-ink-200 text-left text-xs text-ink-500">
              <th className="px-5 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Email</th>
              <th className="px-3 py-2 font-medium">Role</th>
              <th className="px-5 py-2" />
            </tr>
          </thead>
          <tbody className="divide-y divide-ink-100">
            {members.data?.map((member) => (
              <tr key={member.id} className="hover:bg-ink-50">
                <td className="px-5 py-2.5 text-ink-900">
                  {member.name}
                  {member.isActive ? null : (
                    <span className="ml-2">
                      <Badge tone="warn">deactivated</Badge>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2.5 text-ink-500">{member.email}</td>
                <td className="px-3 py-2.5">
                  <Select
                    value={member.role}
                    onChange={(event) =>
                      changeRole.mutate({ id: member.id, role: event.target.value as CompanyRole })
                    }
                    className="py-1 text-xs"
                    aria-label={`Role for ${member.email}`}
                  >
                    {COMPANY_ROLES.map((role) => (
                      <option key={role} value={role}>
                        {role.toLowerCase()}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="px-5 py-2.5 text-right">
                  <button
                    onClick={() => {
                      if (window.confirm(`Remove ${member.email} from this company?`)) {
                        removeMember.mutate(member.id);
                      }
                    }}
                    className="text-ink-400 hover:text-red-600"
                    aria-label={`Remove ${member.email}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="What each role can do" className="mt-4">
        <dl className="divide-y divide-ink-100 text-sm">
          {COMPANY_ROLES.map((role) => (
            <div key={role} className="flex gap-4 px-5 py-2">
              <dt className="w-24 shrink-0 font-medium text-ink-800">{role.toLowerCase()}</dt>
              <dd className="text-ink-600">{ROLE_DESCRIPTIONS[role]}</dd>
            </div>
          ))}
        </dl>
      </Card>

      <Modal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        title="Add someone to this company"
        description="They need an account already. Ask them to sign up first if they do not have one."
      >
        <AddMemberForm
          busy={addMember.isPending}
          onCancel={() => setAddOpen(false)}
          onSubmit={(body) => addMember.mutate(body)}
        />
      </Modal>
    </AppShell>
  );
}

function AddMemberForm({
  busy,
  onCancel,
  onSubmit,
}: {
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: { email: string; role: CompanyRole }) => void;
}) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<CompanyRole>('PREPARER');

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({ email, role });
      }}
    >
      <Input
        label="Email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
        autoFocus
      />
      <Select label="Role" value={role} onChange={(e) => setRole(e.target.value as CompanyRole)}>
        {COMPANY_ROLES.map((value) => (
          <option key={value} value={value}>
            {value.toLowerCase()}
          </option>
        ))}
      </Select>
      <p className="text-xs text-ink-400">{ROLE_DESCRIPTIONS[role]}</p>

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
