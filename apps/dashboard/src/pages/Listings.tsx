import { Fragment, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type Listing, type Supplier } from '../lib/api.js';
import { Button, EmptyState, PageHeader } from '../components/ui.js';

interface MatchCandidate {
  supplierId: string;
  supplierName: string;
  supplierProductId: string;
  title: string;
  sku: string;
  costCents: number;
  score: number;
  imageUrl?: string;
  productUrl?: string;
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ProductThumb({ src, alt }: { src?: string | null; alt: string }) {
  if (!src) {
    return <div className="flex h-10 w-10 shrink-0 items-center justify-center border border-rule bg-paper text-[9px] text-ink-faint">No image</div>;
  }
  return <img src={src} alt={alt} className="h-10 w-10 shrink-0 border border-rule object-cover" />;
}

function CandidateCard({ candidate, selected, onSelect }: { candidate: MatchCandidate; selected: boolean; onSelect: () => void }) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && onSelect()}
      className={`flex w-full cursor-pointer items-center gap-3 border p-2 text-left text-sm transition-colors ${
        selected ? 'border-signal bg-signal/5' : 'border-rule hover:bg-paper'
      }`}
    >
      <ProductThumb src={candidate.imageUrl} alt={candidate.title} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-ink">{candidate.title}</div>
        <div className="text-xs text-ink-muted">
          {candidate.supplierName} · {money(candidate.costCents)} · {Math.round(candidate.score * 100)}% match
        </div>
      </div>
      {candidate.productUrl && (
        <a
          href={candidate.productUrl}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 text-xs text-signal underline hover:no-underline"
        >
          View ↗
        </a>
      )}
    </div>
  );
}

function ResolveRow({ listing, colSpan, onDone }: { listing: Listing; colSpan: number; onDone: () => void }) {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const [selectedKey, setSelectedKey] = useState('');

  const candidatesQuery = useQuery({
    queryKey: ['listingCandidates', listing.id],
    queryFn: () => apiFetch<{ candidates: MatchCandidate[] }>(`/listings/${listing.id}/candidates`, token),
  });

  const applyMatch = useMutation({
    mutationFn: (
      choice: { supplierId: string; supplierProductId: string; title?: string; imageUrl?: string; productUrl?: string } | { supplierId: null },
    ) => apiFetch(`/listings/${listing.id}/match`, token, { method: 'POST', body: JSON.stringify(choice) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['listings'] });
      onDone();
    },
  });

  const candidates = candidatesQuery.data?.candidates ?? [];
  const selected = candidates.find((c) => `${c.supplierId}:${c.supplierProductId}` === selectedKey);

  return (
    <tr>
      <td colSpan={colSpan} className="bg-paper px-4 py-3">
        {candidatesQuery.isLoading && <p className="text-sm text-ink-muted">Searching connected suppliers…</p>}
        {candidatesQuery.isSuccess && candidates.length === 0 && (
          <p className="text-sm text-ink-muted">No candidate products found from your connected suppliers.</p>
        )}
        {candidates.length > 0 && (
          <div className="flex flex-col gap-2 sm:max-w-xl">
            {candidates.map((c) => (
              <CandidateCard
                key={`${c.supplierId}:${c.supplierProductId}`}
                candidate={c}
                selected={selectedKey === `${c.supplierId}:${c.supplierProductId}`}
                onSelect={() => setSelectedKey(`${c.supplierId}:${c.supplierProductId}`)}
              />
            ))}
          </div>
        )}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          {candidates.length > 0 && (
            <Button
              variant="primary"
              disabled={!selected || applyMatch.isPending}
              onClick={() =>
                selected &&
                applyMatch.mutate({
                  supplierId: selected.supplierId,
                  supplierProductId: selected.supplierProductId,
                  title: selected.title,
                  imageUrl: selected.imageUrl,
                  productUrl: selected.productUrl,
                })
              }
            >
              Confirm match
            </Button>
          )}
          <button
            type="button"
            className="text-sm text-ink-muted underline hover:text-ink"
            onClick={() => applyMatch.mutate({ supplierId: null })}
            disabled={applyMatch.isPending}
          >
            Don't match — leave unmatched
          </button>
          <button type="button" className="text-sm text-ink-muted underline hover:text-ink" onClick={onDone}>
            Cancel
          </button>
        </div>
        {applyMatch.isError && <p className="mt-2 text-sm text-brick">{(applyMatch.error as Error).message}</p>}
      </td>
    </tr>
  );
}

