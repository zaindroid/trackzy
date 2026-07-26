import { config } from './config.js';
import type { EbayActiveSignal, EbaySoldSignal, RadarItem, SupplierMatch } from './types.js';

/** Deterministic margin: sell − supplier cost − eBay fee. Cents in, cents out. */
export function computeMargin(sellPriceCents: number, supplierCostCents: number): { marginCents: number; marginPercent: number } {
  const feeCents = Math.round(sellPriceCents * (config.defaultEbayFeePercent / 100));
  const marginCents = sellPriceCents - supplierCostCents - feeCents;
  const marginPercent = sellPriceCents > 0 ? Math.round((marginCents / sellPriceCents) * 1000) / 10 : 0;
  return { marginCents, marginPercent };
}

/**
 * Opportunity score in the spirit of the main app's `computeOpportunityScore`:
 * reward sales velocity + a healthy sell-through, price positioning toward a
 * sellable range, and low competition; discount unsourceable/thin-margin items.
 * 0–100.
 */
function opportunityScore(input: {
  soldCount: number;
  medianPriceCents: number;
  activeCount: number;
  sourceable: boolean;
  marginPercent: number;
}): number {
  const p = input.medianPriceCents / 100;
  // Price sweet spot for eBay dropshipping (cheap enough to impulse-buy, dear
  // enough to profit): full marks $12-$80, partial $6-$150, little otherwise.
  const priceScore = p >= 12 && p <= 80 ? 20 : p >= 6 && p <= 150 ? 12 : 4;

  // Competition sweet spot: a proven-but-not-saturated market scores best. Too
  // few active listings = demand unproven; a flood = saturated race-to-bottom.
  const a = input.activeCount;
  const competitionScore = a < 30 ? 10 : a <= 4000 ? 25 : Math.max(0, 25 - (a - 4000) / 700);

  // Proven demand from ScraperAPI's items_sold (log-scaled: 10 sold→8, 100→16,
  // 1k→24, capped 25). 0 when no demand source (Browse-only) — score still works.
  const demandScore = Math.min(Math.log10(Math.max(input.soldCount, 0) + 1) * 8, 25);

  // Margin matters for dropshipping — ~66%+ nets the full 30.
  const marginScore = input.sourceable ? Math.min(Math.max(input.marginPercent, 0) * 0.45, 30) : 0;

  return Math.round(Math.min(100, priceScore + competitionScore + demandScore + marginScore));
}

/** Combine the per-niche signals into a RadarItem for ingest. */
export function buildRadarItem(
  niche: string,
  active: EbayActiveSignal,
  sold: EbaySoldSignal | null,
  supplier: SupplierMatch | null,
  supplierCheck: 'ok' | 'pending' | 'none' = 'none',
): RadarItem {
  const medianSoldPriceCents = sold?.medianSoldPriceCents || active.medianPriceCents;
  const soldCount = sold?.soldCount ?? 0;
  const salesPerDay = sold?.salesPerDay ?? 0;
  // Sell-through = sold / (sold + active competition). 0 when we have no sold data.
  const sellThroughPercent =
    sold && active.activeCount + soldCount > 0
      ? Math.round((soldCount / (soldCount + active.activeCount)) * 1000) / 10
      : 0;

  const sourceable = !!supplier;
  const { marginCents, marginPercent } = sourceable
    ? computeMargin(medianSoldPriceCents, supplier!.costCents)
    : { marginCents: 0, marginPercent: 0 };

  return {
    niche,
    productTitle: active.sampleTitle,
    imageUrl: supplier?.imageUrl ?? active.sampleImageUrl ?? null,
    ebaySoldCount: soldCount,
    salesPerDay,
    ebayActiveCount: active.activeCount,
    sellThroughPercent,
    ebayMedianSoldPriceCents: medianSoldPriceCents,
    aliexpressProductId: supplier?.productId ?? null,
    aliexpressUrl: supplier?.url ?? null,
    aliexpressCostCents: supplier?.costCents ?? null,
    aliexpressRating: supplier?.rating ?? null,
    aliexpressOrders: supplier?.orders ?? null,
    sourceable,
    supplierCheck,
    marginCents,
    marginPercent,
    opportunityScore: opportunityScore({
      soldCount,
      medianPriceCents: medianSoldPriceCents,
      activeCount: active.activeCount,
      sourceable,
      marginPercent,
    }),
  };
}
