export interface EbayMarketResearchEnv {
  MOCK_MODE?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  /** eBay marketplace to search — defaults to EBAY_US. See eBay's Browse API docs for the full list. */
  EBAY_MARKETPLACE_ID?: string;
  /** Apify — real sold/completed listing data (see DECISIONS.md: eBay's own sold-data API is gated behind an approval this app doesn't have). */
  APIFY_TOKEN?: string;
  /** Apify actor id, `owner~actor-name` form. Defaults to `automation-lab~ebay-sold-scraper`. */
  APIFY_EBAY_SOLD_ACTOR_ID?: string;
}

export interface MarketListing {
  itemId: string;
  title: string;
  priceCents: number;
  url: string;
  sellerUsername?: string;
  freeShipping: boolean;
  condition?: string;
}

export interface MarketSearchResult {
  /** eBay's own reported total match count for the query — not just the length of `items` (which is capped by `limit`). */
  totalListings: number;
  items: MarketListing[];
}

export interface SoldListing {
  itemId: string;
  title: string;
  soldPriceCents: number;
  soldDate: string;
  sellerUsername?: string;
  freeShipping: boolean;
  condition?: string;
  bidsCount?: number;
  url: string;
}

export interface SoldSearchResult {
  items: SoldListing[];
}

/**
 * Product-discovery research — "what's worth listing," not fulfillment.
 *
 * `searchActiveListings` is app-level eBay Browse API (client-credentials
 * OAuth, no per-user/per-storefront token) — currently-ACTIVE listings only.
 *
 * `searchSoldListings` is the real demand signal (confirmed sold/completed
 * items — price, date, seller, bids) that the original tool's methodology
 * this feature ports was built around. eBay's own Marketplace Insights API
 * (which covers this natively) is gated behind a discretionary business-unit
 * approval this app doesn't have (confirmed via research, not assumed — see
 * DECISIONS.md), so this instead calls an Apify actor that scrapes eBay's
 * public sold-listings page on our behalf — the anti-bot/maintenance burden
 * is Apify's, not ours, same tradeoff already made for AliExpress's search.
 */
export interface EbayMarketResearchClient {
  searchActiveListings(keyword: string, limit?: number): Promise<MarketSearchResult>;
  searchSoldListings(keyword: string, maxItems?: number): Promise<SoldSearchResult>;
}