export function ListingsPage() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  const listingsQuery = useQuery({
    queryKey: ['listings'],
    queryFn: () => apiFetch<{ listings: Listing[] }>('/listings', token),
  });
  const suppliersQuery = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => apiFetch<{ suppliers: Supplier[] }>('/suppliers', token),
  });

  const sync = useMutation({
    mutationFn: () => apiFetch('/listings/sync', token, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['listings'] }),
  });

  const supplierName = (supplierId: string | null) =>
    supplierId ? (suppliersQuery.data?.suppliers.find((s) => s.id === supplierId)?.name ?? supplierId) : null;

  const COLUMN_COUNT = 5;

  return (
    <div>
      <PageHeader
        eyebrow="Catalog"
        title="Listings"
        description="Everything synced in from your connected storefronts, and which supplier product each one is matched to."
        actions={
          <Button variant="secondary" onClick={() => sync.mutate()} disabled={sync.isPending}>
            {sync.isPending ? 'Syncing…' : 'Sync now'}
          </Button>
        }
      />
      {sync.isError && <p className="mb-4 text-sm text-brick">{(sync.error as Error).message}</p>}

      <div className="border border-rule bg-paper-raised shadow-raised">
        <table className="manifest">
          <thead className="border-b border-rule text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-medium">Your listing</th>
              <th className="px-4 py-2.5 font-medium">Price / Qty</th>
              <th className="px-4 py-2.5 font-medium">Matched supplier product</th>
              <th className="px-4 py-2.5 font-medium">Match</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {listingsQuery.data?.listings.map((l) => (
              <Fragment key={l.id}>
                <tr className="md:hover:bg-paper">
                  <td data-label="Your listing" className="md:px-4 md:py-2.5">
                    <div className="font-medium text-ink">{l.title}</div>
                    <div className="font-mono text-xs text-ink-muted">{l.sku}</div>
                  </td>
                  <td data-label="Price / Qty" className="md:px-4 md:py-2.5">
                    {money(l.priceCents)} · qty {l.quantityAvailable}
                  </td>
                  <td data-label="Matched supplier product" className="md:px-4 md:py-2.5">
                    {l.supplierId ? (
                      <div className="flex items-center gap-2">
                        <ProductThumb src={l.matchedProductImageUrl} alt={l.matchedProductTitle ?? ''} />
                        <div className="min-w-0">
                          <div className="truncate text-sm text-ink">{l.matchedProductTitle ?? '(no product detail saved)'}</div>
                          <div className="text-xs text-ink-muted">
                            {supplierName(l.supplierId)}
                            {l.matchedProductUrl && (
                              <>
                                {' · '}
                                <a href={l.matchedProductUrl} target="_blank" rel="noreferrer" className="text-signal underline hover:no-underline">
                                  View ↗
                                </a>
                              </>
                            )}
                          </div>
                        </div>
                      </div>
                    ) : l.matchSource === 'manual' ? (
                      <span className="text-ink-faint">No match (reviewed)</span>
                    ) : (
                      <span className="text-ink-faint">Unmatched</span>
                    )}
                  </td>
                  <td data-label="Match" className="md:px-4 md:py-2.5">
                    {l.matchConfidence !== null && l.supplierId ? `${Math.round(l.matchConfidence * 100)}% (${l.matchSource})` : '—'}
                    {!l.supplierId && (
                      <button
                        type="button"
                        className="ml-2 text-sm text-signal underline hover:no-underline"
                        onClick={() => setResolvingId(resolvingId === l.id ? null : l.id)}
                      >
                        {resolvingId === l.id ? 'Close' : l.matchSource === 'manual' ? 'Find matches' : 'Resolve'}
                      </button>
                    )}
                  </td>
                  <td data-label="Status" className="text-ink-muted md:px-4 md:py-2.5">
                    {l.status}
                  </td>
                </tr>
                {resolvingId === l.id && <ResolveRow listing={l} colSpan={COLUMN_COUNT} onDone={() => setResolvingId(null)} />}
              </Fragment>
            ))}
          </tbody>
        </table>
        {listingsQuery.data?.listings.length === 0 && (
          <EmptyState>
            No listings synced yet. Connect eBay on the Connections page, or click "Sync now" above if you already have.
          </EmptyState>
        )}
      </div>
    </div>
  );
}
