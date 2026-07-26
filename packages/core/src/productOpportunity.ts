export interface OpportunitySignals {
  avgPriceCents: number;
  uniqueSellers: number;
  totalSold: number;
  freeShippingPercent: number; // 0-100
}

/**
 * Opportunity score (0-100) for a keyword search — ported directly from the
 * original tool's methodology (`compute_dropship_score`, a Python/Playwright
 * eBay sold-listings scraper the user pointed at as the reference
 * methodology; see DECISIONS.md) rather than reinvented. Built from real
 * confirmed-sold data (via an Apify actor, since eBay's own Marketplace
 * Insights API is gated behind an approval this app doesn't have): price
 * positioning toward a $50-100 sweet spot, seller competition (fewer
 * competing sellers = more room), sales velocity (more confirmed sales =
 * higher demand), and free-shipping prevalence (a buyer-expectation signal).
 * Same weights as the original: price/competition/shipping each up to 20
 * points, velocity up to 40 — velocity is weighted highest deliberately,
 * matching the original's judgment that demonstrated demand matters more
 * than any other single signal.
 */
export function computeOpportunityScore(signals: OpportunitySignals): number {
  const avgPrice = signals.avgPriceCents / 100; // the original formula works in dollars
  const priceScore = Math.min(avgPrice / 5.0, 20.0);
  const competitionScore = Math.max(0, 20.0 - signals.uniqueSellers * 0.5);
  const velocityScore = Math.min(signals.totalSold / 5.0, 40.0);
  const shippingScore = signals.freeShippingPercent / 5.0;
  const raw = priceScore + competitionScore + velocityScore + shippingScore;
  return Math.round(Math.min(raw, 100) * 10) / 10;
}

export interface ListingMarginInput {
  /** What the seller lists the item at on eBay. */
  sellPriceCents: number;
  /** What the seller pays the supplier (e.g. CJ) for the item. */
  supplierCostCents: number;
  /** eBay's final-value fee as a percentage of the sale (typically ~13.25%). */
  ebayFeePercent: number;
  /** What it costs the seller to get the item to the buyer (supplier shipping / the seller's flat-rate offer). */
  fulfillmentShippingCents: number;
}

export interface ListingMargin {
  marginCents: number;
  /** Margin as a percentage of the sell price. Can be negative when the item can't be sold profitably at that price. */
  marginPercent: number;
}

/**
 * The seller's take-home profit on a listing: sell price minus supplier cost,
 * eBay's fee, and fulfillment shipping. Deliberately a plain deterministic
 * function in `core` (no LLM, no network) — this is the money-path calculation
 * the sourcing portal ranks candidates by, and the hard rule is the LLM never
 * touches it (see DECISIONS.md). eBay's fixed per-order fee (~$0.40) is folded
 * into the caller's `ebayFeePercent` default rather than modeled separately,
 * to keep this a single clean percentage-plus-costs formula.
 */
export function computeListingMargin(input: ListingMarginInput): ListingMargin {
  const feeCents = Math.round(input.sellPriceCents * (input.ebayFeePercent / 100));
  const marginCents = input.sellPriceCents - input.supplierCostCents - feeCents - input.fulfillmentShippingCents;
  const marginPercent = input.sellPriceCents > 0 ? Math.round((marginCents / input.sellPriceCents) * 1000) / 10 : 0;
  return { marginCents, marginPercent };
}
