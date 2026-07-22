import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Dispute } from '../lib/api.js';
import { StatusStamp } from '../components/StatusStamp.js';
import { Button, EmptyState, Field, PageHeader, Panel, Textarea, TextInput } from '../components/ui.js';

function DisputeCard({ dispute }: { dispute: Dispute }) {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const [subject, setSubject] = useState(dispute.draftSubject);
  const [body, setBody] = useState(dispute.draftBody);

  const patchMutation = useMutation({
    mutationFn: (status?: string) =>
      apiFetch(`/disputes/${dispute.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ draftSubject: subject, draftBody: body, ...(status ? { status } : {}) }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['disputes'] }),
  });

  const editable = dispute.status === 'draft';

  return (
    <Panel>
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="text-sm text-ink-muted">{dispute.reason}</span>
        <StatusStamp status={dispute.status} />
      </div>
      <div className="space-y-3">
        <Field label="Subject">
          <TextInput value={subject} onChange={(e) => setSubject(e.target.value)} disabled={!editable} />
        </Field>
        <Field label="Message">
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} disabled={!editable} rows={5} />
        </Field>
      </div>
      {editable && (
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => patchMutation.mutate('approved')}>
            Approve &amp; send
          </Button>
          <Button variant="danger" onClick={() => patchMutation.mutate('rejected')}>
            Reject
          </Button>
          <Button variant="ghost" onClick={() => patchMutation.mutate(undefined)}>
            Save edits
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function DisputesPage() {
  const { token } = useAuthToken();
  const query = useQuery({
    queryKey: ['disputes'],
    queryFn: () => apiFetch<{ disputes: Dispute[] }>('/disputes', token),
  });

  return (
    <div className="max-w-2xl">
      <PageHeader eyebrow="Exceptions" title="Disputes" description="Carrier claims drafted for missing or delayed shipments." />
      <div className="space-y-4">
        {query.data?.disputes.map((d) => (
          <DisputeCard key={d.id} dispute={d} />
        ))}
        {query.data?.disputes.length === 0 && <EmptyState>No open disputes.</EmptyState>}
      </div>
    </div>
  );
}
