import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type ListingMonitor } from '../lib/api.js';
import { Badge, Button, EmptyState, PageHeader, TextInput } from '../components/ui.js';

function money(cents: number | null): string {
  return cents == null ? '—' : `$${(cents / 100).toFixed(2)}`;
}

const HEALTH_TONE: Record<ListingMonitor['health'], 'moss' | 'ochre' | 'brick' | 'neutral'> = {
  healthy: 'moss',
  warning: 'ochre',
  critical: 'brick',
  paused: 'neutral',
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
  const approveSwitch = useMutation({
    mutationFn: () => apiFetch(`/monitor/${m.candidateId}/switch/approve`, getToken, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const rejectSwitch = useMutation({
    mutationFn: () => apiFetch(`/monitor/${m.candidateId}/switch/reject`, getToken, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const saveRules = () => {
    patch.mutate({ minMarginPercent: Number(minMargin), priceCeilingCents: ceiling ? Math.round(Number(ceiling) * 100) : null });
    setEditing(false);
  };

  return (
    <div className="rounded-2xl border border-rule bg-paper-raised p-4 shadow-raised">
      <div className="flex gap-3">
        {m.imageUrl && <img src={m.imageUrl} alt={m.title} className="h-14 w-14 shrink-0 rounded-lg border border-rule object-cover" />}
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="truncate font-medium text-ink">{m.title}</p>
            <Badge tone={HEALTH_TONE[m.health]} className="shrink-0">{m.health}</Badge>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            price {money(m.currentSellPriceCents)} · cost {money(m.currentSupplierCostCents)} · margin{' '}
            <span className={m.currentMarginPercent != null && m.currentMarginPercent < m.minMarginPercent ? 'text-brick' : 'text-moss'}>
              {m.currentMarginPercent != null ? `${m.currentMarginPercent}%` : '—'}
            </span>{' '}
            · stock <span className={m.stockStatus === 'out' ? 'text-brick' : 'text-ink-muted'}>{m.stockStatus}</span>
          </p>
          {m.lastReason && <p className="mt-1 text-xs italic text-ink-faint">{m.lastReason}</p>}

          {m.pendingSwitch && (
            <div className="mt-3 rounded-xl border border-ochre/40 bg-ochre/5 p-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-ochre">Out of stock — approve a replacement supplier?</p>
              <p className="mt-1 text-xs text-ink-muted">
                We paused this listing and found a possible replacement. Approve only if it's the <span className="font-medium text-ink">same product</span> — we never switch suppliers automatically.
              </p>
              <div className="mt-2 flex gap-3">
                {m.pendingSwitch.imageUrl && (
                  <img src={m.pendingSwitch.imageUrl} alt={m.pendingSwitch.title ?? 'candidate'} className="h-16 w-16 shrink-0 rounded-lg border border-rule object-cover" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs text-ink">{m.pendingSwitch.title ?? 'Replacement candidate'}</p>
                  <p className="mt-0.5 text-xs text-ink-muted">new cost {money(m.pendingSwitch.costCents)}</p>
                  {m.pendingSwitch.url && (
                    <a href={m.pendingSwitch.url} target="_blank" rel="noreferrer" className="text-xs text-moss underline hover:text-ink">
                      View on supplier ↗
                    </a>
                  )}
                </div>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <Button variant="primary" onClick={() => approveSwitch.mutate()} disabled={approveSwitch.isPending || rejectSwitch.isPending}>
                  {approveSwitch.isPending ? 'Approving…' : 'Approve & relist'}
                </Button>
                <Button variant="secondary" onClick={() => rejectSwitch.mutate()} disabled={approveSwitch.isPending || rejectSwitch.isPending}>
                  {rejectSwitch.isPending ? 'Dismissing…' : 'Keep paused'}
                </Button>
              </div>
            </div>
          )}

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
        description="Every listing you publish is auto-monitored: we re-check the supplier's live cost and stock, hold your margin floor, price competitively, and pause anything that can't be sold profitably. On a stock-out we pause the listing and surface a replacement supplier for your one-click approval — never switching automatically, so you're never shipping the wrong product."
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
