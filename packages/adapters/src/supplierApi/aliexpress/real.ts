import type {
  CreateSupplierApiOrderInput,
  CreateSupplierApiOrderResult,
  SupplierApiClient,
  SupplierOffer,
  SupplierProduct,
  SupplierTrackingResult,
} from '../iface.js';
import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { AliExpressEnv } from './iface.js';
import { signAliExpressParams } from './sign.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 8, refillPerSecond: 2 });
}

/**
 * AliExpress Open Platform — single-gateway TOP-style API (one endpoint,
 * `method` + signed params, not per-resource REST paths), using the
 * `aliexpress.ds.*` (Dropshipping) method namespace per spec 6c. Method names
 * and response field shapes follow AliExpress's published Dropshipping API
 * docs; TODO(HUMAN): verify against a live Open Platform app once
 * registered — see DEPLOY.md.
 *
 * `session` (the OAuth access token tied to the specific dropshipping
 * account these calls act on behalf of) is a required TOP system param for
 * account-scoped methods like `aliexpress.ds.order.create` — unlike
 * `app_key`/`app_secret` (this app's own identity), `session` identifies
 * *whose* dropshipping relationship the call executes under. It's read here
 * as a static, pre-obtained secret (`ALIEXPRESS_ACCESS_TOKEN`), the same
 * "acquired once, out-of-band" shape as CJ's `CJ_API_KEY` — not a
 * self-refreshing OAuth token set like eBay/Amazon/Gmail. TODO(HUMAN):
 * confirm this account's actual token lifetime once registered and, if it's
 * short-lived enough to need automatic refresh, extend this to the
 * OAuthTokenSet + refresh-callback pattern those adapters use.
 */
export class RealAliExpressClient implements SupplierApiClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: AliExpressEnv) {}

  private gatewayUrl(): string {
    return this.env.ALIEXPRESS_GATEWAY_URL ?? 'https://api-sg.aliexpress.com/sync';
  }

  private async call<T>(method: string, businessParams: Record<string, string>): Promise<T> {
    const systemParams: Record<string, string> = {
      app_key: this.env.ALIEXPRESS_APP_KEY ?? '',
      method,
      timestamp: String(Date.now()),
      format: 'json',
      v: '2.0',
      sign_method: 'sha256',
      ...(this.env.ALIEXPRESS_ACCESS_TOKEN ? { session: this.env.ALIEXPRESS_ACCESS_TOKEN } : {}),
    };
    const allParams = { ...systemParams, ...businessParams };
    const sign = await signAliExpressParams(allParams, this.env.ALIEXPRESS_APP_SECRET ?? '');

    const body = new URLSearchParams({ ...allParams, sign });
    const res = await fetchWithBackoff(
      this.gatewayUrl(),
      { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`AliExpress API call ${method} failed: ${res.status} ${await res.text()}`);
    }
    return (await res.json()) as T;
  }

  async searchProduct(query: string): Promise<SupplierProduct[]> {
    const data = await this.call<{ ds_text_search_response: { data: { products: { product_id: string; subject: string }[] } } }>(
      'aliexpress.ds.text.search',
      { text: query, page_size: '10' },
    );
    return data.ds_text_search_response.data.products.map((p) => ({ supplierProductId: p.product_id, title: p.subject }));
  }

  async getOffer(supplierProductId: string): Promise<SupplierOffer> {
    const data = await this.call<{
      ds_product_get_response: {
        result: {
          ae_item_base_info_dto: { sale_price: string };
          ae_item_sku_info_dtos?: { sku_stock: boolean }[];
          logistics_info_dto?: { delivery_time?: string };
        };
      };
    }>('aliexpress.ds.product.get', { product_id: supplierProductId });

    const result = data.ds_product_get_response.result;
    const inStock = result.ae_item_sku_info_dtos?.some((sku) => sku.sku_stock) ?? true;
    const shipDays = result.logistics_info_dto?.delivery_time
      ? Number.parseFloat(result.logistics_info_dto.delivery_time)
      : undefined;

    return {
      costCents: Math.round(Number.parseFloat(result.ae_item_base_info_dto.sale_price) * 100),
      shippingCents: 0, // resolved separately via aliexpress.logistics.buyer.freight.calculate when needed
      inStock,
      shipDays,
    };
  }

  async createOrder(input: CreateSupplierApiOrderInput): Promise<CreateSupplierApiOrderResult> {
    const data = await this.call<{ ds_order_create_response: { result: { order_id: string } } }>(
      'aliexpress.ds.order.create',
      {
        product_items: JSON.stringify([{ product_id: input.supplierProductId, product_count: input.quantity }]),
        logistics_address: JSON.stringify({
          contact_person: input.shipTo.name,
          address: input.shipTo.address1,
          address2: input.shipTo.address2,
          city: input.shipTo.city,
          province: input.shipTo.state,
          zip: input.shipTo.zip,
          country: input.shipTo.country,
        }),
      },
    );
    return { supplierOrderRef: data.ds_order_create_response.result.order_id };
  }

  async getTracking(supplierOrderRef: string): Promise<SupplierTrackingResult> {
    const data = await this.call<{
      ds_trade_order_get_response: {
        result: { logistics_status?: string; logistics_no?: string; logistics_company?: string };
      };
    }>('aliexpress.ds.trade.order.get', { order_id: supplierOrderRef });

    const result = data.ds_trade_order_get_response.result;
    return {
      trackingNumber: result.logistics_no ?? null,
      carrier: result.logistics_company ?? null,
      status: result.logistics_status ?? null,
    };
  }
}
