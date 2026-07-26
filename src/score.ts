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
  const priceDollars = input.medianPriceCents / 100;
  const priceScore = Math.min(priceDollars / 5, 20); // ~$100 caps the price component
  const competitionScore = Math.max(0, 20 - input.activeCount / 200); // fewer competitors = better
  const velocityScore = Math.min(input.salesPerDay * 4, 30); // strong weight on real demand
  const strScore = Math.min(input.sellThroughPercent / 5, 15);
  const marginScore = input.sourceable ? Math.min(Math.max(input.marginPercent, 0) / 5, 15) : 0;
  return Math.round(priceScore + competitionScore + velocityScore + strScore + marginScore);
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
