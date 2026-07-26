import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type ProductOpportunity } from '../lib/api.js';
import { Button, EmptyState, PageHeader, TextInput } from '../components/ui.js';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function ScoreBadge({ score }: { score: number }) {
  const color = score >= 70 ? 'bg-moss/15 text-moss' : score >= 40 ? 'bg-signal/15 text-signal' : 'bg-brick/15 text-brick';
  return <span className={`rounded-sm px-2 py-0.5 text-xs font-semibold ${color}`}>{score}/100</span>;
}

function OpportunityRow({ opp }: { opp: ProductOpportunity }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <>
      <tr className="md:hover:bg-paper">
        <td data-label="Keyword" className="md:px-4 md:py-2.5">
          <button type="button" className="font-medium text-signal underline hover:no-underline" onClick={() => setExpanded(!expanded)}>
            {opp.keyword}
          </button>
          {opp.aiVerdict && <span className="ml-2 rounded-sm bg-signal/15 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-signal">AI</span>}
        </td>
        <td data-label="Score" className="md:px-4 md:py-2.5">
          <ScoreBadge score={opp.opportunityScore} />
        </td>
        <td data-label="Avg sold price" className="md:px-4 md:py-2.5">
          {money(opp.avgPriceCents)}
        </td>
        <td data-label="Sold" className="md:px-4 md:py-2.5">
          {opp.totalSold}
        </td>
        <td data-label="Sellers" className="md:px-4 md:py-2.5">
          {opp.uniqueSellers}
        </td>
        <td data-label="Free ship" className="md:px-4 md:py-2.5">
          {opp.freeShippingPercent}%
        </td>
        <td data-label="Scanned" className="text-ink-faint md:px-4 md:py-2.5">
          {new Date(opp.scannedAt).toLocaleString()}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={7} className="bg-paper px-4 py-3">
            {opp.aiVerdict && (
              <div className="mb-3 border-l-2 border-signal pl-3">
                <p className="mb-1 text-xs uppercase tracking-wide text-ink-faint">AI analysis (advisory — verify before sourcing)</p>
                <p className="mb-1 text-sm text-ink">{opp.aiVerdict}</p>
                <p className="text-xs text-ink-muted">
                  Sell range {opp.aiSellPriceMinCents !== null && money(opp.aiSellPriceMinCents)}–
                  {opp.aiSellPriceMaxCents !== null && money(opp.aiSellPriceMaxCents)} · Target source price{' '}
                  {opp.aiTargetSourcePriceCents !== null && money(opp.aiTargetSourcePriceCents)} · Est. margin{' '}
                  {opp.aiMarginEstimateCents !== null && money(opp.aiMarginEstimateCents)}
                </p>
                {opp.aiRisk && <p className="text-xs text-brick">Risk: {opp.aiRisk}</p>}
                {opp.recommendedKeywords && opp.recommendedKeywords.length > 0 && (
                  <p className="mt-1 text-xs text-ink-muted">Next keywords to try: {opp.recommendedKeywords.join(', ')}</p>
                )}
              </div>
            )}
            <p className="mb-2 text-xs uppercase tracking-wide text-ink-faint">Sample sold listings</p>
            <ul className="flex flex-col gap-1">
              {opp.sampleListings.map((l) => (
                <li key={l.url} className="text-sm">
                  <a href={l.url} target="_blank" rel="noreferrer" className="text-signal underline hover:no-underline">
                    {l.title}
                  </a>{' '}
                  <span className="text-ink-muted">— {money(l.priceCents)}</span>
                </li>
              ))}
            </ul>
          </td>
        </tr>
      )}
    </>
  );
}

export function OpportunitiesPage() {
  const { token } = useAuthToken();
  const queryClient = useQueryClient();
  const [keyword, setKeyword] = useState('');
  const [deepSearch, setDeepSearch] = useState(false);

  const historyQuery = useQuery({
    queryKey: ['productOpportunities'],
    queryFn: () => apiFetch<{ opportunities: ProductOpportunity[] }>('/product-opportunities', token),
  });

  const search = useMutation({
    mutationFn: () =>
      apiFetch<ProductOpportunity>('/product-opportunities/search', token, {
        method: 'POST',
        body: JSON.stringify({ keyword, deepSearch }),
      }),
    onSuccess: () => {
      setKeyword('');
      queryClient.invalidateQueries({ queryKey: ['productOpportunities'] });
    },
  });

  return (
    <div>
      <PageHeader
        eyebrow="Discover"
        title="Opportunities"
        description="Search a keyword to see real recent sales on eBay — before you list, not after."
      />

      <div className="mb-6 border border-rule bg-paper-raised p-4 shadow-raised">
        <p className="mb-3 text-sm text-ink-muted">
          Based on <strong>confirmed sold eBay listings</strong> — real prices, real sales volume, real competition.
          "Deep search" keeps refining the keyword (via AI-suggested variations) until it finds a niche worth listing,
          then adds a pricing/margin analysis. Still a starting filter, not a guarantee — verify before sourcing.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <TextInput
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="e.g. wireless earbuds"
            className="sm:w-72"
          />
          <label className="flex items-center gap-1.5 text-sm text-ink-muted">
            <input type="checkbox" checked={deepSearch} onChange={(e) => setDeepSearch(e.target.checked)} />
            Deep search
          </label>
          <Button variant="primary" onClick={() => search.mutate()} disabled={search.isPending || !keyword}>
            {search.isPending ? (deepSearch ? 'Refining…' : 'Searching…') : 'Search'}
          </Button>
        </div>
        {search.isError && <p className="mt-2 text-sm text-brick">{(search.error as Error).message}</p>}
      </div>

      <div className="border border-rule bg-paper-raised shadow-raised">
        <table className="manifest">
          <thead className="border-b border-rule text-xs uppercase tracking-wide text-ink-faint">
            <tr>
              <th className="px-4 py-2.5 font-medium">Keyword</th>
              <th className="px-4 py-2.5 font-medium">Score</th>
              <th className="px-4 py-2.5 font-medium">Avg sold price</th>
              <th className="px-4 py-2.5 font-medium">Sold</th>
              <th className="px-4 py-2.5 font-medium">Sellers</th>
              <th className="px-4 py-2.5 font-medium">Free ship</th>
              <th className="px-4 py-2.5 font-medium">Scanned</th>
            </tr>
          </thead>
          <tbody>
            {historyQuery.data?.opportunities.map((opp) => (
              <OpportunityRow key={opp.id} opp={opp} />
            ))}
          </tbody>
        </table>
        {historyQuery.data?.opportunities.length === 0 && <EmptyState>No searches yet — try a keyword above.</EmptyState>}
      </div>
    </div>
  );
}
