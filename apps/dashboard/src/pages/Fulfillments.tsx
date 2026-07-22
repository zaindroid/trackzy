import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Fulfillment } from '../lib/api.js';
import { StatusStamp } from '../components/StatusStamp.js';
import { Button, EmptyState, PageHeader, Select, TextInput } from '../components/ui.js';

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
    <tr className="bg-ochre/5">
      <td data-label="Fulfillment" className="font-mono text-ink-muted md:px-4 md:py-2.5">
        {fulfillment.id.slice(0, 8)}
      </td>
      <td data-label="Tracking" className="md:px-4 md:py-2.5">
        <TextInput
          value={trackingNumber}
          onChange={(e) => setTrackingNumber(e.target.value)}
          className="w-44 font-mono sm:w-52"
        />
      </td>
      <td data-label="Carrier" className="md:px-4 md:py-2.5">
        <Select value={carrierFinal} onChange={(e) => setCarrierFinal(e.target.value)} className="w-36">
          <option value="">Pick carrier</option>
          <option value="UPS">UPS</option>
          <option value="USPS">USPS</option>
          <option value="FEDEX">FedEx</option>
          <option value="DHL">DHL</option>
        </Select>
      </td>
      <td data-label="Status" className="md:px-4 md:py-2.5">
        <div className="flex items-center justify-end gap-2 md:justify-start">
          <Button variant="primary" onClick={() => resolveMutation.mutate()} disabled={resolveMutation.isPending}>
            Resolve
          </Button>
          {resolveMutation.isError && (
            <span className="text-xs text-brick">{(resolveMutation.error as Error).message}</span>
          )}
        </div>
      </td>
    </tr>
  );
}

export function FulfillmentsPage() {
  const { token } = useAuthToken();
  const [tab, setTab] = useState<'all' | 'needsReview'>('all');

  const query = useQuery({
    queryKey: ['fulfillments', tab],
    queryFn: () =>
      apiFetch<{ fulfillments: Fulfillment[] }>(`/fulfillments${tab === 'needsReview' ? '?needsReview=true' : ''}`, token),
  });

  return (
    <div>
      <PageHeader eyebrow="Manifest" title="Fulfillments" description="Tracking numbers, carriers, and shipment status." />

      <div className="mb-4 flex gap-5 border-b border-rule text-sm">
        <button
          onClick={() => setTab('all')}
          className={`-mb-px border-b-2 px-1 py-2 font-medium transition-colors ${
            tab === 'all' ? 'border-signal text-ink' : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          All
        </button>
        <button
          onClick={() => setTab('needsReview')}
          className={`-mb-px border-b-2 px-1 py-2 font-medium transition-colors ${
            tab === 'needsReview' ? 'border-ochre text-ink' : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          Needs review
        </button>
      </div>

      <div className="border border-rule bg-paper-raised shadow-raised">
        <table className="manifest">
          <thead className="border-b border-rule text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-medium">Fulfillment</th>
              <th className="px-4 py-2.5 font-medium">Tracking</th>
              <th className="px-4 py-2.5 font-medium">Carrier</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {query.data?.fulfillments.map((f) =>
              f.trackingStatus === 'needs_review' ? (
                <ResolveRow key={f.id} fulfillment={f} />
              ) : (
                <tr key={f.id} className="md:hover:bg-paper">
                  <td data-label="Fulfillment" className="font-mono text-ink-muted md:px-4 md:py-2.5">
                    {f.id.slice(0, 8)}
                  </td>
                  <td data-label="Tracking" className="font-mono text-ink md:px-4 md:py-2.5">
                    {f.trackingNumber ?? '—'}
                  </td>
                  <td data-label="Carrier" className="text-ink-muted md:px-4 md:py-2.5">
                    {f.carrierFinal ?? '—'}
                  </td>
                  <td data-label="Status" className="md:px-4 md:py-2.5">
                    <StatusStamp status={f.trackingStatus} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        {query.data?.fulfillments.length === 0 && <EmptyState>Nothing here.</EmptyState>}
      </div>
    </div>
  );
}
