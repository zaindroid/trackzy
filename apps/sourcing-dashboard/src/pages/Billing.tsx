import { useMutation, useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type CreditsResponse } from '../lib/api.js';
import { Button, EmptyState, PageHeader, Panel } from '../components/ui.js';

interface OfferingsResponse {
  configured: boolean;
  offerings: { id: string; label: string; price: string; kind: 'credits' | 'subscription'; credits?: number; plan?: string }[];
}

function reasonLabel(reason: string): string {
  const map: Record<string, string> = {
    trial: 'Trial credits',
    research: 'Product research',
    unlock: 'Unlocked a winner',
    list: 'Listed to eBay',
    fulfill: 'Order fulfilled',
    purchase: 'Credit purchase',
    refund: 'Refund',
    adjustment: 'Adjustment',
  };
  return map[reason] ?? reason;
}

export function BillingPage() {
  const { getToken } = useAuthToken();
  const query = useQuery({ queryKey: ['credits'], queryFn: () => apiFetch<CreditsResponse>('/credits', getToken) });
  const offeringsQuery = useQuery({ queryKey: ['offerings'], queryFn: () => apiFetch<OfferingsResponse>('/billing/offerings', getToken) });
  const balance = query.data?.balance ?? 0;
  const ledger = query.data?.ledger ?? [];
  const configured = offeringsQuery.data?.configured ?? false;
  const offerings = offeringsQuery.data?.offerings ?? [];

  const checkout = useMutation({
    mutationFn: (offeringId: string) => apiFetch<{ url: string }>('/billing/checkout', getToken, { method: 'POST', body: JSON.stringify({ offeringId }) }),
    onSuccess: (data) => {
      window.location.href = data.url; // to Lemon Squeezy hosted checkout
    },
  });

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Account" title="Billing & credits" description="Credits are spent on research, unlocking winners, listing, and order fulfillment." />

      <Panel title="Balance" className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-4xl font-semibold text-ink">{balance}</span>
          <span className="text-sm text-ink-muted">credits</span>
        </div>
      </Panel>

      <Panel title="Buy credits & plans" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2">
          {offerings.map((o) => (
            <div key={o.id} className="flex flex-col items-start gap-1 border border-rule p-4">
              <span className="font-medium text-ink">{o.label}</span>
              <span className="text-sm text-ink-muted">{o.price}</span>
              <Button
                variant="primary"
                className="mt-2"
                onClick={() => checkout.mutate(o.id)}
                disabled={!configured || checkout.isPending}
              >
                {checkout.isPending && checkout.variables === o.id ? 'Starting…' : configured ? 'Buy' : 'Coming soon'}
              </Button>
            </div>
          ))}
        </div>
        {!configured && <p className="mt-3 text-xs text-ink-faint">Secure checkout is being set up. You start with trial credits to explore everything.</p>}
        {checkout.isError && <p className="mt-2 text-sm text-brick">{(checkout.error as Error).message}</p>}
      </Panel>

      <Panel title="Usage history">
        {ledger.length === 0 ? (
          <EmptyState>No activity yet.</EmptyState>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <tbody>
                {ledger.map((l) => (
                  <tr key={l.id} className="border-b border-rule last:border-0">
                    <td className="py-2 text-ink">{reasonLabel(l.reason)}</td>
                    <td className={`py-2 text-right tabular-nums ${l.delta >= 0 ? 'text-moss' : 'text-ink-muted'}`}>
                      {l.delta >= 0 ? '+' : ''}
                      {l.delta}
                    </td>
                    <td className="py-2 text-right tabular-nums text-ink-faint">{l.balanceAfter}</td>
                    <td className="py-2 text-right text-xs text-ink-faint">{new Date(l.createdAt).toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
