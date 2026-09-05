'use client';

import { use, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RefreshCw, Trash2, Wand2 } from 'lucide-react';
import { formatAmount, isYearEditable, type NoteDto } from '@finstat/shared';

import { api, ApiError } from '@/lib/api';
import { AppShell, yearNav } from '@/components/app-shell';
import { useCompany, useNotes, useYear } from '@/lib/queries';
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
  Textarea,
} from '@/components/ui';

export default function NotesPage({
  params,
}: {
  params: Promise<{ companyId: string; yearId: string }>;
}) {
  const { companyId, yearId } = use(params);
  const company = useCompany(companyId);
  const { year } = useYear(companyId, yearId);
  const notes = useNotes(companyId, yearId);
  const queryClient = useQueryClient();

  const [message, setMessage] = useState<{ tone: 'good' | 'bad'; text: string } | null>(null);
  const [editing, setEditing] = useState<NoteDto | null>(null);
  const [adding, setAdding] = useState(false);

  const editable = year ? isYearEditable(year.status) : false;

  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['notes', companyId, yearId] });
    await queryClient.invalidateQueries({ queryKey: ['validation', companyId, yearId] });
    await queryClient.invalidateQueries({ queryKey: ['statements', companyId, yearId] });
  };

  function report(caught: unknown, fallback: string) {
    setMessage({ tone: 'bad', text: caught instanceof ApiError ? caught.message : fallback });
  }

  const generate = useMutation({
    mutationFn: () =>
      api.post<{ created: number; updated: number; keptEdited: number }>(
        `/companies/${companyId}/years/${yearId}/notes/generate`,
        { includePolicies: true },
      ),
    onSuccess: async (result) => {
      await refresh();
      setMessage({
        tone: 'good',
        text: `${result.created} notes added, ${result.updated} refreshed, ${result.keptEdited} left exactly as you wrote them.`,
      });
    },
    onError: (caught) => report(caught, 'Could not generate the notes.'),
  });

  const saveNote = useMutation({
    mutationFn: ({ id, ...body }: { id: string } & Record<string, unknown>) =>
      api.patch(`/companies/${companyId}/years/${yearId}/notes/${id}`, body),
    onSuccess: async () => {
      await refresh();
      setEditing(null);
      setMessage({ tone: 'good', text: 'Note saved.' });
    },
    onError: (caught) => report(caught, 'Could not save that note.'),
  });

  const addNote = useMutation({
    mutationFn: (body: Record<string, unknown>) =>
      api.post(`/companies/${companyId}/years/${yearId}/notes`, body),
    onSuccess: async () => {
      await refresh();
      setAdding(false);
      setMessage({ tone: 'good', text: 'Note added.' });
    },
    onError: (caught) => report(caught, 'Could not add that note.'),
  });

  const removeNote = useMutation({
    mutationFn: (id: string) => api.delete(`/companies/${companyId}/years/${yearId}/notes/${id}`),
    onSuccess: async () => {
      await refresh();
      setMessage({ tone: 'good', text: 'Note deleted.' });
    },
    onError: (caught) => report(caught, 'Could not delete that note.'),
  });

  const notTying = notes.data?.filter((note) => !note.ties).length ?? 0;

  return (
    <AppShell
      nav={yearNav(companyId, yearId)}
      contextLabel={`${company.data?.name ?? ''} · ${year?.label ?? ''}`}
      contextHref={`/c/${companyId}/y/${yearId}`}
    >
      <div className="no-print">
        <PageHeader
          title="Notes and disclosures"
          description="Accounting policies you write, and supporting notes built from the figures."
          actions={
            <>
              <Button onClick={() => setAdding(true)} disabled={!editable}>
                <Plus className="h-4 w-4" />
                Add note
              </Button>
              <Button
                variant="primary"
                onClick={() => generate.mutate()}
                loading={generate.isPending}
                disabled={!editable}
              >
                <Wand2 className="h-4 w-4" />
                Generate from the figures
              </Button>
            </>
          }
        />
      </div>

      {message ? (
        <div className="no-print mb-4">
          <Alert tone={message.tone} onDismiss={() => setMessage(null)}>
            {message.text}
          </Alert>
        </div>
      ) : null}

      {notTying > 0 ? (
        <div className="no-print mb-4">
          <Alert tone="bad" title={`${notTying} ${notTying === 1 ? 'note does' : 'notes do'} not tie`}>
            A note has to add up to the figure on the face of the statements. Regenerating fixes the
            ones that were built from the figures.
          </Alert>
        </div>
      ) : null}

      {notes.isLoading ? <Spinner /> : null}

      {notes.data?.length === 0 ? (
        <Card>
          <EmptyState
            title="No notes yet"
            description="Generate them and you get the standard accounting policies plus one note per statement line that carries a balance, broken down by account with last year alongside."
            action={
              <Button variant="primary" onClick={() => generate.mutate()} disabled={!editable}>
                Generate the notes
              </Button>
            }
          />
        </Card>
      ) : null}

      <div className="space-y-4">
        {notes.data?.map((note) => (
          <Card
            key={note.id}
            title={`${note.number}. ${note.title}`}
            className="print-page"
            actions={
              <div className="no-print flex items-center gap-2">
                {note.isSystemGenerated ? (
                  <Badge tone="info">generated</Badge>
                ) : (
                  <Badge tone="neutral">edited</Badge>
                )}
                {note.ties ? null : <Badge tone="bad">does not tie</Badge>}
                <Button size="sm" onClick={() => setEditing(note)} disabled={!editable}>
                  Edit
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={!editable}
                  onClick={() => {
                    if (window.confirm(`Delete note ${note.number}?`)) removeNote.mutate(note.id);
                  }}
                  aria-label={`Delete note ${note.number}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            }
          >
            <div className="px-5 py-4">
              {note.body ? (
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">
                  {note.body}
                </p>
              ) : null}

              {note.lines.length > 0 ? (
                <table className="mt-3 w-full text-sm">
                  <thead>
                    <tr className="border-b border-ink-100 text-xs text-ink-500">
                      <th className="py-1.5 text-left font-medium" />
                      <th className="w-32 py-1.5 text-right font-medium">Current</th>
                      <th className="w-32 py-1.5 text-right font-medium">Prior</th>
                    </tr>
                  </thead>
                  <tbody>
                    {note.lines.map((line) => (
                      <tr key={line.id} className={line.isSubtotal ? 'border-t border-ink-200' : ''}>
                        <td className={`py-1 ${line.isSubtotal ? 'font-medium' : 'text-ink-700'}`}>
                          {line.label}
                        </td>
                        <td className="tabular py-1 text-right">
                          {line.currentAmount === null ? '' : formatAmount(line.currentAmount)}
                        </td>
                        <td className="tabular py-1 text-right text-ink-500">
                          {line.priorAmount === null ? '' : formatAmount(line.priorAmount)}
                        </td>
                      </tr>
                    ))}
                    {note.total !== null ? (
                      <tr className="border-t-2 border-ink-300 font-semibold">
                        <td className="py-1.5">Total</td>
                        <td className="tabular py-1.5 text-right">{formatAmount(note.total)}</td>
                        <td className="tabular py-1.5 text-right text-ink-500">
                          {note.priorTotal === null ? '' : formatAmount(note.priorTotal)}
                        </td>
                      </tr>
                    ) : null}
                  </tbody>
                </table>
              ) : null}

              {!note.ties && note.statementAmount !== null ? (
                <p className="mt-2 text-xs text-red-600">
                  The statements show {formatAmount(note.statementAmount)} for this line.
                </p>
              ) : null}
            </div>
          </Card>
        ))}
      </div>

      {editing ? (
        <Modal
          open
          onClose={() => setEditing(null)}
          wide
          title={`Edit note ${editing.number}`}
          description="Editing a generated note makes it yours: regenerating will leave it alone from now on."
        >
          <NoteForm
            note={editing}
            busy={saveNote.isPending}
            onCancel={() => setEditing(null)}
            onSubmit={(body) => saveNote.mutate({ id: editing.id, ...body })}
          />
        </Modal>
      ) : null}

      {adding ? (
        <Modal open onClose={() => setAdding(false)} wide title="Add a note">
          <NoteForm
            busy={addNote.isPending}
            onCancel={() => setAdding(false)}
            onSubmit={(body) => addNote.mutate({ ...body, kind: 'FREE_TEXT' })}
          />
        </Modal>
      ) : null}
    </AppShell>
  );
}

function NoteForm({
  note,
  busy,
  onCancel,
  onSubmit,
}: {
  note?: NoteDto;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (body: Record<string, unknown>) => void;
}) {
  const [title, setTitle] = useState(note?.title ?? '');
  const [body, setBody] = useState(note?.body ?? '');
  const [lines, setLines] = useState(
    note?.lines.map((line) => ({
      label: line.label,
      currentAmount: line.currentAmount === null ? '' : String(line.currentAmount),
      priorAmount: line.priorAmount === null ? '' : String(line.priorAmount),
      isSubtotal: line.isSubtotal,
    })) ?? [],
  );

  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit({
          title,
          body: body || null,
          lines: lines.map((line, index) => ({
            label: line.label,
            currentAmount: line.currentAmount === '' ? null : Number(line.currentAmount),
            priorAmount: line.priorAmount === '' ? null : Number(line.priorAmount),
            isSubtotal: line.isSubtotal,
            sortOrder: index,
          })),
        });
      }}
    >
      <Input label="Title" value={title} onChange={(e) => setTitle(e.target.value)} required />
      <Textarea
        label="Text"
        value={body}
        onChange={(e) => setBody(e.target.value)}
        rows={5}
        placeholder="The wording that prints under this note."
      />

      {lines.length > 0 ? (
        <div>
          <span className="mb-1 block text-xs font-medium text-ink-600">Lines</span>
          <div className="space-y-1.5">
            {lines.map((line, index) => (
              <div key={index} className="flex items-center gap-2">
                <input
                  value={line.label}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, label: event.target.value } : item,
                      ),
                    )
                  }
                  className="flex-1 rounded border border-ink-200 px-2 py-1 text-sm"
                  aria-label={`Label for line ${index + 1}`}
                />
                <input
                  value={line.currentAmount}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, currentAmount: event.target.value } : item,
                      ),
                    )
                  }
                  className="tabular w-28 rounded border border-ink-200 px-2 py-1 text-right text-sm"
                  aria-label={`Current amount for line ${index + 1}`}
                />
                <input
                  value={line.priorAmount}
                  onChange={(event) =>
                    setLines((current) =>
                      current.map((item, i) =>
                        i === index ? { ...item, priorAmount: event.target.value } : item,
                      ),
                    )
                  }
                  className="tabular w-28 rounded border border-ink-200 px-2 py-1 text-right text-sm"
                  aria-label={`Prior amount for line ${index + 1}`}
                />
                <button
                  type="button"
                  onClick={() => setLines((current) => current.filter((_, i) => i !== index))}
                  className="text-ink-400 hover:text-red-600"
                  aria-label={`Remove line ${index + 1}`}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        size="sm"
        onClick={() =>
          setLines((current) => [
            ...current,
            { label: '', currentAmount: '', priorAmount: '', isSubtotal: false },
          ])
        }
      >
        <RefreshCw className="h-3.5 w-3.5" />
        Add a line
      </Button>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" variant="primary" loading={busy}>
          Save note
        </Button>
      </div>
    </form>
  );
}
