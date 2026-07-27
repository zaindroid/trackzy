import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type LeaderboardWinner } from '../lib/api.js';
import { EmptyState, PageHeader } from '../components/ui.js';

type Metric = 'score' | 'ebaySoldCount' | 'marginCents' | 'timesUnlocked';

const METRICS: { key: Metric; label: string; format: (w: LeaderboardWinner) => string }[] = [
  { key: 'score', label: 'Opportunity', format: (w) => String(Math.round(w.score)) },
  { key: 'ebaySoldCount', label: 'Demand', format: (w) => `${w.ebaySoldCount.toLocaleString()} sold` },
  { key: 'marginCents', label: 'Margin', format: (w) => `$${(w.marginCents / 100).toFixed(2)} (${w.marginPercent}%)` },
  { key: 'timesUnlocked', label: 'Trending', format: (w) => `${w.timesUnlocked} unlocks` },
];

const RANK_COLORS = ['bg-signal', 'bg-moss', 'bg-ochre'];

export function LeaderboardPage() {
  const { getToken } = useAuthToken();
  const [metric, setMetric] = useState<Metric>('score');

  // Poll so the board feels live as winners accumulate / get unlocked.
  const query = useQuery({
    queryKey: ['leaderboard'],
    queryFn: () => apiFetch<{ winners: LeaderboardWinner[] }>('/library/leaderboard', getToken),
    refetchInterval: 20_000,
  });
  const all = query.data?.winners ?? [];

  const ranked = useMemo(() => [...all].sort((a, b) => (b[metric] as number) - (a[metric] as number)).slice(0, 20), [all, metric]);
  const max = ranked.length ? (ranked[0]![metric] as number) || 1 : 1;
  const fmt = METRICS.find((m) => m.key === metric)!.format;

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Discover"
        title="Leaderboard"
        description="The hottest vetted products right now — updating live as the engine finds and sellers unlock them."
      />

      <div className="mb-4 flex flex-wrap gap-1 border-b border-rule">
        {METRICS.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMetric(m.key)}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${metric === m.key ? 'border-signal text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            {m.label}
          </button>
        ))}
      </div>

      {query.isLoading && <EmptyState>Loading…</EmptyState>}
      {!query.isLoading && ranked.length === 0 && <EmptyState>No products ranked yet — run some research to fill the board.</EmptyState>}

      <div className="flex flex-col gap-1.5">
        {ranked.map((w, i) => {
          const value = w[metric] as number;
          const pct = Math.max(4, Math.round((value / max) * 100));
          return (
            <div key={w.id} className="flex items-center gap-3">
              <span className={`w-6 shrink-0 text-right font-display text-sm font-semibold ${i < 3 ? 'text-ink' : 'text-ink-faint'}`}>{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-sm text-ink">
                    {w.productTitle}
                    {w.isNew && <span className="ml-2 rounded-sm bg-moss/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-moss">New</span>}
                  </span>
                  <span className="shrink-0 text-xs tabular-nums text-ink-muted">{fmt(w)}</span>
                </div>
                <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-paper">
                  <div className={`h-full rounded-full ${RANK_COLORS[i] ?? 'bg-rule'} transition-all duration-700`} style={{ width: `${pct}%` }} />
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
