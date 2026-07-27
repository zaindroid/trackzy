export interface ScraperEbayEnv {
  MOCK_MODE?: string;
  /** ScraperAPI key — structured eBay endpoint (real demand data, no Apify). */
  SCRAPER_API_KEY?: string;
}

/** One eBay listing from the structured search, carrying its own sold count. */
export interface EbayDemandListing {
  priceCents: number;
  sellerName?: string;
  freeShipping: boolean;
  itemsSold: number;
}

export interface EbayDemandResult {
  items: EbayDemandListing[];
  /** Sum of items_sold across the page — the real proven-demand signal. */
  totalSold: number;
  medianPriceCents: number;
  /**
   * Number of ACTIVE competing listings for the keyword — the competition
   * denominator for a sell-through-rate signal (sold ÷ active). Taken from the
   * search response's total-results count when present (so it costs no extra
   * credit — it rides the same demand call), otherwise falls back to the size
   * of the sampled page. May be undefined for cache rows written before this
   * field existed; callers treat that as "unknown" (a neutral competition term).
   */
  activeListingCount?: number;
}

/**
 * Real eBay DEMAND research via ScraperAPI's structured `/structured/ebay/search`
 * endpoint. Each listing carries `items_sold`, so summing gives proven sales
 * volume for a keyword — the free (no-Apify) replacement for the old Apify
 * sold-listings scraper, and it sails past eBay's sold-search sign-in wall.
 */
export interface ScraperEbayClient {
  searchDemand(keyword: string): Promise<EbayDemandResult>;
}
