import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Dispute } from '../lib/api.js';
import { StatusPill } from '../components/StatusPill.js';

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
    <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-4">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs text-slate-500">{dispute.reason}</span>
        <StatusPill status={dispute.status} />
      </div>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        disabled={!editable}
        className="mb-2 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-60"
      />
      <textarea
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={!editable}
        rows={5}
        className="mb-3 w-full rounded-md border border-slate-800 bg-slate-950 px-3 py-1.5 text-sm text-slate-200 disabled:opacity-60"
      />
      {editable && (
        <div className="flex gap-2">
          <button
            onClick={() => patchMutation.mutate('approved')}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400"
          >
            Approve &amp; send
          </button>
          <button
            onClick={() => patchMutation.mutate('rejected')}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Reject
          </button>
          <button
            onClick={() => patchMutation.mutate(undefined)}
            className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
          >
            Save edits
          </button>
        </div>
      )}
    </div>
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
      <h1 className="mb-4 text-xl font-semibold text-slate-100">Disputes</h1>
      <div className="space-y-4">
        {query.data?.disputes.map((d) => (
          <DisputeCard key={d.id} dispute={d} />
        ))}
        {query.data?.disputes.length === 0 && <p className="text-slate-500">No disputes.</p>}
      </div>
    </div>
  );
}
