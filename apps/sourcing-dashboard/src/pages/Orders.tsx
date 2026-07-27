import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { trackzyFetch, type TrackzyOrder } from '../lib/api.js';
import { EmptyState, PageHeader } from '../components/ui.js';

function money(cents: number, currency = 'USD'): string {
  return `${currency === 'USD' ? '$' : ''}${(cents / 100).toFixed(2)}`;
}

const STATUS_TONE: Record<string, string> = {
  received: 'bg-signal/15 text-signal',
  fulfilled: 'bg-moss/15 text-moss',
  shipped: 'bg-moss/15 text-moss',
  cancelled: 'bg-brick/15 text-brick',
  error: 'bg-brick/15 text-brick',
};

export function OrdersPage() {
  const { getToken } = useAuthToken();
  const query = useQuery({
    queryKey: ['trackzy-orders'],
    queryFn: () => trackzyFetch<{ orders: TrackzyOrder[] }>('/orders', getToken),
    retry: false,
  });
  const orders = query.data?.orders ?? [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Fulfill"
        title="Orders"
        description="Orders on your connected eBay store are auto-fulfilled through your supplier — tracked here end to end."
      />

      {query.isError && (
        <EmptyState>
          Couldn't load orders. Make sure your eBay store is connected on the Connections tab.
        </EmptyState>
      )}

      {!query.isError && orders.length === 0 && !query.isLoading && (
        <EmptyState>No orders yet. When a buyer purchases a listing, it appears here and fulfills automatically.</EmptyState>
      )}

      {orders.length > 0 && (
        <div className="overflow-x-auto border border-rule">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-rule bg-paper-raised text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="p-2 font-medium">Order</th>
                <th className="p-2 font-medium">Status</th>
                <th className="p-2 text-right font-medium">Total</th>
                <th className="p-2 text-right font-medium">Margin</th>
                <th className="p-2 text-right font-medium">Date</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => (
                <tr key={o.id} className="border-b border-rule last:border-0">
                  <td className="p-2 font-medium text-ink">{o.externalOrderNumber}</td>
                  <td className="p-2">
                    <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${STATUS_TONE[o.status] ?? 'bg-paper text-ink-muted'}`}>{o.status}</span>
                  </td>
                  <td className="p-2 text-right tabular-nums">{money(o.subtotalCents + o.shippingCents, o.currency)}</td>
                  <td className="p-2 text-right tabular-nums text-moss">{o.marginCents != null ? money(o.marginCents, o.currency) : '—'}</td>
                  <td className="p-2 text-right text-xs text-ink-faint">{new Date(o.createdAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
