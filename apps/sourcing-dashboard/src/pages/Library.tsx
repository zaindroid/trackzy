import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type LibraryWinner } from '../lib/api.js';
import { Button, EmptyState, PageHeader } from '../components/ui.js';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  if (!src) return <div className="flex h-16 w-16 shrink-0 items-center justify-center border border-rule bg-paper text-[9px] text-ink-faint">No image</div>;
  return <img src={src} alt={alt} className="h-16 w-16 shrink-0 border border-rule object-cover" />;
}

function WinnerCard({ w }: { w: LibraryWinner }) {
  const { getToken } = useAuthToken();
  const queryClient = useQueryClient();
  const unlock = useMutation({
    mutationFn: () => apiFetch<{ candidateId: string }>(`/library/${w.id}/unlock`, getToken, { method: 'POST' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['library'] });
      queryClient.invalidateQueries({ queryKey: ['credits'] });
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  return (
    <div className="border border-rule bg-paper-raised p-4 shadow-raised">
      <div className="flex gap-3">
        <Thumb src={w.imageUrl} alt={w.productTitle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-ink">{w.productTitle}</p>
            <span className="shrink-0 rounded-sm bg-signal/15 px-2 py-0.5 text-xs font-semibold text-signal">score {Math.round(w.score)}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {w.ebaySoldCount.toLocaleString()} sold · median {money(w.ebayMedianPriceCents)} · margin {money(w.marginCents)} ({w.marginPercent}%)
          </p>
          <div className="mt-3 flex items-center gap-3">
            {w.unlocked ? (
              <span className="text-sm font-medium text-moss">Unlocked — check Research to list it</span>
            ) : (
              <Button variant="primary" onClick={() => unlock.mutate()} disabled={unlock.isPending}>
                {unlock.isPending ? 'Unlocking…' : 'Unlock (1 credit)'}
              </Button>
            )}
            {unlock.isError && <span className="text-sm text-brick">{(unlock.error as Error).message}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function LibraryPage() {
  const { getToken } = useAuthToken();
  const query = useQuery({ queryKey: ['library'], queryFn: () => apiFetch<{ winners: LibraryWinner[] }>('/library', getToken) });
  const winners = query.data?.winners ?? [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Discover"
        title="Winners library"
        description="A growing catalog of proven products — real demand, sourced, and margin-checked. Unlock one to reveal its supplier and drop a ready-to-list draft into Research."
      />
      {query.isLoading && <EmptyState>Loading…</EmptyState>}
      {!query.isLoading && winners.length === 0 && (
        <EmptyState>The library is filling up as products get vetted. Check back soon.</EmptyState>
      )}
      <div className="flex flex-col gap-3">
        {winners.map((w) => (
          <WinnerCard key={w.id} w={w} />
        ))}
      </div>
    </div>
  );
}
