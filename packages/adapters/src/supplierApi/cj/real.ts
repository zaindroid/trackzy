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
 * CJ Dropshipping's REST API. `CJ-Access-Token` is obtained via
 * `POST /authentication/getAccessToken` with `{ "apiKey": "CJUserNum@api@..." }`
 * — a dashboard-generated key, not raw email/password (CJ's login endpoint
 * rejects email/password for accounts using apiKey mode, confirmed live —
 * see DECISIONS.md). This adapter takes the resulting access token as a
 * pre-obtained secret (`CJ_API_KEY`) rather than performing the exchange
 * itself; a live account's token was valid for ~6 months, comfortably long
 * enough that manual renewal (re-running the exchange, updating the secret)
 * is practical without needing the full auto-refresh machinery
 * eBay/Amazon/Gmail/AliExpress use, even though CJ does document a real
 * `/authentication/refreshAccessToken` endpoint if that's ever worth adding.
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
    // `productName` (searched here originally) is a genuinely different,
    // much narrower field than `productNameEn` — confirmed live: the same
    // query returned 672 matches via `productName` vs 30,685 via
    // `productNameEn`. Since this app's catalog/titles are English, the
    // English-name field is the correct one to search.
    const data = await this.request<{ list: { pid: string; productNameEn: string }[] }>(
      `/product/list?productNameEn=${encodeURIComponent(query)}&pageSize=10`,
    );
    return data.list.map((p) => ({ supplierProductId: p.pid, title: p.productNameEn }));
  }

  async getOffer(supplierProductId: string): Promise<SupplierOffer> {
    // Confirmed live: price/stock live per-variant (`data.variants[]` — a
    // product can have several color/size variants), not at the top level
    // as originally guessed; `sellPrice` alone does exist top-level but only
    // reflects one arbitrary variant, so `variantSellPrice` per-variant is
    // used instead for a real "cheapest available" comparison — same
    // aggregation approach as AliExpress's per-SKU getOffer. `inventoryNum`
    // was `null` (not `0`) for every variant on the one live product
    // checked — treated as "not tracked, assume available" rather than
    // "out of stock", since treating every untracked-inventory listing as
    // unavailable would incorrectly pause the majority of a real catalog.
    // No delivery-time field appears on this endpoint at all (`shipDays`
    // stays undefined); TODO(HUMAN): confirm whether it's only available via
    // the separate `/logistic/freightCalculate` endpoint mentioned below.
    const data = await this.request<{
      variants?: { variantSellPrice: number; inventoryNum: number | null }[];
    }>(`/product/query?pid=${encodeURIComponent(supplierProductId)}`);

    const variants = data.variants ?? [];
    const inStock = variants.length === 0 || variants.some((v) => v.inventoryNum === null || v.inventoryNum > 0);
    const cheapest = variants.reduce<number | undefined>(
      (min, v) => (min === undefined || v.variantSellPrice < min ? v.variantSellPrice : min),
      undefined,
    );

    return {
      costCents: cheapest !== undefined ? Math.round(cheapest * 100) : 0,
      shippingCents: 0, // resolved separately via /logistic/freightCalculate when needed
      inStock,
      shipDays: undefined,
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
