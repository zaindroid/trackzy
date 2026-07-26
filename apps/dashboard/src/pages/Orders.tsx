import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Metrics, type Order } from '../lib/api.js';
import { StatusStamp } from '../components/StatusStamp.js';
import { MetricTile, formatCents } from '../components/MetricTile.js';
import { EmptyState, PageHeader, Select, TextInput } from '../components/ui.js';

const STATUS_FILTERS = [
  'all',
  'received',
  'evaluating',
  'fulfilling',
  'partially_shipped',
  'shipped',
  'delivered',
  'exception',
  'rejected',
  'cancelled',
];

export function OrdersPage() {
  const { token } = useAuthToken();
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');

  const ordersQuery = useQuery({
    queryKey: ['orders', status, search],
    queryFn: () => {
      const params = new URLSearchParams();
      if (status !== 'all') params.set('status', status);
      if (search) params.set('search', search);
      const qs = params.toString();
      return apiFetch<{ orders: Order[] }>(`/orders${qs ? `?${qs}` : ''}`, token);
    },
  });

  const metricsQuery = useQuery({
    queryKey: ['metrics'],
    queryFn: () => apiFetch<Metrics>('/metrics', token),
  });

  return (
    <div>
      <PageHeader eyebrow="Manifest" title="Orders" description="Every order flowing through fulfillment today." />

      {metricsQuery.data && (
        <div className="mb-8 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
          <Link to="/listings" className="block hover:opacity-80">
            <MetricTile
              label="Listings"
              value={`${metricsQuery.data.listingsMatched}/${metricsQuery.data.listingsTotal} matched`}
            />
          </Link>
          <MetricTile label="Orders today" value={String(metricsQuery.data.ordersToday)} />
          <MetricTile label="Avg margin" value={formatCents(metricsQuery.data.avgMarginCents)} />
          <MetricTile label="Regex-extracted" value={`${metricsQuery.data.autoExtractedRegexPercent}%`} />
          <MetricTile label="Gemini-extracted" value={`${metricsQuery.data.autoExtractedGeminiPercent}%`} />
          <MetricTile label="Open exceptions" value={String(metricsQuery.data.exceptionsOpen)} />
          <Link to="/fulfillments" className="block hover:opacity-80">
            <MetricTile label="Fulfillments" value="View all →" />
          </Link>
        </div>
      )}

      <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center">
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="sm:w-52">
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
        <TextInput
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order number"
          className="sm:w-56"
        />
      </div>

      <div className="border border-rule bg-paper-raised shadow-raised">
        <table className="manifest">
          <thead className="border-b border-rule text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-medium">Order</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Subtotal</th>
              <th className="px-4 py-2.5 font-medium">Margin</th>
              <th className="px-4 py-2.5 font-medium">Created</th>
            </tr>
          </thead>
          <tbody>
            {ordersQuery.data?.orders.map((order) => (
              <tr key={order.id} className="md:hover:bg-paper">
                <td data-label="Order" className="md:px-4 md:py-2.5">
                  <Link to={`/orders/${order.id}`} className="font-mono font-medium text-signal hover:underline">
                    {order.externalOrderNumber}
                  </Link>
                </td>
                <td data-label="Status" className="md:px-4 md:py-2.5">
                  <StatusStamp status={order.status} />
                </td>
                <td data-label="Subtotal" className="font-mono text-ink-muted md:px-4 md:py-2.5">
                  {formatCents(order.subtotalCents)}
                </td>
                <td
                  data-label="Margin"
                  className={`font-mono md:px-4 md:py-2.5 ${order.marginCents !== null && order.marginCents < 0 ? 'text-brick' : 'text-ink-muted'}`}
                >
                  {order.marginCents !== null ? formatCents(order.marginCents) : '—'}
                </td>
                <td data-label="Created" className="text-ink-faint md:px-4 md:py-2.5">
                  {new Date(order.createdAt).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {ordersQuery.data?.orders.length === 0 && <EmptyState>No orders match this filter.</EmptyState>}
      </div>
    </div>
  );
}
