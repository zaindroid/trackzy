import type {
  OAuthTokenSet,
  OnTokenRefreshed,
  OrderSource,
  OrderSourceListing,
  OrderSourceOrder,
  PushTrackingInput,
  UpdateListingInput,
} from '../orderSource/iface.js';
import { TokenBucket, fetchWithBackoff } from '../rateLimit.js';
import type { EbayEnv } from './iface.js';

const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000; // refresh 5 minutes before actual expiry

// eBay Sell API rate limits vary by call group and application tier; 5 req/s
// with a burst of 10 is a conservative default that stays well under every
// published eBay Sell API tier. TODO(HUMAN): tune against your app's actual
// rate-limit entitlement once registered (see DEPLOY.md).
function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 10, refillPerSecond: 5 });
}

interface EbayOrderApiOrder {
  orderId: string;
  legacyOrderId?: string;
  buyer?: { username?: string };
  pricingSummary?: {
    priceSubtotal?: { value: string; currency: string };
    deliveryCost?: { value: string };
  };
  lineItems?: {
    lineItemId: string;
    sku?: string;
    title: string;
    quantity: number;
    lineItemCost?: { value: string };
  }[];
  fulfillmentStartInstructions?: {
    shippingStep?: {
      shipTo?: {
        fullName?: string;
        contactAddress?: {
          addressLine1?: string;
          addressLine2?: string;
          city?: string;
          stateOrProvince?: string;
          postalCode?: string;
          countryCode?: string;
        };
      };
    };
  }[];
}

function mapOrder(o: EbayOrderApiOrder): OrderSourceOrder {
  const subtotal = Number.parseFloat(o.pricingSummary?.priceSubtotal?.value ?? '0');
  const shipping = Number.parseFloat(o.pricingSummary?.deliveryCost?.value ?? '0');
  const shipToStep = o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo;

  return {
    externalOrderId: o.orderId,
    externalOrderNumber: o.legacyOrderId ?? o.orderId,
    currency: o.pricingSummary?.priceSubtotal?.currency ?? 'USD',
    subtotalCents: Math.round(subtotal * 100),
    shippingCents: Math.round(shipping * 100),
    lineItems: (o.lineItems ?? []).map((li) => ({
      externalLineItemId: li.lineItemId,
      sku: li.sku ?? '',
      title: li.title,
      quantity: li.quantity,
      unitPriceCents: Math.round(Number.parseFloat(li.lineItemCost?.value ?? '0') * 100),
    })),
    buyerName: o.buyer?.username,
    shipTo: shipToStep?.contactAddress
      ? {
          name: shipToStep.fullName ?? '',
          address1: shipToStep.contactAddress.addressLine1 ?? '',
          address2: shipToStep.contactAddress.addressLine2,
          city: shipToStep.contactAddress.city ?? '',
          state: shipToStep.contactAddress.stateOrProvince ?? '',
          zip: shipToStep.contactAddress.postalCode ?? '',
          country: shipToStep.contactAddress.countryCode ?? '',
        }
      : undefined,
  };
}

/**
 * eBay Sell APIs (OAuth2 user token) — Fulfillment API for orders/tracking,
 * Inventory API for listings. Endpoint shapes follow eBay's published REST
 * API docs as of this writing; TODO(HUMAN) in DEPLOY.md flags verifying them
 * against a live sandbox app once one exists, same as every other Phase 1/2
 * real adapter that couldn't be exercised against a live account during an
 * unattended build.
 */
export class RealEbayOrderSource implements OrderSource {
  private readonly bucket = newBucket();
  private tokens: OAuthTokenSet;

  constructor(
    private readonly env: EbayEnv,
    tokens: OAuthTokenSet,
    private readonly onTokenRefreshed: OnTokenRefreshed,
    private readonly nonApiMode: boolean,
  ) {
    this.tokens = tokens;
  }

  private baseUrl(): string {
    return this.env.EBAY_API_BASE_URL ?? 'https://api.ebay.com';
  }

