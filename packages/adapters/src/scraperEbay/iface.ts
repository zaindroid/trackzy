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
