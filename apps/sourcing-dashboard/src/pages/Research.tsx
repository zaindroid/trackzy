import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type ConnectionStatus, type ProductCandidate, type SourcingProvider } from '../lib/api.js';
import { Button, EmptyState, PageHeader, Select, TextInput } from '../components/ui.js';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Thumb({ src, alt }: { src?: string; alt: string }) {
  if (!src) return <div className="flex h-16 w-16 shrink-0 items-center justify-center border border-rule bg-paper text-[9px] text-ink-faint">No image</div>;
  return <img src={src} alt={alt} className="h-16 w-16 shrink-0 border border-rule object-cover" />;
}

function CandidateCard({ candidate }: { candidate: ProductCandidate }) {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['candidates'] });

  const list = useMutation({
    mutationFn: () => apiFetch<{ ebayItemId: string }>(`/candidates/${candidate.id}/list`, token, { method: 'POST' }),
    onSuccess: invalidate,
  });
  const dismiss = useMutation({
    mutationFn: () => apiFetch(`/candidates/${candidate.id}/dismiss`, token, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const feeCents = Math.round(candidate.suggestedSellPriceCents * 0.1325);

  return (
    <div className="border border-rule bg-paper-raised p-4 shadow-raised">
      <div className="flex gap-3">
        <Thumb src={candidate.supplierImageUrls[0]} alt={candidate.generatedTitle} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-ink">{candidate.generatedTitle}</p>
            <span
              className={`shrink-0 rounded-sm px-2 py-0.5 text-xs font-semibold ${
                candidate.marginCents > 0 ? 'bg-moss/15 text-moss' : 'bg-brick/15 text-brick'
              }`}
            >
              {money(candidate.marginCents)} profit
            </span>
          </div>
          <p className="mt-0.5 text-xs text-ink-muted">
            eBay sold: {candidate.ebaySoldCount} · median {money(candidate.ebayMedianPriceCents)} · opportunity {candidate.opportunityScore}/100
          </p>

          <div className="mt-2 rounded-sm bg-paper p-2 text-xs text-ink-muted">
            <div className="flex justify-between">
              <span>List price</span>
              <span className="text-ink">{money(candidate.suggestedSellPriceCents)}</span>
            </div>
            <div className="flex justify-between">
              <span>Supplier cost</span>
              <span>−{money(candidate.supplierCostCents)}</span>
            </div>
            <div className="flex justify-between">
              <span>eBay fee (~13.25%)</span>
              <span>−{money(feeCents)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-rule pt-1 font-medium text-ink">
              <span>Profit ({candidate.marginPercent}%)</span>
              <span>{money(candidate.marginCents)}</span>
            </div>
          </div>

          {candidate.supplierProductUrl && (
            <a href={candidate.supplierProductUrl} target="_blank" rel="noreferrer" className="mt-2 inline-block text-xs text-signal underline hover:no-underline">
              View supplier product ↗
            </a>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-3">
            {candidate.status === 'draft' && (
              <>
                <Button variant="primary" onClick={() => list.mutate()} disabled={list.isPending}>
                  {list.isPending ? 'Listing…' : 'List on eBay — one click'}
                </Button>
                <button type="button" className="text-sm text-ink-muted underline hover:text-ink" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
                  Dismiss
                </button>
              </>
            )}
            {candidate.status === 'listed' && (
              <span className="text-sm text-moss">✓ Listed on eBay ({candidate.ebayItemId})</span>
            )}
            {candidate.status === 'dismissed' && <span className="text-sm text-ink-faint">Dismissed</span>}
            {list.isError && <span className="text-sm text-brick">{(list.error as Error).message}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResearchPage() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const [seed, setSeed] = useState('');
  const [supplier, setSupplier] = useState<SourcingProvider>('aliexpress');

  const statusQuery = useQuery({
    queryKey: ['connectionStatus'],
    queryFn: () => apiFetch<ConnectionStatus>('/connections/status', token),
  });
  const cjConnected = statusQuery.data?.cjConnected ?? false;

  const candidatesQuery = useQuery({
    queryKey: ['candidates'],
    queryFn: () => apiFetch<{ candidates: ProductCandidate[] }>('/product-research', token),
  });

  const research = useMutation({
    mutationFn: () => apiFetch<{ candidates: ProductCandidate[] }>('/product-research/research', token, { method: 'POST', body: JSON.stringify({ seed, supplier }) }),
    onSuccess: () => {
      setSeed('');
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  const candidates = candidatesQuery.data?.candidates ?? [];

  return (
    <div className="max-w-3xl">
      <PageHeader
        eyebrow="Discover"
        title="Product research"
        description="Enter a niche. The bot finds what's really selling on eBay, sources it from your supplier, computes the margin, and writes the listing — you just approve."
      />

      <div className="mb-6 border border-rule bg-paper-raised p-4 shadow-raised">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TextInput value={seed} onChange={(e) => setSeed(e.target.value)} placeholder="e.g. silk eye mask" className="sm:w-64" />
          <Select value={supplier} onChange={(e) => setSupplier(e.target.value as SourcingProvider)} className="sm:w-44">
            <option value="aliexpress">AliExpress</option>
            <option value="cj" disabled={!cjConnected}>
              CJ Dropshipping{cjConnected ? '' : ' (connect first)'}
            </option>
          </Select>
          <Button variant="primary" onClick={() => research.mutate()} disabled={research.isPending || !seed}>
            {research.isPending ? 'Researching…' : 'Research products'}
          </Button>
        </div>
        {research.isError && <p className="mt-2 text-sm text-brick">{(research.error as Error).message}</p>}
        <p className="mt-2 text-xs text-ink-faint">Uses real confirmed-sold eBay data. May take a moment while it checks several niches and your supplier.</p>
      </div>

      <div className="flex flex-col gap-3">
        {candidates.map((c) => (
          <CandidateCard key={c.id} candidate={c} />
        ))}
      </div>
      {candidates.length === 0 && <EmptyState>No products yet — research a niche above to get started.</EmptyState>}
    </div>
  );
}
