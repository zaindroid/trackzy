import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type OrderDetail } from '../lib/api.js';
import { StatusPill } from '../components/StatusPill.js';
import { formatCents } from '../components/MetricTile.js';

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

  if (detailQuery.isLoading) return <p className="text-slate-500">Loading...</p>;
  if (detailQuery.error || !detailQuery.data) return <p className="text-red-400">Order not found.</p>;

  const { order, lineItems, fulfillments, disputes, webhookEvent } = detailQuery.data;

  return (
    <div className="max-w-4xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-slate-100">{order.externalOrderNumber}</h1>
          <div className="mt-1 flex items-center gap-2">
            <StatusPill status={order.status} />
            <span className="text-sm text-slate-500">
              {formatCents(order.subtotalCents)} subtotal · margin{' '}
              {order.marginCents !== null ? formatCents(order.marginCents) : 'not yet evaluated'}
            </span>
          </div>
        </div>
        <div className="flex gap-2">
          {order.status === 'rejected' && (
            <button
              onClick={() => approveMutation.mutate()}
              className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400"
            >
              Approve anyway
            </button>
          )}
          {order.status !== 'shipped' && order.status !== 'delivered' && order.status !== 'cancelled' && (
            <button
              onClick={() => cancelMutation.mutate()}
              className="rounded-md border border-slate-700 px-3 py-1.5 text-sm text-slate-300 hover:bg-slate-800"
            >
              Cancel order
            </button>
          )}
        </div>
      </div>

      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Timeline</h2>
        <ol className="space-y-2 text-sm text-slate-400">
          <li>Webhook received{webhookEvent ? ` — ${new Date(webhookEvent.receivedAt).toLocaleString()}` : ''}</li>
          <li>
            Margin evaluated{order.marginCents !== null ? ` — ${formatCents(order.marginCents)}` : ''}
          </li>
          {fulfillments.map((f) => (
            <li key={f.id}>
              Fulfillment {f.id.slice(0, 8)} via supplier — {f.trackingNumber ?? 'awaiting tracking'}{' '}
              {f.carrierFinal && `(${f.carrierFinal})`} <StatusPill status={f.trackingStatus} />
            </li>
          ))}
        </ol>
      </section>

      <section className="mb-6 rounded-lg border border-slate-800">
        <h2 className="border-b border-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-300">Line items</h2>
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2">SKU</th>
              <th className="px-4 py-2">Title</th>
              <th className="px-4 py-2">Qty</th>
              <th className="px-4 py-2">Fulfilled</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {lineItems.map((li) => (
              <tr key={li.id}>
                <td className="px-4 py-2 text-slate-300">{li.sku}</td>
                <td className="px-4 py-2 text-slate-300">{li.title}</td>
                <td className="px-4 py-2 text-slate-300">{li.quantity}</td>
                <td className="px-4 py-2 text-slate-300">
                  {li.quantityFulfilled}/{li.quantity}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mb-6 rounded-lg border border-slate-800 bg-slate-900/40 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-300">Add tracking manually</h2>
        <div className="flex flex-wrap items-center gap-2">
          <input
            value={trackingNumber}
            onChange={(e) => setTrackingNumber(e.target.value)}
            placeholder="Tracking number"
            className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
          />
          <select
            value={carrier}
            onChange={(e) => setCarrier(e.target.value)}
            className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
          >
            <option value="">Auto-detect carrier</option>
            <option value="UPS">UPS</option>
            <option value="USPS">USPS</option>
            <option value="FEDEX">FedEx</option>
            <option value="DHL">DHL</option>
          </select>
          <button
            onClick={() => trackingMutation.mutate()}
            disabled={!trackingNumber || trackingMutation.isPending}
            className="rounded-md bg-emerald-500 px-3 py-1.5 text-sm font-medium text-slate-950 hover:bg-emerald-400 disabled:opacity-50"
          >
            Save
          </button>
        </div>
        {trackingMutation.isError && (
          <p className="mt-2 text-sm text-red-400">{(trackingMutation.error as Error).message}</p>
        )}
      </section>

      {disputes.length > 0 && (
        <section className="rounded-lg border border-slate-800 p-4">
          <h2 className="mb-2 text-sm font-semibold text-slate-300">Disputes</h2>
          {disputes.map((d) => (
            <div key={d.id} className="mb-2 text-sm text-slate-400">
              {d.draftSubject} <StatusPill status={d.status} />
            </div>
          ))}
        </section>
      )}
    </div>
  );
}
