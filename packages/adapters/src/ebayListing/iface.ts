export interface EbayListingEnv {
  MOCK_MODE?: string;
  EBAY_CLIENT_ID?: string;
  EBAY_CLIENT_SECRET?: string;
  /** Override for eBay sandbox testing; defaults to production. */
  EBAY_API_BASE_URL?: string;
}

export interface CreateListingInput {
  /** A fresh eBay OAuth user access token with the `sell.inventory` scope. Token refresh is the caller's responsibility (the sourcing worker owns the connection store). */
  accessToken: string;
  sku: string;
  title: string;
  /** HTML description body — CDATA-wrapped in the request, so it may contain markup. */
  description: string;
  priceCents: number;
  quantity: number;
  categoryId: string;
  imageUrls: string[];
  /** Item specifics (eBay "aspects"), e.g. `{ Brand: 'Generic', Type: 'Sleep Mask' }`. */
  aspects: Record<string, string>;
  /** eBay ConditionID label — 'New' | 'Used' etc. (mapped to a numeric ConditionID). */
  condition: string;
  shippingCostCents: number;
  handlingTimeDays: number;
  returnPolicy: 'no_returns' | '30_day' | '60_day';
  itemLocationPostalCode: string;
  /**
   * eBay flat-rate domestic ShippingService code. Defaults to 'USPSPriority'
   * (verified valid against the sandbox — 'USPSGround' is NOT a valid code,
   * eBay error 12519). Override per marketplace if needed.
   */
  shippingServiceCode?: string;
}

export interface CreateListingResult {
  ebayItemId: string;
}

export interface CategorySuggestion {
  categoryId: string;
  categoryName: string;
}

/**
 * Creates LIVE eBay listings — the one genuinely new capability this whole
 * product adds (trackzy only ever reads/edits existing listings). Uses eBay's
 * Trading API `AddFixedPriceItem` (the same XML + `X-EBAY-API-IAF-TOKEN`
 * pattern trackzy already uses for GetMyeBaySelling/ReviseFixedPriceItem),
 * with shipping/return specified INLINE so it works without the seller having
 * set up eBay Business Policies. See the plan / DECISIONS.md.
 */
export interface EbayUserInfo {
  username: string | null;
}

export interface EbayListingClient {
  /** eBay Taxonomy API — suggests the best category id from a listing title, so the user doesn't have to pick one. */
  suggestCategory(accessToken: string, title: string): Promise<CategorySuggestion | null>;
  createFixedPriceListing(input: CreateListingInput): Promise<CreateListingResult>;
  /** Trading API GetUser — the seller's eBay username, captured at connect to honor account-deletion notifications. */
  getUserInfo(accessToken: string): Promise<EbayUserInfo>;
}
