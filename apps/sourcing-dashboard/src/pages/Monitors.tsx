import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type ListingMonitor } from '../lib/api.js';
import { Button, EmptyState, PageHeader, TextInput } from '../components/ui.js';

function money(cents: number | null): string {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
}

const HEALTH_TONE: Record<ListingMonitor['health'], string> = {
  healthy: 'bg-moss/15 text-moss',
  warning: 'bg-ochre/20 text-ochre',
  critical: 'bg-brick/15 text-brick',
  paused: 'bg-paper text-ink-faint',
};

/** Tiny inline margin-trend sparkline, colored by direction. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="h-6 w-16" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 64;
  const h = 24;
  const d = points.map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / range) * h}`).join(' ');
  const trend = points[points.length - 1]! >= points[0]! ? 'text-moss' : 'text-brick';
  return (
    <svg width={w} height={h} className={`shrink-0 ${trend}`} aria-hidden>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function MonitorCard({ m }: { m: ListingMonitor }) {
  const { getToken } = useAuthToken();
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [minMargin, setMinMargin] = useState(String(m.minMarginPercent));
  const [ceiling, setCeiling] = useState(m.priceCeilingCents != null ? String(m.priceCeilingCents / 100) : '');

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['monitors'] });

  const patch = useMutation({
    mutationFn: (body: Record<string, unknown>) => apiFetch(`/monitor/${m.candidateId}`, getToken, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: invalidate,
  });
  const checkNow = useMutation({
    mutationFn: () => apiFetch(`/monitor/${m.candidateId}/check`, getToken, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const saveRules = () => {
    patch.mutate({ minMarginPercent: Number(minMargin), priceCeilingCents: ceiling ? Math.round(Number(ceiling) * 100) : null });
    setEditing(false);
  };

  return (
    <div className="border border-rule bg-paper-raised p-4 shadow-raised">
      <div className="flex gap-3">
        {m.imageUrl && <img src={m.imageUrl} alt={m.title} className="h-14 w-14 shrink-0 border border-rule object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium text-ink">{m.title}</p>
            <span className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-semibold capitalize ${HEALTH_TONE[m.health]}`}>{m.health}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            price {money(m.currentSellPriceCents)} · cost {money(m.currentSupplierCostCents)} · margin{' '}
            <span className={m.currentMarginPercent != null && m.currentMarginPercent < m.minMarginPercent ? 'text-brick' : 'text-moss'}>
              {m.currentMarginPercent != null ? `${m.currentMarginPercent}%` : '—'}
            </span>{' '}
            · stock <span className={m.stockStatus === 'out' ? 'text-brick' : 'text-ink-muted'}>{m.stockStatus}</span>
          </p>
          {m.lastReason && <p className="mt-1 text-xs italic text-ink-faint">{m.lastReason}</p>}

          <div className="mt-2 flex flex-wrap items-center gap-3">
            <Sparkline points={m.marginSpark} />
            <Button variant="secondary" onClick={() => checkNow.mutate()} disabled={checkNow.isPending}>
              {checkNow.isPending ? 'Checking…' : 'Check now'}
            </Button>
            <button type="button" className="text-xs text-ink-muted underline hover:text-ink" onClick={() => setEditing((v) => !v)}>
              {editing ? 'Cancel' : 'Rules'}
            </button>
            <label className="ml-auto flex items-center gap-1.5 text-xs text-ink-muted">
              <input type="checkbox" checked={m.enabled} onChange={(e) => patch.mutate({ enabled: e.target.checked })} />
              Auto-manage
            </label>
          </div>

          {editing && (
            <div className="mt-3 flex flex-wrap items-end gap-3 border-t border-rule pt-3">
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Min margin %
                <TextInput className="w-20" value={minMargin} onChange={(e) => setMinMargin(e.target.value)} />
              </label>
              <label className="flex flex-col gap-1 text-xs text-ink-muted">
                Price ceiling $ (optional)
                <TextInput className="w-24" value={ceiling} onChange={(e) => setCeiling(e.target.value)} placeholder="none" />
              </label>
              <Button variant="primary" onClick={saveRules} disabled={patch.isPending}>
                Save
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function MonitorsPage() {
  const { getToken } = useAuthToken();
  const query = useQuery({ queryKey: ['monitors'], queryFn: () => apiFetch<{ monitors: ListingMonitor[] }>('/monitor', getToken) });
  const monitors = query.data?.monitors ?? [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Sell & fulfill"
        title="Price & stock monitor"
        description="Every listing you publish is auto-monitored: we re-check the supplier's live cost and stock, hold your margin floor, price competitively, auto-switch suppliers on a stock-out, and pause anything that can't be sold profitably — so your store never quietly bleeds money."
      />
      {!query.isLoading && monitors.length === 0 && <EmptyState>No monitored listings yet — list a product from Research and it's enrolled automatically.</EmptyState>}
      <div className="flex flex-col gap-3">
        {monitors.map((m) => (
          <MonitorCard key={m.candidateId} m={m} />
        ))}
      </div>
    </div>
  );
}
