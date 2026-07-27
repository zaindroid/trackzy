import { useQuery } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type ListingMonitor, type ProductCandidate } from '../lib/api.js';
import { Badge, EmptyState, PageHeader } from '../components/ui.js';

function StatTile({ label, value, tone = 'ink' }: { label: string; value: number; tone?: 'ink' | 'brick' }) {
  return (
    <div className="rounded-xl border border-rule bg-paper-raised p-3.5">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-faint">{label}</div>
      <div className={`mt-1 font-display text-[28px] font-bold leading-none ${tone === 'brick' ? 'text-brick' : 'text-ink'}`}>{value}</div>
    </div>
  );
}

function ResultRow({ imageUrl, title, score }: { imageUrl?: string | null; title: string; score: number }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-rule bg-paper-raised p-2.5">
      <div className="h-8 w-8 shrink-0 overflow-hidden rounded-md border border-rule bg-paper">
        {imageUrl && <img src={imageUrl} alt="" className="h-full w-full object-cover" />}
      </div>
      <span className="min-w-0 flex-1 truncate text-sm text-ink">{title}</span>
      <span className="shrink-0 text-sm font-semibold text-signal">{Math.round(score)}</span>
    </div>
  );
}

export function HomePage() {
  const { getToken } = useAuthToken();

  const monitorsQuery = useQuery({
    queryKey: ['monitors'],
    queryFn: () => apiFetch<{ monitors: ListingMonitor[] }>('/monitor', getToken),
  });
  const candidatesQuery = useQuery({
    queryKey: ['candidates'],
    queryFn: () => apiFetch<{ candidates: ProductCandidate[] }>('/product-research', getToken),
  });

  const isLoading = monitorsQuery.isLoading || candidatesQuery.isLoading;
  const isError = monitorsQuery.isError || candidatesQuery.isError;

  const monitors = monitorsQuery.data?.monitors ?? [];
  const candidates = candidatesQuery.data?.candidates ?? [];

  const activeListings = monitors.filter((m) => m.stockStatus === 'in').length;
  const needsAttention = monitors.filter((m) => m.health === 'critical' || m.health === 'paused' || m.pendingSwitch != null);
  const draftCandidates = candidates.filter((c) => c.status === 'draft');
  const recent = [...candidates]
    .filter((c) => c.status !== 'dismissed')
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, 5);

  const monitorAwaitingSwitch = monitors.find((m) => m.pendingSwitch != null);

  return (
    <div className="max-w-3xl">
      <PageHeader eyebrow="Droparch" title="Overview" description="Everything that needs your attention, at a glance." />

      {isLoading && <EmptyState>Loading your overview…</EmptyState>}
      {isError && <p className="text-sm text-brick">Couldn't load your overview. Try refreshing the page.</p>}

      {!isLoading && !isError && (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatTile label="Active listings" value={activeListings} />
            <StatTile label="Needs attention" value={needsAttention.length} tone={needsAttention.length > 0 ? 'brick' : 'ink'} />
            <StatTile label="Draft candidates" value={draftCandidates.length} />
          </div>

          {monitorAwaitingSwitch && (
            <div className="mb-4 flex items-center justify-between gap-3 rounded-xl border border-ochre/40 bg-ochre/5 p-3.5">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-ink">Supplier switch awaiting approval</p>
                <p className="mt-0.5 truncate text-xs text-ink-muted">"{monitorAwaitingSwitch.title}" went out of stock — a replacement was found</p>
              </div>
              <NavLink to="/monitors">
                <Badge tone="ochre" className="shrink-0 cursor-pointer px-3 py-1.5 text-xs">
                  Review
                </Badge>
              </NavLink>
            </div>
          )}

          <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-faint">Recent research</div>
          {recent.length === 0 ? (
            <p className="rounded-xl border border-rule bg-paper-raised px-4 py-6 text-center text-sm text-ink-faint">
              No research yet — head to Product research to find your first winners.
            </p>
          ) : (
            <div className="flex flex-col gap-2">
              {recent.map((c) => (
                <ResultRow key={c.id} imageUrl={c.supplierImageUrls[0]} title={c.generatedTitle} score={c.opportunityScore} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
