import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type LibraryResponse, type LibraryWinner } from '../lib/api.js';
import { Button, EmptyState, PageHeader, Panel } from '../components/ui.js';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Thumb({ src, blurred, alt }: { src: string | null; blurred: boolean; alt: string }) {
  if (!src) return <div className="flex h-16 w-16 shrink-0 items-center justify-center border border-rule bg-paper text-[9px] text-ink-faint">Locked</div>;
  return (
    <div className="relative h-16 w-16 shrink-0 overflow-hidden border border-rule">
      {/* Locked teasers are heavily blurred + scaled so the product can't be identified or reverse-searched at a glance. */}
      <img src={src} alt={alt} className="h-full w-full object-cover" style={blurred ? { filter: 'blur(10px)', transform: 'scale(1.3)' } : undefined} />
      {blurred && <div className="absolute inset-0 flex items-center justify-center text-lg">🔒</div>}
    </div>
  );
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
        <Thumb src={w.imageUrl} blurred={w.blurred} alt={w.productTitle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`font-medium ${w.unlocked ? 'text-ink' : 'text-ink-muted'}`}>{w.productTitle}</p>
            <span className="shrink-0 rounded-sm bg-ochre/20 px-2 py-0.5 text-xs font-semibold text-ochre">score {Math.round(w.score)}</span>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            {w.ebaySoldCount.toLocaleString()} sold · median {money(w.ebayMedianPriceCents)} · margin {money(w.marginCents)} ({w.marginPercent}%)
          </p>
          <div className="mt-3 flex items-center gap-3">
            {w.unlocked ? (
              <span className="text-sm font-medium text-moss">Unlocked — list it from Research</span>
            ) : (
              <Button variant="primary" onClick={() => unlock.mutate()} disabled={unlock.isPending}>
                {unlock.isPending ? 'Revealing…' : 'Unlock to reveal (1 credit)'}
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
  const query = useQuery({ queryKey: ['library'], queryFn: () => apiFetch<LibraryResponse>('/library', getToken) });
  const access = query.data?.access ?? false;
  const winners = query.data?.winners ?? [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Pro"
        title="Golden Products"
        description="A hand-vetted vault of the highest-scoring products — proven demand, sourced, margin-checked. Unlock one to reveal its supplier and drop a ready-to-list draft into Research."
      />

      {!query.isLoading && !access && (
        <Panel title="Pro members only">
          <p className="text-sm text-ink-muted">
            Golden Products is exclusive to Pro subscribers — the top vetted winners, ready to unlock. Upgrade to get in.
          </p>
          <NavLink to="/billing" className="mt-3 inline-block">
            <Button variant="primary">Go Pro</Button>
          </NavLink>
        </Panel>
      )}

      {access && (
        <>
          {winners.length === 0 && <EmptyState>The vault is filling as products get vetted. Check back soon.</EmptyState>}
          <div className="flex flex-col gap-3">
            {winners.map((w) => (
              <WinnerCard key={w.id} w={w} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
