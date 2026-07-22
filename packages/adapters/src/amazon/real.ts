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
import type { AmazonEnv } from './iface.js';

const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

// SP-API's Orders API rate limit is commonly 0.5-1 req/s per published usage
// plans; kept conservative here. TODO(HUMAN): tune against your app's actual
// SP-API rate-limit entitlement once registered (see DEPLOY.md).
function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 5, refillPerSecond: 1 });
}

interface SpApiOrder {
  AmazonOrderId: string;
  PurchaseDate: string;
  OrderTotal?: { Amount: string; CurrencyCode: string };
}

interface SpApiOrderItem {
  OrderItemId: string;
  SellerSKU?: string;
  Title: string;
  QuantityOrdered: number;
  ItemPrice?: { Amount: string };
}

interface SpApiAddress {
  Name?: string;
  AddressLine1?: string;
  AddressLine2?: string;
  City?: string;
  StateOrRegion?: string;
  PostalCode?: string;
  CountryCode?: string;
}

/**
 * Amazon Selling Partner API — LWA (Login with Amazon) OAuth2 for the base
 * access token, plus a per-request Restricted Data Token (RDT) whenever PII
 * (the buyer's shipping address) is read, per spec 5b. Endpoint shapes follow
 * SP-API's published REST structure; TODO(HUMAN) in DEPLOY.md flags verifying
 * exact request/response fields against a live SP-API developer account,
 * same caveat as every other real adapter built without one.
 *
 * Simplification: modern SP-API self-authorized apps (the common case for a
 * single-seller integration like this one) authenticate with the LWA access
 * token alone via the `x-amz-access-token` header — full AWS SigV4 request
 * signing, required for older MWS-compatibility endpoints, is not
 * implemented here since none of the endpoints this adapter calls need it.
 */
export class RealAmazonOrderSource implements OrderSource {
  private readonly bucket = newBucket();
  private tokens: OAuthTokenSet;

  constructor(
    private readonly env: AmazonEnv,
    tokens: OAuthTokenSet,
    private readonly onTokenRefreshed: OnTokenRefreshed,
  ) {
    this.tokens = tokens;
  }

  private baseUrl(): string {
    return this.env.AMAZON_SP_API_BASE_URL ?? 'https://sellingpartnerapi-na.amazon.com';
  }

  private marketplaceId(): string {
    return this.env.AMAZON_MARKETPLACE_ID ?? 'ATVPDKIKX0DER';
  }

