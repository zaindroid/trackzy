import { XMLParser } from 'fast-xml-parser';
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

// eBay's Trading API compatibility level as of this writing. TODO(HUMAN):
// eBay periodically deprecates old compatibility levels — confirm this is
// still accepted against a live account (a rejected level fails loudly with
// an explicit "Invalid compatibility level" Ack=Failure error, not silently).
const TRADING_API_COMPATIBILITY_LEVEL = 1193;

// `parseTagValue: false` keeps every tag's text content as a string — eBay's
// ItemID is a long numeric-looking string that must never be silently
// coerced to a JS number (precision loss, plus every caller treats
// externalListingId as an opaque string); numeric fields we actually need
// (price, quantity) are converted explicitly at the call site instead.
const xmlParser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', parseTagValue: false });

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

// Every field comes through as a string (see xmlParser's `parseTagValue: false`
// above) — Quantity/CurrentPrice/QuantitySold are converted with Number(...)
// at the point of use in listListings() below.
interface TradingApiItem {
  ItemID: string;
  SKU?: string;
  Title?: string;
  Quantity?: string;
  SellingStatus?: { CurrentPrice?: { '#text': string }; QuantitySold?: string };
}

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

  /**
   * eBay's older XML Trading API — needed alongside the REST Sell APIs
   * above because the REST Inventory API (`/sell/inventory/v1/*`) only ever
   * sees listings created through its own SKU-based "multi-quantity"
   * workflow. The vast majority of individual sellers list the traditional
   * way (Seller Hub's normal "List an item" flow, bulk tools, etc.), and
   * those "classic" listings simply don't exist as far as the Inventory API
   * is concerned — confirmed live: a real connected account with active
   * eBay listings returned `{"total":0}` from `GET inventory_item` (see
   * DECISIONS.md). Trading API's `GetMyeBaySelling`/`ReviseFixedPriceItem`
   * work by `ItemID` for both classic and Inventory-API-originated
   * listings, so this replaces the REST-only listing read/update path
   * entirely rather than maintaining two parallel code paths for two
   * listing formats.
   *
   * Auth: eBay supports passing the same OAuth user access token used for
   * the REST Sell APIs via the `X-EBAY-API-IAF-TOKEN` header instead of the
   * legacy `<RequesterCredentials>` XML block — no separate Auth'n'Auth
   * token needed. TODO(HUMAN): this is documented behavior but hasn't been
   * exercised against a live account; confirm the token's granted scope
   * covers Trading API's core listing calls (it should — this is the same
   * `sell.inventory` scope already requested during connect).
   */
  private async tradingApiRequest<T>(callName: string, bodyXml: string): Promise<T> {
    const accessToken = await this.ensureFreshToken();
    const requestXml = `<?xml version="1.0" encoding="utf-8"?><${callName}Request xmlns="urn:ebay:apis:eBLBaseComponents">${bodyXml}</${callName}Request>`;
    const res = await fetchWithBackoff(
      `${this.baseUrl()}/ws/api.dll`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'text/xml',
          'X-EBAY-API-COMPATIBILITY-LEVEL': String(TRADING_API_COMPATIBILITY_LEVEL),
          'X-EBAY-API-CALL-NAME': callName,
          'X-EBAY-API-SITEID': '0',
          'X-EBAY-API-IAF-TOKEN': accessToken,
        },
        body: requestXml,
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`eBay Trading API call ${callName} failed: ${res.status} ${await res.text()}`);
    }
    const parsed = xmlParser.parse(await res.text()) as Record<string, unknown>;
    const response = parsed[`${callName}Response`] as { Ack?: string; Errors?: unknown } | undefined;
    if (response?.Ack === 'Failure') {
      throw new Error(`eBay Trading API call ${callName} returned Ack=Failure: ${JSON.stringify(response.Errors)}`);
    }
    return response as T;
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
    const listings: OrderSourceListing[] = [];
    const MAX_PAGES = 20; // 100/page — a 2,000-listing ceiling per sync pass is generous for this app's target sellers
    let page = 1;

    for (;;) {
      const response = await this.tradingApiRequest<{
        ActiveList?: {
          ItemArray?: { Item?: TradingApiItem | TradingApiItem[] };
          PaginationResult?: { TotalNumberOfPages?: string };
        };
      }>(
        'GetMyeBaySelling',
        `<ActiveList><Include>true</Include><Pagination><EntriesPerPage>100</EntriesPerPage><PageNumber>${page}</PageNumber></Pagination></ActiveList>`,
      );

      const rawItems = response.ActiveList?.ItemArray?.Item;
      const items = rawItems ? (Array.isArray(rawItems) ? rawItems : [rawItems]) : [];
      for (const item of items) {
        const currentPrice = Number(item.SellingStatus?.CurrentPrice?.['#text'] ?? 0);
        const quantitySold = Number(item.SellingStatus?.QuantitySold ?? 0);
        const quantity = Number(item.Quantity ?? 0);
        listings.push({
          externalListingId: item.ItemID,
          sku: item.SKU || item.ItemID, // classic listings are frequently never assigned a SKU at all
          title: item.Title ?? item.ItemID,
          priceCents: Math.round(currentPrice * 100),
          quantityAvailable: Math.max(0, quantity - quantitySold),
        });
      }

      const totalPages = Number(response.ActiveList?.PaginationResult?.TotalNumberOfPages ?? 1);
      if (page >= totalPages || page >= MAX_PAGES) break;
      page += 1;
    }

    return listings;
  }

  async updateListing(externalListingId: string, input: UpdateListingInput): Promise<void> {
    const fields = [
      input.priceCents !== undefined ? `<StartPrice currencyID="USD">${(input.priceCents / 100).toFixed(2)}</StartPrice>` : '',
      input.quantityAvailable !== undefined ? `<Quantity>${input.quantityAvailable}</Quantity>` : '',
      input.title !== undefined ? `<Title>${escapeXml(input.title)}</Title>` : '',
    ].join('');
    if (!fields) return;

    await this.tradingApiRequest(
      'ReviseFixedPriceItem',
      `<Item><ItemID>${escapeXml(externalListingId)}</ItemID>${fields}</Item>`,
    );
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
