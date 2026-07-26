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
