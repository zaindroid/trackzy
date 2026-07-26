import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type ConnectionStatus, type ProductCandidate, type SourcingProvider } from '../lib/api.js';
import { Button, EmptyState, PageHeader, Select, TextInput } from '../components/ui.js';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function Thumb({ src, alt, px = 64 }: { src?: string; alt: string; px?: number }) {
  const style = { width: px, height: px };
  if (!src)
    return (
      <div style={style} className="flex shrink-0 items-center justify-center border border-rule bg-paper text-[9px] text-ink-faint">
        No image
      </div>
    );
  return <img src={src} alt={alt} style={style} className="shrink-0 border border-rule object-cover" />;
}

const EBAY_FEE_RATE = 0.1325;

/**
 * The review-before-publish modal. The listing goes live on the seller's real
 * eBay store, so nothing is published until they've seen (and can edit) the
 * exact title, price, description, and images. Confirm saves any edits (PATCH)
 * then publishes (POST /list) in one shot.
 */
function ReviewModal({ candidate, onClose }: { candidate: ProductCandidate; onClose: () => void }) {
  const { getToken } = useAuthToken();
  const queryClient = useQueryClient();
  const [title, setTitle] = useState(candidate.generatedTitle);
  const [price, setPrice] = useState((candidate.suggestedSellPriceCents / 100).toFixed(2));
  const [description, setDescription] = useState(candidate.generatedDescription);

  const priceCents = Math.round(Number(price) * 100) || 0;
  const feeCents = Math.round(priceCents * EBAY_FEE_RATE);
  const profitCents = priceCents - candidate.supplierCostCents - feeCents;
  const priceValid = priceCents > 0 && title.trim().length > 0;

  const publish = useMutation({
    mutationFn: async () => {
      // Persist edits first (only the fields the API accepts), then publish.
      await apiFetch(`/candidates/${candidate.id}`, getToken, {
        method: 'PATCH',
        body: JSON.stringify({ generatedTitle: title, generatedDescription: description, suggestedSellPriceCents: priceCents }),
      });
      return apiFetch<{ ebayItemId: string }>(`/candidates/${candidate.id}/list`, getToken, { method: 'POST' });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
      onClose();
    },
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/60 p-4 sm:p-8" onClick={onClose}>
      <div className="w-full max-w-2xl border border-rule bg-paper-raised shadow-raised" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-rule px-4 py-3">
          <h2 className="font-semibold text-ink">Review before publishing to eBay</h2>
          <button type="button" className="text-ink-muted hover:text-ink" onClick={onClose} aria-label="Close">✕</button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto p-4">
          <div className="mb-3 flex gap-2 overflow-x-auto">
            {candidate.supplierImageUrls.length > 0 ? (
              candidate.supplierImageUrls.map((u, i) => <Thumb key={i} src={u} alt={`${title} ${i + 1}`} px={96} />)
            ) : (
              <Thumb alt="no image" px={96} />
            )}
          </div>

          <label className="mb-1 block text-xs font-medium text-ink-muted">Title <span className="text-ink-faint">({title.length}/80)</span></label>
          <TextInput value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} className="w-full" />

          <label className="mb-1 mt-3 block text-xs font-medium text-ink-muted">List price (USD)</label>
          <TextInput value={price} inputMode="decimal" onChange={(e) => setPrice(e.target.value)} className="w-40" />

          <label className="mb-1 mt-3 block text-xs font-medium text-ink-muted">Description</label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={5}
            className="w-full border border-rule bg-paper p-2 text-sm text-ink outline-none focus:border-signal"
          />

          <div className="mt-3 rounded-sm bg-paper p-2 text-xs text-ink-muted">
            <div className="flex justify-between"><span>List price</span><span className="text-ink">{money(priceCents)}</span></div>
            <div className="flex justify-between"><span>Supplier cost</span><span>−{money(candidate.supplierCostCents)}</span></div>
            <div className="flex justify-between"><span>eBay fee (~13.25%)</span><span>−{money(feeCents)}</span></div>
            <div className={`mt-1 flex justify-between border-t border-rule pt-1 font-medium ${profitCents > 0 ? 'text-moss' : 'text-brick'}`}>
              <span>Profit</span><span>{money(profitCents)}</span>
            </div>
          </div>

          <p className="mt-2 text-xs text-ink-faint">
            eBay sold: {candidate.ebaySoldCount} · median {money(candidate.ebayMedianPriceCents)} · opportunity {candidate.opportunityScore}/100
          </p>
        </div>

        <div className="flex items-center justify-end gap-3 border-t border-rule px-4 py-3">
          {publish.isError && <span className="mr-auto text-sm text-brick">{(publish.error as Error).message}</span>}
          <button type="button" className="text-sm text-ink-muted underline hover:text-ink" onClick={onClose} disabled={publish.isPending}>
            Cancel
          </button>
          <Button variant="primary" onClick={() => publish.mutate()} disabled={publish.isPending || !priceValid}>
            {publish.isPending ? 'Publishing…' : 'Confirm & publish to eBay'}
          </Button>
        </div>
      </div>
    </div>
  );
}

