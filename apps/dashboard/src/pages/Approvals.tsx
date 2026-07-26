import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type PendingSupplierOrder } from '../lib/api.js';
import { StatusStamp } from '../components/StatusStamp.js';
import { Button, EmptyState, PageHeader, Panel } from '../components/ui.js';

function centsToDollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function PendingOrderCard({ pending }: { pending: PendingSupplierOrder }) {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();

  const decide = useMutation({
    mutationFn: (action: 'approve' | 'reject') => apiFetch(`/pending-supplier-orders/${pending.id}/${action}`, token, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['pendingSupplierOrders'] }),
  });

  return (
    <Panel>
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-ink">{pending.supplierName ?? 'Supplier'}</div>
          <div className="text-xs text-ink-muted">Order {pending.externalOrderNumber ?? pending.orderId}</div>
        </div>
        <StatusStamp status={pending.status} />
      </div>

      <ul className="mb-3 space-y-1 text-sm text-ink-muted">
        {pending.lineItems.map((li, i) => (
          <li key={i} className="font-mono">
            {li.quantity}× {li.sku}
            {li.title ? ` — ${li.title}` : ''}
          </li>
        ))}
      </ul>

      <div className="mb-4 text-sm text-ink">
        Cost to place this order: <span className="font-mono font-medium">{centsToDollars(pending.costCents)}</span>
      </div>

      {pending.status === 'pending' && (
        <div className="flex flex-wrap gap-2">
          <Button variant="primary" onClick={() => decide.mutate('approve')} disabled={decide.isPending}>
            Approve &amp; place order
          </Button>
          <Button variant="danger" onClick={() => decide.mutate('reject')} disabled={decide.isPending}>
            Reject
          </Button>
        </div>
      )}
    </Panel>
  );
}

export function ApprovalsPage() {
  const { token } = useAuthToken();
  const query = useQuery({
    queryKey: ['pendingSupplierOrders'],
    queryFn: () => apiFetch<{ pendingSupplierOrders: PendingSupplierOrder[] }>('/pending-supplier-orders', token),
  });

  const pending = query.data?.pendingSupplierOrders.filter((p) => p.status === 'pending') ?? [];
  const decided = query.data?.pendingSupplierOrders.filter((p) => p.status !== 'pending') ?? [];

  return (
    <div className="max-w-2xl">
      <PageHeader
        eyebrow="Money-spending decisions"
        title="Approvals"
        description="Every order the automation has already worked out end-to-end — supplier, cost, line items — pauses here before the real money actually gets spent. One click places it."
      />
      <div className="space-y-4">
        {pending.map((p) => (
          <PendingOrderCard key={p.id} pending={p} />
        ))}
        {pending.length === 0 && <EmptyState>Nothing waiting on you right now.</EmptyState>}
      </div>

      {decided.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-ink-faint">Recently decided</h2>
          <div className="space-y-4">
            {decided.map((p) => (
              <PendingOrderCard key={p.id} pending={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
