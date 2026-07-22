import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Fulfillment } from '../lib/api.js';
import { StatusPill } from '../components/StatusPill.js';

function ResolveRow({ fulfillment }: { fulfillment: Fulfillment }) {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const [trackingNumber, setTrackingNumber] = useState(fulfillment.trackingNumber ?? '');
  const [carrierFinal, setCarrierFinal] = useState('');

  const resolveMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/fulfillments/${fulfillment.id}`, token, {
        method: 'PATCH',
        body: JSON.stringify({ trackingNumber, carrierFinal: carrierFinal || undefined }),
      }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['fulfillments'] }),
  });

  return (
    <tr>
      <td className="px-4 py-2.5 text-slate-300">{fulfillment.id.slice(0, 8)}</td>
      <td className="px-4 py-2.5">
        <input
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          className="w-48 rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-200"
        />
      </td>
      <td className="px-4 py-2.5">
        <select
          value={carrierFinal}
          onChange={(e) => setCarrierFinal(e.target.value)}
          className="rounded-md border border-slate-800 bg-slate-900 px-2 py-1 text-sm text-slate-200"
        >
          <option value="">Pick carrier</option>
          <option value="UPS">UPS</option>
          <option value="USPS">USPS</option>
          <option value="FEDEX">FedEx</option>
          <option value="DHL">DHL</option>
        </select>
      </td>
      <td className="px-4 py-2.5">
        <button
          onClick={() => resolveMutation.mutate()}
          disabled={resolveMutation.isPending}
          className="rounded-md bg-emerald-500 px-3 py-1 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
        >
          Resolve
        </button>
        {resolveMutation.isError && <span className="ml-2 text-xs text-red-400">{(resolveMutation.error as Error).message}</span>}
      </td>
    </tr>
  );
}

export function FulfillmentsPage() {
  const { token } = useAuthToken();
  const [tab, setTab] = useState<'all' | 'needsReview'>('all');

  const query = useQuery({
    queryKey: ['fulfillments', tab],
    queryFn: () => apiFetch<{ fulfillments: Fulfillment[] }>(`/fulfillments${tab === 'needsReview' ? '?needsReview=true' : ''}`, token),
  });

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-slate-100">Fulfillments</h1>

      <div className="mb-4 flex gap-2">
        <button
          onClick={() => setTab('all')}
          className={`rounded-md px-3 py-1.5 text-sm ${tab === 'all' ? 'bg-emerald-500/15 text-emerald-400' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          All
        </button>
        <button
          onClick={() => setTab('needsReview')}
          className={`rounded-md px-3 py-1.5 text-sm ${tab === 'needsReview' ? 'bg-amber-500/15 text-amber-400' : 'text-slate-400 hover:bg-slate-800'}`}
        >
          Needs review
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Fulfillment</th>
              <th className="px-4 py-2.5">Tracking</th>
              <th className="px-4 py-2.5">Carrier</th>
              <th className="px-4 py-2.5">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {query.data?.fulfillments.map((f) =>
              f.trackingStatus === 'needs_review' ? (
                <ResolveRow key={f.id} fulfillment={f} />
              ) : (
                <tr key={f.id} className="hover:bg-slate-900/40">
                  <td className="px-4 py-2.5 text-slate-300">{f.id.slice(0, 8)}</td>
                  <td className="px-4 py-2.5 text-slate-300">{f.trackingNumber ?? '—'}</td>
                  <td className="px-4 py-2.5 text-slate-300">{f.carrierFinal ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <StatusPill status={f.trackingStatus} />
                  </td>
                </tr>
              ),
            )}
            {query.data?.fulfillments.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  Nothing here.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
