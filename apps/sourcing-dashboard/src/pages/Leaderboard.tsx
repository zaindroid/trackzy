import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type LeaderboardWinner } from '../lib/api.js';
import { EmptyState, PageHeader } from '../components/ui.js';

type Metric = 'score' | 'ebaySoldCount' | 'marginCents' | 'timesUnlocked';

const METRICS: { key: Metric; label: string; format: (w: LeaderboardWinner) => string }[] = [
  { key: 'score', label: 'Opportunity', format: (w) => String(Math.round(w.score)) },
  { key: 'ebaySoldCount', label: 'Demand', format: (w) => w.ebaySoldCount.toLocaleString() },
  { key: 'marginCents', label: 'Margin', format: (w) => `$${(w.marginCents / 100).toFixed(0)}` },
  { key: 'timesUnlocked', label: 'Trending', format: (w) => String(w.timesUnlocked) },
];

const RANK_COLORS = ['bg-signal', 'bg-moss', 'bg-ochre'];

/** Tiny inline sparkline of a winner's recent daily scores. */
function Sparkline({ points }: { points: number[] }) {
  if (points.length < 2) return <div className="h-6 w-16" />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const range = max - min || 1;
  const w = 64;
  const h = 24;
  const d = points
    .map((p, i) => `${(i / (points.length - 1)) * w},${h - ((p - min) / range) * h}`)
    .join(' ');
  return (
    <svg width={w} height={h} className="shrink-0" aria-hidden>
      <polyline points={d} fill="none" stroke="currentColor" strokeWidth="1.5" className="text-ink-muted" />
    </svg>
  );
}

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

      <div className="flex flex-col gap-2">
        {ranked.map((w, i) => {
          const value = w[metric] as number;
          const pct = Math.max(4, Math.round((value / max) * 100));
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : null;
          return (
            <div key={w.id} className="flex items-center gap-3 rounded-md border border-rule bg-paper-raised p-2.5">
              <span className="w-7 shrink-0 text-center font-display text-lg font-bold tabular-nums text-ink-faint">{medal ?? i + 1}</span>
              {/* Blurred teaser thumbnail — identity hidden; unlock in Golden Products. */}
              <div className="h-12 w-12 shrink-0 overflow-hidden rounded border border-rule bg-paper">
                {w.imageUrl && <img src={w.imageUrl} alt="" className="h-full w-full object-cover" style={{ filter: 'blur(8px)', transform: 'scale(1.3)' }} />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm text-ink-muted">{w.productTitle}</span>
                  {w.isNew && <span className="shrink-0 rounded-sm bg-moss/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-moss">New</span>}
                </div>
                <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-paper">
                  <div className={`h-full rounded-full ${RANK_COLORS[i] ?? 'bg-rule'} transition-all duration-700`} style={{ width: `${pct}%` }} />
                </div>
              </div>
              {metric === 'score' && <Sparkline points={w.spark} />}
              <div className="flex shrink-0 flex-col items-end">
                <span className="font-display text-lg font-bold tabular-nums text-ink">{fmt(w)}</span>
                {metric === 'score' && w.scoreDelta !== 0 && (
                  <span className={`text-[10px] font-semibold tabular-nums ${w.scoreDelta > 0 ? 'text-moss' : 'text-brick'}`}>
                    {w.scoreDelta > 0 ? '▲' : '▼'} {Math.abs(w.scoreDelta)}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