  private async ensureFreshToken(): Promise<string> {
    if (this.tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.tokens.accessToken;
    }
    const res = await fetchWithBackoff(
      'https://api.amazon.com/auth/o2/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: this.tokens.refreshToken,
          client_id: this.env.AMAZON_LWA_CLIENT_ID ?? '',
          client_secret: this.env.AMAZON_LWA_CLIENT_SECRET ?? '',
        }),
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Amazon LWA token refresh failed: ${res.status} ${await res.text()}`);
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

  private async request<T>(path: string, init?: RequestInit, accessTokenOverride?: string): Promise<T> {
    const accessToken = accessTokenOverride ?? (await this.ensureFreshToken());
    const res = await fetchWithBackoff(
      `${this.baseUrl()}${path}`,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'x-amz-access-token': accessToken,
          ...init?.headers,
        },
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Amazon SP-API request to ${path} failed: ${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  /**
   * Requests a Restricted Data Token scoped to exactly the address endpoint
   * for one order, then uses that RDT (not the regular access token) to
   * fetch the buyer's shipping address. Mandatory per spec 5b for any PII
   * read — never fetch an address with the plain LWA access token.
   */
  private async fetchShippingAddress(orderId: string): Promise<SpApiAddress | undefined> {
    const addressPath = `/orders/v0/orders/${orderId}/address`;
    const rdtResponse = await this.request<{ restrictedDataToken: string }>('/tokens/2021-03-01/restrictedDataToken', {
      method: 'POST',
      body: JSON.stringify({
        restrictedResources: [{ method: 'GET', path: addressPath, dataElements: ['buyerInfo', 'shippingAddress'] }],
      }),
    });
    try {
      const data = await this.request<{ payload: { ShippingAddress?: SpApiAddress } }>(
        addressPath,
        undefined,
        rdtResponse.restrictedDataToken,
      );
      return data.payload.ShippingAddress;
    } catch {
      return undefined;
    }
  }

  private async mapOrder(o: SpApiOrder): Promise<OrderSourceOrder> {
    const itemsData = await this.request<{ payload: { OrderItems: SpApiOrderItem[] } }>(
      `/orders/v0/orders/${o.AmazonOrderId}/orderItems`,
    );
    const address = await this.fetchShippingAddress(o.AmazonOrderId);

    return {
      externalOrderId: o.AmazonOrderId,
      externalOrderNumber: o.AmazonOrderId,
      currency: o.OrderTotal?.CurrencyCode ?? 'USD',
      subtotalCents: Math.round(Number.parseFloat(o.OrderTotal?.Amount ?? '0') * 100),
      shippingCents: 0, // SP-API reports shipping at the line-item level; omitted for brevity
      lineItems: itemsData.payload.OrderItems.map((li) => ({
        externalLineItemId: li.OrderItemId,
        sku: li.SellerSKU ?? '',
        title: li.Title,
        quantity: li.QuantityOrdered,
        unitPriceCents: Math.round(Number.parseFloat(li.ItemPrice?.Amount ?? '0') * 100),
      })),
      shipTo: address
        ? {
            name: address.Name ?? '',
            address1: address.AddressLine1 ?? '',
            address2: address.AddressLine2,
            city: address.City ?? '',
            state: address.StateOrRegion ?? '',
            zip: address.PostalCode ?? '',
            country: address.CountryCode ?? '',
          }
        : undefined,
    };
  }

  async listNewOrders(since: number): Promise<OrderSourceOrder[]> {
    const sinceIso = new Date(since).toISOString();
    const data = await this.request<{ payload: { Orders: SpApiOrder[] } }>(
      `/orders/v0/orders?MarketplaceIds=${this.marketplaceId()}&LastUpdatedAfter=${encodeURIComponent(sinceIso)}`,
    );
    return Promise.all(data.payload.Orders.map((o) => this.mapOrder(o)));
  }

  async getOrder(externalOrderId: string): Promise<OrderSourceOrder | null> {
    try {
      const data = await this.request<{ payload: SpApiOrder }>(`/orders/v0/orders/${externalOrderId}`);
      return this.mapOrder(data.payload);
    } catch {
      return null;
    }
  }

  /**
   * Amazon has no synchronous tracking-push call — fulfillment confirmation
   * goes through the async Feeds API: upload a POST_ORDER_FULFILLMENT_DATA
   * document, then submit a feed referencing it. This only submits the feed;
   * it does not poll for processing completion (that would be slow-path work
   * and belongs in a Workflow, not this adapter call, per the hard rule that
   * slow work never happens in a request path).
   */
  async pushTracking(externalOrderId: string, input: PushTrackingInput): Promise<void> {
    const feedContent = buildOrderFulfillmentFeedXml(externalOrderId, input);
    const doc = await this.request<{ feedDocumentId: string; url: string }>('/feeds/2021-06-30/documents', {
      method: 'POST',
      body: JSON.stringify({ contentType: 'text/xml; charset=UTF-8' }),
    });
    const uploadRes = await fetchWithBackoff(
      doc.url,
      { method: 'PUT', headers: { 'Content-Type': 'text/xml; charset=UTF-8' }, body: feedContent },
      this.bucket,
    );
    if (!uploadRes.ok) {
      throw new Error(`Amazon feed document upload failed: ${uploadRes.status} ${await uploadRes.text()}`);
    }
    await this.request('/feeds/2021-06-30/feeds', {
      method: 'POST',
      body: JSON.stringify({
        feedType: 'POST_ORDER_FULFILLMENT_DATA',
        marketplaceIds: [this.marketplaceId()],
        inputFeedDocumentId: doc.feedDocumentId,
      }),
    });
  }

  async sendBuyerMessage(externalOrderId: string, body: string): Promise<void> {
    // SP-API's Messaging API only allows a fixed set of templated actions
    // (anti-spam policy) rather than arbitrary free text. `unexpectedProblem`
    // is the closest general-purpose template for shipping-status updates;
    // TODO(HUMAN): classify message content into the correct action
    // (confirmOrderDetails / warranty / etc.) before relying on this in
    // production — see DEPLOY.md.
    await this.request(`/messaging/v1/orders/${externalOrderId}/messages/unexpectedProblem`, {
      method: 'POST',
      body: JSON.stringify({ marketplaceIds: [this.marketplaceId()], text: body }),
    });
  }

  async listListings(): Promise<OrderSourceListing[]> {
    const data = await this.request<{
      items: {
        sku: string;
        summaries?: { itemName?: string }[];
        attributes?: {
          purchasable_offer?: { our_price?: { schedule?: { value_with_tax?: number }[] }[] }[];
          fulfillment_availability?: { quantity?: number }[];
        };
      }[];
    }>(`/listings/2021-08-01/items/${this.env.AMAZON_SELLER_ID ?? ''}?marketplaceIds=${this.marketplaceId()}&pageSize=20`);

    return data.items.map((item) => ({
      externalListingId: item.sku,
      sku: item.sku,
      title: item.summaries?.[0]?.itemName ?? item.sku,
      priceCents: Math.round(
        (item.attributes?.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax ?? 0) * 100,
      ),
      quantityAvailable: item.attributes?.fulfillment_availability?.[0]?.quantity ?? 0,
    }));
  }

  async updateListing(externalListingId: string, input: UpdateListingInput): Promise<void> {
    const patches: { op: string; path: string; value: unknown }[] = [];
    if (input.priceCents !== undefined) {
      patches.push({
        op: 'replace',
        path: '/attributes/purchasable_offer',
        value: [{ our_price: [{ schedule: [{ value_with_tax: input.priceCents / 100 }] }] }],
      });
    }
    if (input.quantityAvailable !== undefined) {
      patches.push({
        op: 'replace',
        path: '/attributes/fulfillment_availability',
        value: [{ quantity: input.quantityAvailable }],
      });
    }
    if (patches.length === 0) return;
    await this.request(
      `/listings/2021-08-01/items/${this.env.AMAZON_SELLER_ID ?? ''}/${encodeURIComponent(externalListingId)}?marketplaceIds=${this.marketplaceId()}`,
      { method: 'PATCH', body: JSON.stringify({ productType: 'PRODUCT', patches }) },
    );
  }

  async pauseListing(externalListingId: string): Promise<void> {
    await this.updateListing(externalListingId, { quantityAvailable: 0 });
  }
}

function buildOrderFulfillmentFeedXml(orderId: string, input: PushTrackingInput): string {
  const itemLines = (input.lineItemIds ?? [])
    .map((id) => `<Item><AmazonOrderItemCode>${escapeXml(id)}</AmazonOrderItemCode></Item>`)
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<AmazonEnvelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:noNamespaceSchemaLocation="amzn-envelope.xsd">
  <Header><DocumentVersion>1.01</DocumentVersion></Header>
  <MessageType>OrderFulfillment</MessageType>
  <Message>
    <MessageID>1</MessageID>
    <OrderFulfillment>
      <AmazonOrderID>${escapeXml(orderId)}</AmazonOrderID>
      <FulfillmentDate>${new Date().toISOString()}</FulfillmentDate>
      <FulfillmentData>
        <CarrierCode>${escapeXml(input.carrier)}</CarrierCode>
        <ShippingMethod>Standard</ShippingMethod>
        <ShipperTrackingNumber>${escapeXml(input.trackingNumber)}</ShipperTrackingNumber>
      </FulfillmentData>
      ${itemLines}
    </OrderFulfillment>
  </Message>
</AmazonEnvelope>`;
}

function escapeXml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
