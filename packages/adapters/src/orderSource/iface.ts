/**
 * Common contract for polling-based marketplace order sources (eBay, Amazon).
 *
 * Shopify deliberately does NOT implement this interface — it already has a
 * superior, dedicated webhook-push ingestion path (packages/adapters/src/shopify
 * + apps/worker/src/routes/webhooks.shopify.ts) built and proven in Phase 1.
 * OrderSource exists specifically for marketplaces that only offer polling
 * (`listNewOrders(since)`), which eBay and Amazon both are per spec sections
 * 5a/5b. Forcing Shopify's webhook flow through a generic polling interface
 * would be a regression, not a generalization — see DECISIONS.md.
 */
export interface OrderSourceShipTo {
  name: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
}

export interface OrderSourceLineItem {
  externalLineItemId: string;
  sku: string;
  title: string;
  quantity: number;
  unitPriceCents: number;
}

export interface OrderSourceOrder {
  externalOrderId: string;
  externalOrderNumber: string;
  currency: string;
  subtotalCents: number;
  shippingCents: number;
  lineItems: OrderSourceLineItem[];
  buyerName?: string;
  shipTo?: OrderSourceShipTo;
}

export interface PushTrackingInput {
  trackingNumber: string;
  carrier: string;
  lineItemIds?: string[];
}

export interface OrderSourceListing {
  externalListingId: string;
  sku: string;
  title: string;
  priceCents: number;
  quantityAvailable: number;
}

export interface UpdateListingInput {
  priceCents?: number;
  quantityAvailable?: number;
}

export interface OrderSource {
  listNewOrders(since: number): Promise<OrderSourceOrder[]>;
  getOrder(externalOrderId: string): Promise<OrderSourceOrder | null>;
  pushTracking(externalOrderId: string, input: PushTrackingInput): Promise<void>;
  sendBuyerMessage(externalOrderId: string, body: string): Promise<void>;
  listListings(): Promise<OrderSourceListing[]>;
  updateListing(externalListingId: string, input: UpdateListingInput): Promise<void>;
  pauseListing(externalListingId: string): Promise<void>;
}

/** OAuth2 user-token bundle shared by every marketplace OrderSource (eBay, Amazon). */
export interface OAuthTokenSet {
  accessToken: string;
  refreshToken: string;
  /** Unix ms. Real implementations refresh proactively when within a short window of this. */
  expiresAt: number;
}

/**
 * Called by a real OrderSource implementation after it silently refreshes an
 * expired access token, so the caller can persist the new token/expiry back
 * onto the owning `storefronts` row. Adapters never touch D1 directly (same
 * convention as every Phase 1 adapter) — this callback is how the refreshed
 * credential gets back to durable storage.
 */
export type OnTokenRefreshed = (tokens: OAuthTokenSet) => Promise<void>;
