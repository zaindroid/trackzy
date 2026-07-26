import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuthToken } from '../lib/auth.js';
import { apiFetch, type RadarProduct } from '../lib/api.js';
import { EmptyState, PageHeader, Select } from '../components/ui.js';

function money(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

type SortKey = 'opportunity' | 'margin' | 'velocity' | 'sellThrough';

const SORTERS: Record<SortKey, (a: RadarProduct, b: RadarProduct) => number> = {
  opportunity: (a, b) => b.opportunityScore - a.opportunityScore,
  margin: (a, b) => b.marginCents - a.marginCents,
  velocity: (a, b) => b.salesPerDay - a.salesPerDay,
  sellThrough: (a, b) => b.sellThroughPercent - a.sellThroughPercent,
};

function Thumb({ src, alt }: { src: string | null; alt: string }) {
  if (!src) return <div className="flex h-12 w-12 shrink-0 items-center justify-center border border-rule bg-paper text-[8px] text-ink-faint">No image</div>;
  return <img src={src} alt={alt} className="h-12 w-12 shrink-0 border border-rule object-cover" />;
}

export function RadarPage() {
  const { getToken } = useAuthToken();
  const [sort, setSort] = useState<SortKey>('opportunity');
  const [sourceableOnly, setSourceableOnly] = useState(true);
  const [minMargin, setMinMargin] = useState(0);

  const query = useQuery({
    queryKey: ['radar'],
    queryFn: () => apiFetch<{ products: RadarProduct[]; feePercentUsed: number }>('/radar', getToken),
  });

  const products = query.data?.products ?? [];
  const rows = useMemo(() => {
    return products
      .filter((p) => (sourceableOnly ? p.sourceable : true))
      .filter((p) => p.marginPercent >= minMargin)
      .sort(SORTERS[sort]);
  }, [products, sort, sourceableOnly, minMargin]);

  const lastUpdated = products.reduce((max, p) => Math.max(max, p.lastUpdated), 0);

  return (
    <div className="max-w-5xl">
      <PageHeader
        eyebrow="Discover"
        title="Radar"
        description="Products with proven eBay demand, cross-checked against an AliExpress supplier and ranked by opportunity. Margin is shown for your own fee settings. Updated automatically by the research crawler."
      />

      <div className="mb-4 flex flex-wrap items-center gap-3 border border-rule bg-paper-raised p-3 shadow-raised">
        <label className="text-xs text-ink-muted">
          Sort by
          <Select value={sort} onChange={(e) => setSort(e.target.value as SortKey)} className="ml-2 w-44">
            <option value="opportunity">Opportunity score</option>
            <option value="margin">Profit (margin)</option>
            <option value="velocity">Sales / day</option>
            <option value="sellThrough">Sell-through rate</option>
          </Select>
        </label>
        <label className="text-xs text-ink-muted">
          Min margin %
          <Select value={String(minMargin)} onChange={(e) => setMinMargin(Number(e.target.value))} className="ml-2 w-24">
            <option value="0">Any</option>
            <option value="20">20%+</option>
            <option value="35">35%+</option>
            <option value="50">50%+</option>
          </Select>
        </label>
        <label className="flex items-center gap-2 text-xs text-ink-muted">
          <input type="checkbox" checked={sourceableOnly} onChange={(e) => setSourceableOnly(e.target.checked)} />
          Sourceable only
        </label>
        {lastUpdated > 0 && (
          <span className="ml-auto text-xs text-ink-faint">Updated {new Date(lastUpdated).toLocaleString()}</span>
        )}
      </div>

      {query.isLoading && <EmptyState>Loading radar…</EmptyState>}
      {query.isError && <p className="text-sm text-brick">{(query.error as Error).message}</p>}

      {!query.isLoading && rows.length === 0 && (
        <EmptyState>
          No radar results yet. Once the research crawler runs and posts results, high-demand sourceable products appear here.
        </EmptyState>
      )}

      {rows.length > 0 && (
        <div className="overflow-x-auto border border-rule">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-rule bg-paper-raised text-left text-xs uppercase tracking-wide text-ink-muted">
                <th className="p-2 font-medium">Product</th>
                <th className="p-2 text-right font-medium">Sold/day</th>
                <th className="p-2 text-right font-medium">Sell-through</th>
                <th className="p-2 text-right font-medium">Median</th>
                <th className="p-2 text-right font-medium">Cost</th>
                <th className="p-2 text-right font-medium">Profit</th>
                <th className="p-2 text-right font-medium">Score</th>
                <th className="p-2 font-medium">Supplier</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="border-b border-rule align-top last:border-0">
                  <td className="p-2">
                    <div className="flex gap-2">
                      <Thumb src={p.imageUrl} alt={p.productTitle} />
                      <div className="min-w-0">
                        <p className="font-medium text-ink">{p.productTitle}</p>
                        <p className="text-xs text-ink-faint">{p.niche}</p>
                      </div>
                    </div>
                  </td>
                  <td className="p-2 text-right tabular-nums">{p.salesPerDay.toFixed(1)}</td>
                  <td className="p-2 text-right tabular-nums">{p.sellThroughPercent.toFixed(0)}%</td>
                  <td className="p-2 text-right tabular-nums">{money(p.ebayMedianSoldPriceCents)}</td>
                  <td className="p-2 text-right tabular-nums">{p.aliexpressCostCents != null ? money(p.aliexpressCostCents) : '—'}</td>
                  <td className={`p-2 text-right font-medium tabular-nums ${p.marginCents > 0 ? 'text-moss' : 'text-brick'}`}>
                    {money(p.marginCents)}
                    <span className="ml-1 text-xs font-normal text-ink-faint">({p.marginPercent}%)</span>
                  </td>
                  <td className="p-2 text-right tabular-nums">{p.opportunityScore.toFixed(0)}</td>
                  <td className="p-2">
                    {p.aliexpressUrl ? (
                      <a href={p.aliexpressUrl} target="_blank" rel="noreferrer" className="text-xs text-signal underline hover:no-underline">
                        AliExpress ↗
                      </a>
                    ) : p.supplierCheck === 'pending' ? (
                      <span className="text-xs text-ochre" title="Demand looks strong; supplier cross-check deferred by the monthly budget — resumes next crawl.">
                        supplier check pending
                      </span>
                    ) : (
                      <span className="text-xs text-ink-faint">not sourceable</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
