import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Metrics, type Order } from '../lib/api.js';
import { StatusPill } from '../components/StatusPill.js';
import { MetricTile, formatCents } from '../components/MetricTile.js';

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
      <h1 className="mb-4 text-xl font-semibold text-slate-100">Orders</h1>

      {metricsQuery.data && (
        <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-5">
          <MetricTile label="Orders today" value={String(metricsQuery.data.ordersToday)} />
          <MetricTile label="Avg margin" value={formatCents(metricsQuery.data.avgMarginCents)} />
          <MetricTile label="Regex-extracted" value={`${metricsQuery.data.autoExtractedRegexPercent}%`} />
          <MetricTile label="Gemini-extracted" value={`${metricsQuery.data.autoExtractedGeminiPercent}%`} />
          <MetricTile label="Open exceptions" value={String(metricsQuery.data.exceptionsOpen)} />
        </div>
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200"
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All statuses' : s.replace(/_/g, ' ')}
            </option>
          ))}
        </select>
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search order #..."
          className="rounded-md border border-slate-800 bg-slate-900 px-3 py-1.5 text-sm text-slate-200 placeholder:text-slate-600"
        />
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-800">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-900/60 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-2.5">Order</th>
              <th className="px-4 py-2.5">Status</th>
              <th className="px-4 py-2.5">Subtotal</th>
              <th className="px-4 py-2.5">Margin</th>
              <th className="px-4 py-2.5">Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-800">
            {ordersQuery.data?.orders.map((order) => (
              <tr key={order.id} className="hover:bg-slate-900/40">
                <td className="px-4 py-2.5">
                  <Link to={`/orders/${order.id}`} className="font-medium text-emerald-400 hover:underline">
                    {order.externalOrderNumber}
                  </Link>
                </td>
                <td className="px-4 py-2.5">
                  <StatusPill status={order.status} />
                </td>
                <td className="px-4 py-2.5 text-slate-300">{formatCents(order.subtotalCents)}</td>
                <td className={`px-4 py-2.5 ${order.marginCents !== null && order.marginCents < 0 ? 'text-red-400' : 'text-slate-300'}`}>
                  {order.marginCents !== null ? formatCents(order.marginCents) : '—'}
                </td>
                <td className="px-4 py-2.5 text-slate-500">{new Date(order.createdAt).toLocaleString()}</td>
              </tr>
            ))}
            {ordersQuery.data?.orders.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-slate-500">
                  No orders match this filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
