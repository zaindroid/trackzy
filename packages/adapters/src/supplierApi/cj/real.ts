import type {
  CreateSupplierApiOrderInput,
  CreateSupplierApiOrderResult,
  SupplierApiClient,
  SupplierOffer,
  SupplierProduct,
  SupplierTrackingResult,
} from '../iface.js';
import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { CjEnv } from './iface.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 6, refillPerSecond: 1 });
}

/**
 * CJ Dropshipping's REST API. Unlike eBay/Amazon's short-lived OAuth tokens,
 * CJ's `CJ-Access-Token` is obtained once via a login call (email + password)
 * and is valid for an extended period (CJ's docs describe ~15 days) — this
 * adapter takes it as a pre-obtained value (`CJ_API_KEY`) rather than
 * performing the login handshake itself, so the sensitive account password
 * never needs to pass through this Worker at request time. TODO(HUMAN):
 * obtain the token via CJ's `/authentication/getAccessToken` endpoint once
 * and set it as a secret, refreshing manually before it expires — see
 * DEPLOY.md.
 */
export class RealCjClient implements SupplierApiClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: CjEnv) {}

  private baseUrl(): string {
    return this.env.CJ_BASE_URL ?? 'https://developers.cjdropshipping.com/api2.0/v1';
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetchWithBackoff(
      `${this.baseUrl()}${path}`,
      {
        ...init,
        headers: {
          'Content-Type': 'application/json',
          'CJ-Access-Token': this.env.CJ_API_KEY ?? '',
          ...init?.headers,
        },
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`CJ Dropshipping API request to ${path} failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { result: boolean; message?: string; data: T };
    if (!json.result) {
      throw new Error(`CJ Dropshipping API request to ${path} returned an error: ${json.message ?? 'unknown error'}`);
    }
    return json.data;
  }

  async searchProduct(query: string): Promise<SupplierProduct[]> {
    const data = await this.request<{ list: { pid: string; productNameEn: string }[] }>(
      `/product/list?productName=${encodeURIComponent(query)}&pageSize=10`,
    );
    return data.list.map((p) => ({ supplierProductId: p.pid, title: p.productNameEn }));
  }

  async getOffer(supplierProductId: string): Promise<SupplierOffer> {
    const data = await this.request<{ sellPrice: string; inventoryNum?: number; deliveryTime?: string }>(
      `/product/query?pid=${encodeURIComponent(supplierProductId)}`,
    );
    return {
      costCents: Math.round(Number.parseFloat(data.sellPrice) * 100),
      shippingCents: 0, // resolved separately via /logistic/freightCalculate when needed
      inStock: (data.inventoryNum ?? 0) > 0,
      shipDays: data.deliveryTime ? Number.parseFloat(data.deliveryTime) : undefined,
    };
  }

  async createOrder(input: CreateSupplierApiOrderInput): Promise<CreateSupplierApiOrderResult> {
    const data = await this.request<{ orderId: string }>('/shopping/order/createOrder', {
      method: 'POST',
      body: JSON.stringify({
        products: [{ pid: input.supplierProductId, quantity: input.quantity }],
        shippingAddress: {
          name: input.shipTo.name,
          address: input.shipTo.address1,
          address2: input.shipTo.address2,
          city: input.shipTo.city,
          province: input.shipTo.state,
          zip: input.shipTo.zip,
          country: input.shipTo.country,
        },
      }),
    });
    return { supplierOrderRef: data.orderId };
  }

  async getTracking(supplierOrderRef: string): Promise<SupplierTrackingResult> {
    const data = await this.request<{ trackNumber?: string; logisticName?: string; orderStatus?: string }>(
      `/shopping/order/getOrderDetail?orderId=${encodeURIComponent(supplierOrderRef)}`,
    );
    return {
      trackingNumber: data.trackNumber ?? null,
      carrier: data.logisticName ?? null,
      status: data.orderStatus ?? null,
    };
  }
}
