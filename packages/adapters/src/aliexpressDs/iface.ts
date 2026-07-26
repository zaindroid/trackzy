export interface AliexpressDsEnv {
  MOCK_MODE?: string;
  ALIEXPRESS_APP_KEY?: string;
  ALIEXPRESS_APP_SECRET?: string;
  /** Long-lived (~60d) refresh token; a fresh 30d access token is minted from it. */
  ALIEXPRESS_REFRESH_TOKEN?: string;
  /** Optional static access token fallback if no refresh token is set. */
  ALIEXPRESS_ACCESS_TOKEN?: string;
}

export interface AliexpressDsProduct {
  productId: string;
  title: string;
  costCents: number;
  imageUrl?: string;
  imageUrls: string[];
  productUrl?: string;
  orders?: number;
  rating?: number;
}

/**
 * Official AliExpress Dropshipper API — product search by keyword
 * (`aliexpress.ds.text.search`). The free, no-Apify, no-CAPTCHA supplier source.
 * Signed with HMAC-SHA256; access token auto-refreshed from the refresh token.
 */
export interface AliexpressDsClient {
  searchProducts(keyword: string, maxProducts?: number): Promise<AliexpressDsProduct[]>;
}
