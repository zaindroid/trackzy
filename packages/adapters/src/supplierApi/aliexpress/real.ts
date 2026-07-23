import type {
  CreateSupplierApiOrderInput,
  CreateSupplierApiOrderResult,
  SupplierApiClient,
  SupplierOffer,
  SupplierProduct,
  SupplierTrackingResult,
} from '../iface.js';
import { TokenBucket, fetchWithBackoff } from '../../rateLimit.js';
import type { AliExpressEnv, AliExpressOnTokenRefreshed, AliExpressTokenSet } from './iface.js';
import { signAliExpressParams } from './sign.js';

const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 8, refillPerSecond: 2 });
}

/**
 * AliExpress Open Platform actually runs two different gateway families
 * (confirmed empirically against a live account, 2026-07 — see
 * DECISIONS.md): the `/sync` JSON-RPC-style gateway for `aliexpress.ds.*`
 * (Dropshipping) business methods per spec 6c, and separate `/rest/auth/
 * token/*` REST endpoints for the OAuth token lifecycle, which sign
 * differently (path-prefixed — see `sign.ts`'s docstring) and take GET query
 * params, not a POST body. Business-method names/response shapes below
 * still follow AliExpress's published Dropshipping API docs without
 * verification against a live account; TODO(HUMAN): confirm those once
 * you're placing real orders — see DEPLOY.md.
 *
 * `session` (the OAuth access token tied to the specific dropshipping
 * account these calls act on behalf of) is a required TOP system param for
 * account-scoped methods like `aliexpress.ds.order.create` — unlike
 * `app_key`/`app_secret` (this app's own identity), `session` identifies
 * *whose* dropshipping relationship the call executes under. A live
 * account's console showed a 1-day access token / 2-day refresh token, and —
 * confirmed by two live refresh calls returning an identical
 * `refresh_token_valid_time` each time — that refresh-token ceiling is fixed
 * from initial authorization, not extended on use. So `ensureFreshSession()`
 * below keeps the access token alive indefinitely as long as something
 * refreshes at least every ~2 days, but full re-authorization (DEPLOY.md
 * step 2) is unavoidable roughly every 2 days regardless — there is no way
 * to keep this supplier connected purely automatically long-term.
 */
export class RealAliExpressClient implements SupplierApiClient {
  private readonly bucket = newBucket();
  private tokens: AliExpressTokenSet;

  constructor(
    private readonly env: AliExpressEnv,
    tokens: AliExpressTokenSet,
    private readonly onTokenRefreshed: AliExpressOnTokenRefreshed,
  ) {
    this.tokens = tokens;
  }

  private gatewayUrl(): string {
    return this.env.ALIEXPRESS_GATEWAY_URL ?? 'https://api-sg.aliexpress.com/sync';
  }

  private restAuthBaseUrl(): string {
    return this.env.ALIEXPRESS_REST_BASE_URL ?? 'https://api-sg.aliexpress.com/rest';
  }

  private async ensureFreshSession(): Promise<string> {
    if (this.tokens.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) {
      return this.tokens.accessToken;
    }
    const path = '/auth/token/refresh';
    const params: Record<string, string> = {
      app_key: this.env.ALIEXPRESS_APP_KEY ?? '',
      timestamp: String(Date.now()),
      sign_method: 'sha256',
      refresh_token: this.tokens.refreshToken,
    };
    const sign = await signAliExpressParams(params, this.env.ALIEXPRESS_APP_SECRET ?? '', path);
    const qs = new URLSearchParams({ ...params, sign });
    const res = await fetchWithBackoff(`${this.restAuthBaseUrl()}${path}?${qs.toString()}`, { method: 'GET' }, this.bucket);
    if (!res.ok) {
      throw new Error(`AliExpress OAuth token refresh failed: ${res.status} ${await res.text()}`);
    }
    const json = (await res.json()) as { access_token: string; refresh_token: string; expire_time: number; code?: string; message?: string };
    if (json.code && json.code !== '0') {
      throw new Error(`AliExpress OAuth token refresh failed: ${json.code} ${json.message ?? ''}`);
    }
    this.tokens = {
      accessToken: json.access_token,
      refreshToken: json.refresh_token,
      expiresAt: json.expire_time,
    };
    await this.onTokenRefreshed(this.tokens);
    return this.tokens.accessToken;
  }

  private async call<T>(method: string, businessParams: Record<string, string>): Promise<T> {
    const session = await this.ensureFreshSession();
    const systemParams: Record<string, string> = {
      app_key: this.env.ALIEXPRESS_APP_KEY ?? '',
      method,
      timestamp: String(Date.now()),
      format: 'json',
      v: '2.0',
      sign_method: 'sha256',
      session,
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
