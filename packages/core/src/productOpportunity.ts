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

export interface SourcingScoreSignals {
  /** Proven demand — total items sold across the sampled listings (ScraperAPI items_sold). */
  totalSold: number;
  /** The seller's computed margin percentage for this candidate (the money signal). */
  marginPercent: number;
  /** Median sold price in cents — for price-band positioning. */
  medianPriceCents: number;
}

/**
 * Sourcing-portal opportunity score (0-100) — distinct from `computeOpportunityScore`
 * (which trackzy's Opportunities feature shares and which ignores margin). For a
 * dropshipping *sourcing* decision the two things that actually matter are
 * PROVEN DEMAND and MARGIN, with price-band as a lighter factor:
 *   - demand: log-scaled units sold (10→~17, 100→~34, 1000+→40 cap)
 *   - margin: linear, ~80% margin earns the full 40
 *   - price:  full marks in the $12-$80 impulse-buy-yet-profitable band
 * A genuinely strong product (real sales + fat margin + good price) lands ~90-100;
 * thin-margin or low-demand items fall well below the 70 quality gate the pipeline
 * applies, so only high-potential candidates surface.
 */
export function computeSourcingScore(signals: SourcingScoreSignals): number {
  const demandScore = Math.min(Math.log10(Math.max(signals.totalSold, 0) + 1) * 17, 40);
  const marginScore = Math.min(Math.max(signals.marginPercent, 0) * 0.5, 40);
  const p = signals.medianPriceCents / 100;
  const priceScore = p >= 12 && p <= 80 ? 20 : p >= 8 && p <= 150 ? 12 : 4;
  return Math.round(Math.min(100, demandScore + marginScore + priceScore));
}

export interface RepriceInput {
  /** Latest supplier cost (re-fetched by the monitor). */
  supplierCostCents: number;
  /** Whether the supplier currently has stock. */
  inStock: boolean;
  /** The listing's current eBay price. */
  currentSellPriceCents: number;
  /** Live competitor median (from our eBay demand data); null when unknown. */
  competitorMedianCents: number | null;
  ebayFeePercent: number;
  fulfillmentShippingCents: number;
  /** The seller's minimum acceptable margin % (the floor we protect). */
  minMarginPercent: number;
  /** Optional hard price ceiling — never price above this. */
  priceCeilingCents: number | null;
}

export interface RepriceDecision {
  action: 'none' | 'reprice' | 'pause_oos' | 'pause_unprofitable';
  /** The price to set when action === 'reprice'. */
  newSellPriceCents: number;
  marginPercent: number;
  reason: string;
}

/**
 * The smart-repricing brain — deliberately beyond a plain markup formula.
 *
 * It computes the **true margin-floor price** (the sell price at which the
 * seller still clears `minMarginPercent` after supplier cost + eBay fee +
 * shipping), then positions **competitively** against the live eBay median we
 * already track — pricing to stay near/under the market while NEVER dropping
 * below the margin floor — and clamps to an optional ceiling. Out-of-stock →
 * pause; can't clear the floor under the ceiling → pause as unprofitable. Pure
 * and deterministic (money-path, no LLM/network) so it's fully unit-tested.
 */
export function decideReprice(i: RepriceInput): RepriceDecision {
  const marginAt = (sell: number): number => {
    if (sell <= 0) return -100;
    const fee = sell * (i.ebayFeePercent / 100);
    return Math.round(((sell - i.supplierCostCents - fee - i.fulfillmentShippingCents) / sell) * 1000) / 10;
  };

  if (!i.inStock) {
    return { action: 'pause_oos', newSellPriceCents: i.currentSellPriceCents, marginPercent: marginAt(i.currentSellPriceCents), reason: 'Supplier out of stock' };
  }

  // Solve for the lowest sell price that still hits the margin floor:
  //   margin% = 1 - fee% - (cost+ship)/sell  ⇒  sell = (cost+ship) / (1 - fee% - minMargin%)
  const feeFrac = i.ebayFeePercent / 100;
  const minFrac = i.minMarginPercent / 100;
  const denom = 1 - feeFrac - minFrac;
  const base = i.supplierCostCents + i.fulfillmentShippingCents;
  const floorPrice = denom > 0 ? Math.ceil(base / denom) : Number.POSITIVE_INFINITY;

  // Can't be profitable within the ceiling → pause rather than sell at a loss.
  if (i.priceCeilingCents != null && floorPrice > i.priceCeilingCents) {
    return { action: 'pause_unprofitable', newSellPriceCents: i.currentSellPriceCents, marginPercent: marginAt(i.currentSellPriceCents), reason: 'Supplier cost rose above the profitable ceiling' };
  }

  // Competitive target: sit at/just under the market median, but never below the
  // margin floor. Absent competitor data, keep the current price if it's healthy.
  let target = i.competitorMedianCents && i.competitorMedianCents > 0 ? Math.min(i.currentSellPriceCents || i.competitorMedianCents, i.competitorMedianCents) : i.currentSellPriceCents;
  target = Math.max(target, floorPrice);
  if (i.priceCeilingCents != null) target = Math.min(target, i.priceCeilingCents);

  // Only act if the price should move by more than a cent of rounding noise.
  const action = Math.abs(target - i.currentSellPriceCents) >= 1 ? 'reprice' : 'none';
  const reason =
    action === 'none'
      ? 'Price already optimal'
      : target > i.currentSellPriceCents
        ? 'Raised to protect margin against supplier cost'
        : 'Lowered to stay competitive while holding margin';
  return { action, newSellPriceCents: target, marginPercent: marginAt(target), reason };
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
