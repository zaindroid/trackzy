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
    // countryCode/currency/local are genuinely required — confirmed against
    // a live account, each surfacing its own MissingParameter error in turn
    // until all three were supplied. Response envelope is
    // `aliexpress_ds_text_search_response` (the `aliexpress_` prefix on
    // every ds.* response, not just `ds_..._response` as first guessed —
    // also confirmed live), with results nested under
    // `data.products.selection_search_product`, not `data.products`
    // directly. TODO(HUMAN): make country/currency/locale configurable
    // per-listing/storefront if you dropship to multiple markets with
    // materially different catalogs/pricing.
    const data = await this.call<{
      aliexpress_ds_text_search_response: {
        data: { products: { selection_search_product?: { itemId: string; title: string }[] } };
      };
    }>('aliexpress.ds.text.search', {
      text: query,
      page_size: '10',
      countryCode: this.env.ALIEXPRESS_DEFAULT_COUNTRY_CODE ?? 'US',
      currency: this.env.ALIEXPRESS_DEFAULT_CURRENCY ?? 'USD',
      local: this.env.ALIEXPRESS_DEFAULT_LOCALE ?? 'en_US',
    });
    const products = data.aliexpress_ds_text_search_response.data.products.selection_search_product ?? [];
    return products.map((p) => ({ supplierProductId: p.itemId, title: p.title }));
  }

  async getOffer(supplierProductId: string): Promise<SupplierOffer> {
    // Confirmed live: price/stock live per-SKU (a product can have several —
    // color/size variants), not on ae_item_base_info_dto as first guessed;
    // this picks the cheapest in-stock SKU as "the" offer. Response envelope
    // is `aliexpress_ds_product_get_response` (same prefix correction as
    // searchProduct above); logistics_info_dto.delivery_time matched the
    // original guess.
    const data = await this.call<{
      aliexpress_ds_product_get_response: {
        result: {
          ae_item_sku_info_dtos?: { ae_item_sku_info_d_t_o?: { sku_price: string; sku_available_stock: number }[] };
          logistics_info_dto?: { delivery_time?: number };
        };
      };
    }>('aliexpress.ds.product.get', {
      product_id: supplierProductId,
      ship_to_country: this.env.ALIEXPRESS_DEFAULT_COUNTRY_CODE ?? 'US',
      target_currency: this.env.ALIEXPRESS_DEFAULT_CURRENCY ?? 'USD',
      target_language: this.env.ALIEXPRESS_DEFAULT_LANGUAGE ?? 'en',
    });

    const result = data.aliexpress_ds_product_get_response.result;
    const skus = result.ae_item_sku_info_dtos?.ae_item_sku_info_d_t_o ?? [];
    const inStock = skus.some((sku) => sku.sku_available_stock > 0);
    const cheapest = skus.reduce<number | undefined>((min, sku) => {
      const price = Number.parseFloat(sku.sku_price);
      return min === undefined || price < min ? price : min;
    }, undefined);

    return {
      costCents: cheapest !== undefined ? Math.round(cheapest * 100) : 0,
      shippingCents: 0, // resolved separately via aliexpress.logistics.buyer.freight.calculate when needed
      inStock,
      shipDays: result.logistics_info_dto?.delivery_time,
    };
  }

  async createOrder(input: CreateSupplierApiOrderInput): Promise<CreateSupplierApiOrderResult> {
    // TODO(HUMAN): unlike searchProduct/getOffer above, this call was never
    // exercised live (it places a real, billable order) — only the
    // `aliexpress_` response-envelope prefix correction (confirmed
    // consistent across every ds.* method actually tested) was applied here;
    // the field names within `result` are still an unverified guess.
    const data = await this.call<{ aliexpress_ds_order_create_response: { result: { order_id: string } } }>(
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
    return { supplierOrderRef: data.aliexpress_ds_order_create_response.result.order_id };
  }

  async getTracking(supplierOrderRef: string): Promise<SupplierTrackingResult> {
    // TODO(HUMAN): same caveat as createOrder above — envelope prefix fixed
    // by the now-confirmed convention, but the inner field names are unverified.
    const data = await this.call<{
      aliexpress_ds_trade_order_get_response: {
        result: { logistics_status?: string; logistics_no?: string; logistics_company?: string };
      };
    }>('aliexpress.ds.trade.order.get', { order_id: supplierOrderRef });

    const result = data.aliexpress_ds_trade_order_get_response.result;
    return {
      trackingNumber: result.logistics_no ?? null,
      carrier: result.logistics_company ?? null,
      status: result.logistics_status ?? null,
    };
  }
}
