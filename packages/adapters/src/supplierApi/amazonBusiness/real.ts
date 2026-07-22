import type {
  CreateSupplierApiOrderInput,
  CreateSupplierApiOrderResult,
  SupplierApiClient,
  SupplierOffer,
  SupplierProduct,
  SupplierTrackingResult,
} from '../iface.js';
import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { AmazonBusinessEnv } from './iface.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 5, refillPerSecond: 2 });
}

/**
 * Amazon Business Ordering API: fully automated synchronous checkout for B2B
 * accounts (spec 6a) — this is a narrower, less publicly documented surface
 * than SP-API, generally requiring an enrolled Amazon Business account and a
 * private integration agreement. Endpoint shapes here follow the general
 * request/response conventions Amazon Business integrations use elsewhere
 * (API-key bearer auth, JSON REST); TODO(HUMAN): verify the exact paths and
 * payload shapes against your account's actual API documentation once
 * enrolled — see DEPLOY.md.
 */
export class RealAmazonBusinessClient implements SupplierApiClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: AmazonBusinessEnv) {}

  private baseUrl(): string {
    return this.env.AMAZON_BUSINESS_BASE_URL ?? 'https://api.business.amazon.com';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchWithBackoff(
      `${this.baseUrl()}${path}`,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.env.AMAZON_BUSINESS_API_KEY ?? ''}`,
          ...init?.headers,
        },
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Amazon Business API request to ${path} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async searchProduct(query: string): Promise<SupplierProduct[]> {
    const data = await this.request<{ results: { asin: string; title: string }[] }>(
      `/v1/products/search?keywords=${encodeURIComponent(query)}`,
    );
    return data.results.map((r) => ({ supplierProductId: r.asin, title: r.title }));
  }

  async getOffer(supplierProductId: string): Promise<SupplierOffer> {
    const data = await this.request<{ price: { amount: number }; shipping: { amount: number }; availability: { inStock: boolean; leadTimeDays?: number } }>(
      `/v1/products/${encodeURIComponent(supplierProductId)}/offer`,
    );
    return {
      costCents: Math.round(data.price.amount * 100),
      shippingCents: Math.round(data.shipping.amount * 100),
      inStock: data.availability.inStock,
      shipDays: data.availability.leadTimeDays,
    };
  }

  async createOrder(input: CreateSupplierApiOrderInput): Promise<CreateSupplierApiOrderResult> {
    const data = await this.request<{ orderId: string }>('/v1/orders', {
      method: 'POST',
      body: JSON.stringify({
        items: [{ asin: input.supplierProductId, quantity: input.quantity }],
        shipToAddress: {
          name: input.shipTo.name,
          addressLine1: input.shipTo.address1,
          addressLine2: input.shipTo.address2,
          city: input.shipTo.city,
          stateOrRegion: input.shipTo.state,
          postalCode: input.shipTo.zip,
          countryCode: input.shipTo.country,
        },
      }),
    });
    return { supplierOrderRef: data.orderId };
  }

  async getTracking(supplierOrderRef: string): Promise<SupplierTrackingResult> {
    const data = await this.request<{ trackingNumber?: string; carrier?: string; status?: string }>(
      `/v1/orders/${encodeURIComponent(supplierOrderRef)}/tracking`,
    );
    return {
      trackingNumber: data.trackingNumber ?? null,
      carrier: data.carrier ?? null,
      status: data.status ?? null,
    };
  }
}
