import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type CreditsResponse } from '../lib/api.js';
import { EmptyState, PageHeader, Panel } from '../components/ui.js';

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

// Placeholder credit packs — real checkout wires to Lemon Squeezy once the
// account is set up (see the monetization plan). For now "Buy" is disabled.
const PACKS = [
  { credits: 50, price: '$9' },
  { credits: 200, price: '$29' },
  { credits: 600, price: '$69' },
];

export function BillingPage() {
  const { getToken } = useAuthToken();
  const query = useQuery({ queryKey: ['credits'], queryFn: () => apiFetch<CreditsResponse>('/credits', getToken) });
  const balance = query.data?.balance ?? 0;
  const ledger = query.data?.ledger ?? [];

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Account" title="Billing & credits" description="Credits are spent on research, unlocking winners, listing, and order fulfillment." />

      <Panel title="Balance" className="mb-4">
        <div className="flex items-baseline gap-2">
          <span className="font-display text-4xl font-semibold text-ink">{balance}</span>
          <span className="text-sm text-ink-muted">credits</span>
        </div>
      </Panel>

      <Panel title="Buy more credits" className="mb-4">
        <div className="grid gap-3 sm:grid-cols-3">
          {PACKS.map((p) => (
            <div key={p.credits} className="flex flex-col items-center gap-1 border border-rule p-4">
              <span className="font-display text-2xl font-semibold text-ink">{p.credits}</span>
              <span className="text-xs text-ink-muted">credits</span>
              <span className="mt-1 text-sm text-ink">{p.price}</span>
              <button type="button" disabled className="mt-2 cursor-not-allowed rounded-sm bg-paper px-3 py-1 text-xs text-ink-faint" title="Checkout coming soon">
                Coming soon
              </button>
            </div>
          ))}
        </div>
        <p className="mt-3 text-xs text-ink-faint">Secure checkout is being set up. You start with trial credits to explore everything.</p>
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
