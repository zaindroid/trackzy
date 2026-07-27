import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { NavLink } from 'react-router-dom';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type LibraryResponse, type LibraryWinner } from '../lib/api.js';
import { Badge, Button, EmptyState, PageHeader, Panel } from '../components/ui.js';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Thumb({ src, blurred, alt }: { src: string | null; blurred: boolean; alt: string }) {
  if (!src) return <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-rule bg-paper text-[9px] text-ink-faint">Locked</div>;
  return (
    <div className="group relative h-16 w-16 shrink-0 overflow-hidden rounded-lg border border-rule">
      {/* Full blur at rest so the product can't be identified or reverse-searched;
          softens to a light haze on hover/tap-hold as a "peek" — never a full reveal. */}
      <img
        src={src}
        alt={alt}
        className="h-full w-full object-cover transition-[filter] duration-200"
        style={blurred ? { filter: 'blur(10px)', transform: 'scale(1.3)' } : undefined}
      />
      {blurred && (
        <>
          <img
            src={src}
            alt=""
            aria-hidden
            className="absolute inset-0 h-full w-full scale-[1.3] object-cover opacity-0 blur-[3px] transition-opacity duration-200 group-hover:opacity-100 group-active:opacity-100"
          />
          <span className="absolute bottom-1 left-1 rounded-md bg-ink px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-paper">Pro</span>
        </>
      )}
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
    <div className="rounded-2xl border border-rule bg-paper-raised p-4 shadow-raised">
      <div className="flex gap-3">
        <Thumb src={w.imageUrl} blurred={w.blurred} alt={w.productTitle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className={`font-medium ${w.unlocked ? 'text-ink' : 'text-ink-muted'}`}>{w.productTitle}</p>
            <Badge tone="ochre" className="shrink-0">score {Math.round(w.score)}</Badge>
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
