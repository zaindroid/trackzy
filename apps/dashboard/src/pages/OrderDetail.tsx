import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type OrderDetail } from '../lib/api.js';
import { StatusStamp } from '../components/StatusStamp.js';
import { formatCents } from '../components/MetricTile.js';
import { Button, PageHeader, Panel, Select, TextInput } from '../components/ui.js';

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const [trackingNumber, setTrackingNumber] = useState('');
  const [carrier, setCarrier] = useState('');

  const detailQuery = useQuery({
    queryKey: ['order', id],
    queryFn: () => apiFetch<OrderDetail>(`/orders/${id}`, token),
    enabled: Boolean(id),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['order', id] });
    queryClient.invalidateQueries({ queryKey: ['orders'] });
  };

  const approveMutation = useMutation({
    mutationFn: () => apiFetch(`/orders/${id}/approve`, token, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const cancelMutation = useMutation({
    mutationFn: () => apiFetch(`/orders/${id}/cancel`, token, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const trackingMutation = useMutation({
    mutationFn: () =>
      apiFetch(`/orders/${id}/tracking`, token, {
        method: 'POST',
        body: JSON.stringify({ trackingNumber, carrier: carrier || undefined }),
      }),
    onSuccess: () => {
      setTrackingNumber('');
      setCarrier('');
      invalidate();
    },
  });

  if (detailQuery.isLoading) return <p className="text-sm text-ink-faint">Loading order…</p>;
  if (detailQuery.error || !detailQuery.data) return <p className="text-sm text-brick">Order not found.</p>;

  const { order, lineItems, fulfillments, disputes, webhookEvent } = detailQuery.data;
  const canCancel = order.status !== 'shipped' && order.status !== 'delivered' && order.status !== 'cancelled';

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Order"
        title={order.externalOrderNumber}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <StatusStamp status={order.status} />
            <span className="font-mono">
              {formatCents(order.subtotalCents)} subtotal · margin{' '}
              {order.marginCents !== null ? formatCents(order.marginCents) : 'not yet evaluated'}
            </span>
          </span>
        }
        actions={
          <>
            {order.status === 'rejected' && (
              <Button variant="primary" onClick={() => approveMutation.mutate()}>
                Approve anyway
              </Button>
            )}
            {canCancel && (
              <Button variant="danger" onClick={() => cancelMutation.mutate()}>
                Cancel order
              </Button>
            )}
          </>
        }
      />

      <Panel title="Timeline" className="mb-6">
        <ol className="space-y-2 border-l border-rule pl-4 text-sm text-ink-muted">
          <li>Webhook received{webhookEvent ? ` — ${new Date(webhookEvent.receivedAt).toLocaleString()}` : ''}</li>
          <li>Margin evaluated{order.marginCents !== null ? ` — ${formatCents(order.marginCents)}` : ''}</li>
          {fulfillments.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center gap-2">
              <span>
                Fulfillment {f.id.slice(0, 8)} — {f.trackingNumber ?? 'awaiting tracking'}{' '}
                {f.carrierFinal && `(${f.carrierFinal})`}
              </span>
              <StatusStamp status={f.trackingStatus} />
            </li>
          ))}
        </ol>
      </Panel>

      <div className="mb-6 border border-rule bg-paper-raised shadow-raised">
        <h2 className="border-b border-rule px-4 py-2.5 text-sm font-semibold text-ink">Line items</h2>
        <table className="manifest">
          <thead className="border-b border-rule text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-4 py-2 font-medium">SKU</th>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Qty</th>
              <th className="px-4 py-2 font-medium">Fulfilled</th>
            </tr>
          </thead>
          <tbody>
            {lineItems.map((li) => (
              <tr key={li.id}>
                <td data-label="SKU" className="font-mono text-ink md:px-4 md:py-2">
                  {li.sku}
                </td>
                <td data-label="Title" className="text-ink md:px-4 md:py-2">
                  {li.title}
                </td>
                <td data-label="Qty" className="font-mono text-ink-muted md:px-4 md:py-2">
                  {li.quantity}
                </td>
                <td data-label="Fulfilled" className="font-mono text-ink-muted md:px-4 md:py-2">
                  {li.quantityFulfilled}/{li.quantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Panel title="Add tracking manually" className="mb-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TextInput
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="Tracking number"
            className="sm:w-56"
          />
          <Select value={carrier} onChange={(e) => setCarrier(e.target.value)} className="sm:w-48">
            <option value="">Auto-detect carrier</option>
            <option value="UPS">UPS</option>
            <option value="USPS">USPS</option>
            <option value="FEDEX">FedEx</option>
            <option value="DHL">DHL</option>
          </Select>
          <Button
            variant="primary"
            onClick={() => trackingMutation.mutate()}
            disabled={!trackingNumber || trackingMutation.isPending}
          >
            Save
          </Button>
        </div>
        {trackingMutation.isError && (
          <p className="mt-2 text-sm text-brick">{(trackingMutation.error as Error).message}</p>
        )}
      </Panel>

      {disputes.length > 0 && (
        <Panel title="Disputes">
          <div className="space-y-2">
            {disputes.map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-2 text-sm text-ink-muted">
                <span>{d.draftSubject}</span>
                <StatusStamp status={d.status} />
              </div>
            ))}
          </div>
        </Panel>
      )}
    </div>
  );
}
