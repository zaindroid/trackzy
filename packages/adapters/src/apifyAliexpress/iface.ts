export interface ApifyAliexpressEnv {
  MOCK_MODE?: string;
  APIFY_TOKEN?: string;
  /** Apify actor id (`owner~actor-name`). Defaults to `devcake~aliexpress-products-scraper`. */
  APIFY_ALIEXPRESS_ACTOR_ID?: string;
}

export interface AliexpressProduct {
  productId: string;
  title: string;
  priceCents: number;
  /** Primary image (first of `imageUrls`), kept for backward compatibility. */
  imageUrl?: string;
  /** All gallery images the actor returned (deduped, https-normalized, ≤12 for eBay). */
  imageUrls: string[];
  productUrl?: string;
  soldCount?: number;
}

/**
 * Real AliExpress product search via an Apify actor — used by the sourcing
 * portal to find a sourceable product + cost for a niche. Deliberately NOT
 * AliExpress's official `aliexpress.ds.text.search` API, whose results are
 * irrelevant "trending feed" noise (confirmed live — see DECISIONS.md); the
 * Apify actor performs genuine keyword search against AliExpress's real
 * catalog and needs no seller login (public data via the app-level Apify
 * token). Verified live: relevant results with price/image/URL, and
 * `sortBy: orders` surfaces best-selling items.
 */
export interface ApifyAliexpressClient {
  searchProducts(keyword: string, maxProducts?: number): Promise<AliexpressProduct[]>;
}