function CandidateCard({ candidate }: { candidate: ProductCandidate }) {
  const { getToken } = useAuthToken();
  const queryClient = useQueryClient();
  const [reviewing, setReviewing] = useState(false);
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['candidates'] });

  const dismiss = useMutation({
    mutationFn: () => apiFetch(`/candidates/${candidate.id}/dismiss`, getToken, { method: 'POST' }),
    onSuccess: invalidate,
  });

  const feeCents = Math.round(candidate.suggestedSellPriceCents * EBAY_FEE_RATE);

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
                <Button variant="primary" onClick={() => setReviewing(true)}>
                  Review and list on eBay
                </Button>
                <button type="button" className="text-sm text-ink-muted underline hover:text-ink" onClick={() => dismiss.mutate()} disabled={dismiss.isPending}>
                  Remove
                </button>
              </>
            )}
            {candidate.status === 'listed' && (
              <span className="text-sm font-medium text-moss">Listed on eBay — item {candidate.ebayItemId}</span>
            )}
          </div>
        </div>
      </div>

      {reviewing && <ReviewModal candidate={candidate} onClose={() => setReviewing(false)} />}
    </div>
  );
}

export function ResearchPage() {
  const { getToken } = useAuthToken();
  const queryClient = useQueryClient();
  const [seed, setSeed] = useState('');
  const [supplier, setSupplier] = useState<SourcingProvider>('aliexpress');

  const statusQuery = useQuery({
    queryKey: ['connectionStatus'],
    queryFn: () => apiFetch<ConnectionStatus>('/connections/status', getToken),
  });
  const cjConnected = statusQuery.data?.cjConnected ?? false;

  const candidatesQuery = useQuery({
    queryKey: ['candidates'],
    queryFn: () => apiFetch<{ candidates: ProductCandidate[] }>('/product-research', getToken),
  });

  const research = useMutation({
    mutationFn: () => apiFetch<{ candidates: ProductCandidate[] }>('/product-research/research', getToken, { method: 'POST', body: JSON.stringify({ seed, supplier }) }),
    onSuccess: () => {
      setSeed('');
      queryClient.invalidateQueries({ queryKey: ['candidates'] });
    },
  });

  const clearResults = useMutation({
    mutationFn: () => apiFetch('/product-research/clear', getToken, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['candidates'] }),
  });

  const [tab, setTab] = useState<'candidates' | 'listed'>('candidates');
  const allCandidates = candidatesQuery.data?.candidates ?? [];
  const drafts = allCandidates.filter((c) => c.status === 'draft');
  const listed = allCandidates.filter((c) => c.status === 'listed');
  const shown = tab === 'candidates' ? drafts : listed;

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
        {research.isPending && <ResearchProgress seed={seed} />}
      </div>

      <div className="mb-3 flex items-center justify-between gap-3 border-b border-rule">
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setTab('candidates')}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'candidates' ? 'border-signal text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            Candidates ({drafts.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('listed')}
            className={`border-b-2 px-3 py-2 text-sm font-medium ${tab === 'listed' ? 'border-signal text-ink' : 'border-transparent text-ink-muted hover:text-ink'}`}
          >
            Listed ({listed.length})
          </button>
        </div>
        {tab === 'candidates' && drafts.length > 0 && (
          <button
            type="button"
            onClick={() => clearResults.mutate()}
            disabled={clearResults.isPending}
            className="text-sm text-ink-muted underline hover:text-ink disabled:opacity-50"
          >
            {clearResults.isPending ? 'Clearing…' : 'Clear results'}
          </button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {shown.map((c) => (
          <CandidateCard key={c.id} candidate={c} />
        ))}
      </div>
      {shown.length === 0 && !research.isPending && (
        <EmptyState>
          {tab === 'candidates'
            ? 'No candidates yet — research a niche above to get started.'
            : 'No listed products yet — publish a candidate to see it here.'}
        </EmptyState>
      )}
    </div>
  );
}

/**
 * Keeps the seller engaged during the (10-40s) research call — the request is
 * synchronous, so without this the UI looks frozen. Cycles through the actual
 * stages the pipeline runs so it reads as a smart, working search rather than a
 * generic spinner.
 */
function ResearchProgress({ seed }: { seed: string }) {
  const stages = [
    `Mapping the "${seed || 'niche'}" market…`,
    'Expanding into high-potential sub-niches…',
    'Pulling real confirmed-sold eBay data…',
    'Measuring demand & seller competition…',
    'Matching supplier products & landed cost…',
    'Computing true margin after eBay fees…',
    'Writing optimized titles & listings…',
  ];
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % stages.length), 2200);
    return () => clearInterval(t);
  }, [stages.length]);
  return (
    <div className="mt-3 flex items-center gap-3 rounded-sm bg-paper p-3">
      <span className="h-4 w-4 shrink-0 animate-spin rounded-full border-2 border-rule border-t-signal" />
      <div className="min-w-0">
        <p className="truncate text-sm text-ink">{stages[i]}</p>
        <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-rule">
          <div className="h-full bg-signal transition-all duration-500" style={{ width: `${((i + 1) / stages.length) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