  private async ensureFreshToken(): Promise<string> {
    if (this.tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.tokens.accessToken;
    }
    const basicAuth = btoa(`${this.env.EBAY_CLIENT_ID ?? ''}:${this.env.EBAY_CLIENT_SECRET ?? ''}`);
    const res = await fetchWithBackoff(
      'https://api.ebay.com/identity/v1/oauth2/token',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basicAuth}`,
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
          scope: 'https://api.ebay.com/oauth/api_scope/sell.fulfillment https://api.ebay.com/oauth/api_scope/sell.inventory',
        }),
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`eBay OAuth token refresh failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; expires_in: number };
    this.tokens = {
      accessToken: json.access_token,
      refreshToken: this.tokens.refreshToken,
      expiresAt: Date.now() + json.expires_in * 1000,
    };
    await this.onTokenRefreshed(this.tokens);
    return this.tokens.accessToken;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const accessToken = await this.ensureFreshToken();
    const res = await fetchWithBackoff(
      `${this.baseUrl()}${path}`,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...init?.headers,
        },
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`eBay API request to ${path} failed: ${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  async listNewOrders(since: number): Promise<OrderSourceOrder[]> {
    const sinceIso = new Date(since).toISOString();
    const filter = encodeURIComponent(`creationdate:[${sinceIso}..]`);
    const data = await this.request<{ orders: EbayOrderApiOrder[] }>(
      `/sell/fulfillment/v1/order?filter=${filter}&limit=50`,
    );
    return (data.orders ?? []).map(mapOrder);
  }

  async getOrder(externalOrderId: string): Promise<OrderSourceOrder | null> {
    try {
      const data = await this.request<EbayOrderApiOrder>(
        `/sell/fulfillment/v1/order/${encodeURIComponent(externalOrderId)}`,
      );
      return mapOrder(data);
    } catch {
      return null;
    }
  }

  async pushTracking(externalOrderId: string, input: PushTrackingInput): Promise<void> {
    if (this.nonApiMode) {
      // spec 5a: eBay Fulfillment API is bypassed entirely for non-API-mode
      // storefronts. The actual dispatch to the Chrome Extension's DOM-upload
      // queue happens at the caller level (see apps/worker's extension routes,
      // which read directly from `fulfillments` rather than the marketplace
      // API — see DECISIONS.md for why no separate queue table was needed).
      throw new NonApiModeError(externalOrderId, input);
    }
    await this.request(`/sell/fulfillment/v1/order/${encodeURIComponent(externalOrderId)}/shipping_fulfillment`, {
      method: 'POST',
      body: JSON.stringify({
        lineItems: (input.lineItemIds ?? []).map((lineItemId) => ({ lineItemId })),
        shippedDate: new Date().toISOString(),
        shippingCarrierCode: input.carrier,
        trackingNumber: input.trackingNumber,
      }),
    });
  }

  async sendBuyerMessage(externalOrderId: string, body: string): Promise<void> {
    // eBay's modern Sell APIs do not expose a REST buyer-messaging endpoint;
    // this uses the legacy Post-Order API's message thread creation, which is
    // the closest documented equivalent. TODO(HUMAN): confirm this exact path
    // against eBay's current Post-Order API docs before relying on it in
    // production — flagged in DEPLOY.md.
    await this.request(`/post-order/v2/casemanagement/${encodeURIComponent(externalOrderId)}/message`, {
      method: 'POST',
      body: JSON.stringify({ comments: body }),
    });
  }

  async listListings(): Promise<OrderSourceListing[]> {
    const data = await this.request<{
      inventoryItems: {
        sku: string;
        product?: { title?: string };
        availability?: { shipToLocationAvailability?: { quantity?: number } };
      }[];
    }>('/sell/inventory/v1/inventory_item?limit=100');

    const listings: OrderSourceListing[] = [];
    for (const item of data.inventoryItems ?? []) {
      const offerData = await this.request<{ offers: { offerId: string; pricingSummary?: { price?: { value: string } } }[] }>(
        `/sell/inventory/v1/offer?sku=${encodeURIComponent(item.sku)}`,
      );
      const offer = offerData.offers?.[0];
      listings.push({
        externalListingId: offer?.offerId ?? item.sku,
        sku: item.sku,
        title: item.product?.title ?? item.sku,
        priceCents: Math.round(Number.parseFloat(offer?.pricingSummary?.price?.value ?? '0') * 100),
        quantityAvailable: item.availability?.shipToLocationAvailability?.quantity ?? 0,
      });
    }
    return listings;
  }

  async updateListing(externalListingId: string, input: UpdateListingInput): Promise<void> {
    if (input.priceCents !== undefined) {
      await this.request(`/sell/inventory/v1/offer/${encodeURIComponent(externalListingId)}`, {
        method: 'PUT',
        body: JSON.stringify({ pricingSummary: { price: { value: (input.priceCents / 100).toFixed(2), currency: 'USD' } } }),
      });
    }
    if (input.quantityAvailable !== undefined) {
      await this.request(`/sell/inventory/v1/offer/${encodeURIComponent(externalListingId)}/publish`, {
        method: 'PUT',
        body: JSON.stringify({ availableQuantity: input.quantityAvailable }),
      });
    }
  }

  async pauseListing(externalListingId: string): Promise<void> {
    await this.updateListing(externalListingId, { quantityAvailable: 0 });
  }
}

/** Signals that a non-API-mode storefront's tracking must go through the extension, not the Fulfillment API. */
export class NonApiModeError extends Error {
  constructor(
    public readonly externalOrderId: string,
    public readonly input: PushTrackingInput,
  ) {
    super(`eBay storefront is in non_api_mode; tracking for order ${externalOrderId} must go through the extension`);
    this.name = 'NonApiModeError';
  }
}
