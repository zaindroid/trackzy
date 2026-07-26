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
  salesPerDay: number;
  sellThroughPercent: number;
  medianPriceCents: number;
  activeCount: number;
  sourceable: boolean;
  marginPercent: number;
}): number {
  const p = input.medianPriceCents / 100;
  // Price sweet spot for eBay dropshipping (cheap enough to impulse-buy, dear
  // enough to profit): full marks $12-$80, partial $6-$150, little otherwise.
  const priceScore = p >= 12 && p <= 80 ? 25 : p >= 6 && p <= 150 ? 15 : 5;

  // Competition sweet spot from the free Browse API: a proven-but-not-saturated
  // market scores best. Too few active listings = demand unproven; a flood =
  // saturated/race-to-the-bottom.
  const a = input.activeCount;
  const competitionScore = a < 30 ? 8 : a <= 4000 ? 35 : Math.max(0, 35 - (a - 4000) / 500);

  // Margin dominates for dropshipping — 66%+ nets the full 40.
  const marginScore = input.sourceable ? Math.min(Math.max(input.marginPercent, 0) * 0.6, 40) : 0;

  // Real confirmed-demand is only a BONUS now (usually 0, since sold-data via
  // Apify is off by default) — it can't be the backbone without a free source.
  const velocityBonus = Math.min(input.salesPerDay * 2, 15) + Math.min(input.sellThroughPercent / 10, 10);

  return Math.round(Math.min(100, priceScore + competitionScore + marginScore + velocityBonus));
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
      salesPerDay,
      sellThroughPercent,
      medianPriceCents: medianSoldPriceCents,
      activeCount: active.activeCount,
      sourceable,
      marginPercent,
    }),
  };
}
