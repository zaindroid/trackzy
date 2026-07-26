import { describe, expect, it, vi } from 'vitest';
import { RealAliExpressClient, refreshAliExpressSessionIfStale } from './real.js';
import type { AliExpressTokenSet } from './iface.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ENV = { ALIEXPRESS_APP_KEY: 'app-key-1', ALIEXPRESS_APP_SECRET: 'app-secret-1' };

describe('RealAliExpressClient — session param', () => {
  it('includes session (the account-scoped OAuth token) in the signed request body when the token is still fresh', async () => {
    let capturedBody: URLSearchParams | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = new URLSearchParams(init?.body as string);
        return jsonResponse({ aliexpress_ds_text_search_response: { data: { products: {} } } });
      }),
    );

    const freshTokens: AliExpressTokenSet = { accessToken: 'session-token-xyz', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 };
    const client = new RealAliExpressClient(ENV, freshTokens, async () => undefined);
    await client.searchProduct('widget');

    expect(capturedBody?.get('session')).toBe('session-token-xyz');
    vi.unstubAllGlobals();
  });
});

describe('RealAliExpressClient — token refresh', () => {
  it('refreshes an expired session token via the REST auth endpoint (GET, path-prefixed signature — see sign.ts) before the request, and reports the new tokens via onTokenRefreshed', async () => {
    const EXPIRED_TOKENS: AliExpressTokenSet = { accessToken: 'stale-session', refreshToken: 'refresh-1', expiresAt: Date.now() - 1000 };
    let refreshUrl: string | undefined;
    let searchBody: URLSearchParams | undefined;
    let refreshedArg: AliExpressTokenSet | undefined;
    const freshExpiry = Date.now() + 86_400_000;

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/auth/token/refresh')) {
          refreshUrl = url;
          return jsonResponse({ access_token: 'fresh-session', refresh_token: 'fresh-refresh', expire_time: freshExpiry, code: '0' });
        }
        searchBody = new URLSearchParams(init?.body as string);
        return jsonResponse({ aliexpress_ds_text_search_response: { data: { products: {} } } });
      }),
    );

    const client = new RealAliExpressClient(ENV, EXPIRED_TOKENS, async (refreshed) => {
      refreshedArg = refreshed;
    });
    await client.searchProduct('widget');

    // Refresh hit the dedicated REST endpoint (a GET with query params), not the /sync gateway.
    expect(refreshUrl).toContain('/rest/auth/token/refresh');
    expect(refreshUrl).toContain('refresh_token=refresh-1');
    // The actual search request used the newly-refreshed token, not the stale one passed in.
    expect(searchBody?.get('session')).toBe('fresh-session');
    // onTokenRefreshed carries the real new token values — a caller that only
    // persisted expiry (the exact bug already fixed for Gmail/storefronts)
    // would silently keep serving the stale session on every later call.
    expect(refreshedArg?.accessToken).toBe('fresh-session');
    expect(refreshedArg?.refreshToken).toBe('fresh-refresh');
    expect(refreshedArg?.expiresAt).toBe(freshExpiry);
    vi.unstubAllGlobals();
  });

  it('throws with the AliExpress error code/message when the refresh call itself reports failure (e.g. an expired refresh token)', async () => {
    const EXPIRED_TOKENS: AliExpressTokenSet = { accessToken: 'stale-session', refreshToken: 'expired-refresh', expiresAt: Date.now() - 1000 };
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse({ code: 'InvalidRefreshToken', message: 'refresh token expired' })),
    );

    const client = new RealAliExpressClient(ENV, EXPIRED_TOKENS, async () => undefined);
    await expect(client.searchProduct('widget')).rejects.toThrow(/InvalidRefreshToken/);
    vi.unstubAllGlobals();
  });
});

describe('refreshAliExpressSessionIfStale — keepalive cron entry point', () => {
  it('refreshes and reports the new tokens when within the given (wide) margin of expiry, even though it would still pass a tight 5-min margin check', async () => {
    // Expires in 10 hours — well outside ensureFreshSession's 5-min margin,
    // but within a 12-hour keepalive margin, which is the whole point.
    const tokens: AliExpressTokenSet = { accessToken: 'stale-ish', refreshToken: 'refresh-1', expiresAt: Date.now() + 10 * 3600_000 };
    let refreshUrl: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        refreshUrl = String(input);
        return jsonResponse({ access_token: 'kept-alive-token', refresh_token: 'kept-alive-refresh', expire_time: Date.now() + 86_400_000, code: '0' });
      }),
    );

    let onRefreshedArg: AliExpressTokenSet | undefined;
    const didRefresh = await refreshAliExpressSessionIfStale(ENV, tokens, async (t) => {
      onRefreshedArg = t;
    }, 12 * 3600_000);

    expect(didRefresh).toBe(true);
    expect(refreshUrl).toContain('/rest/auth/token/refresh');
    expect(onRefreshedArg?.accessToken).toBe('kept-alive-token');
    vi.unstubAllGlobals();
  });

  it('does nothing (no network call) when the token is not yet within the margin', async () => {
    const tokens: AliExpressTokenSet = { accessToken: 'fine-for-now', refreshToken: 'refresh-1', expiresAt: Date.now() + 20 * 3600_000 };
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);

    const didRefresh = await refreshAliExpressSessionIfStale(ENV, tokens, async () => undefined, 12 * 3600_000);

    expect(didRefresh).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});

const FRESH_TOKENS: AliExpressTokenSet = { accessToken: 'session-token', refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 };

describe('RealAliExpressClient — searchProduct (real response shape, confirmed live)', () => {
  it('sends the required countryCode/currency/local params and parses selection_search_product into SupplierProduct[]', async () => {
    let capturedBody: URLSearchParams | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = new URLSearchParams(init?.body as string);
        return jsonResponse({
          aliexpress_ds_text_search_response: {
            data: { products: { selection_search_product: [{ itemId: '1005007498036927', title: 'Widget' }] } },
          },
        });
      }),
    );

    const client = new RealAliExpressClient(ENV, FRESH_TOKENS, async () => undefined);
    const results = await client.searchProduct('widget');

    expect(capturedBody?.get('countryCode')).toBe('US');
    expect(capturedBody?.get('currency')).toBe('USD');
    expect(capturedBody?.get('local')).toBe('en_US');
    expect(results).toEqual([
      {
        supplierProductId: '1005007498036927',
        title: 'Widget',
        imageUrl: undefined,
        productUrl: 'https://www.aliexpress.com/item/1005007498036927.html',
      },
    ]);
    vi.unstubAllGlobals();
  });

  it('returns an empty array (not a crash) when selection_search_product is absent — a real zero-result response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ aliexpress_ds_text_search_response: { data: { products: {} } } })));
    const client = new RealAliExpressClient(ENV, FRESH_TOKENS, async () => undefined);
    await expect(client.searchProduct('nonexistent')).resolves.toEqual([]);
    vi.unstubAllGlobals();
  });
});

describe('RealAliExpressClient — getOffer (real response shape, confirmed live)', () => {
  it('picks the cheapest in-stock SKU as the offer price, and reports inStock when any SKU has stock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          aliexpress_ds_product_get_response: {
            result: {
              ae_item_sku_info_dtos: {
                ae_item_sku_info_d_t_o: [
                  { sku_price: '39.98', sku_available_stock: 11 },
                  { sku_price: '29.98', sku_available_stock: 13 },
                  { sku_price: '35.98', sku_available_stock: 0 },
                ],
              },
              logistics_info_dto: { delivery_time: 7 },
            },
          },
        }),
      ),
    );

    const client = new RealAliExpressClient(ENV, FRESH_TOKENS, async () => undefined);
    const offer = await client.getOffer('1005007498036927');

    expect(offer.costCents).toBe(2998); // the cheapest SKU, not the first one
    expect(offer.inStock).toBe(true);
    expect(offer.shipDays).toBe(7);
    vi.unstubAllGlobals();
  });

  it('reports inStock=false when every SKU is out of stock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          aliexpress_ds_product_get_response: {
            result: { ae_item_sku_info_dtos: { ae_item_sku_info_d_t_o: [{ sku_price: '10.00', sku_available_stock: 0 }] } },
          },
        }),
      ),
    );

    const client = new RealAliExpressClient(ENV, FRESH_TOKENS, async () => undefined);
    const offer = await client.getOffer('some-id');
    expect(offer.inStock).toBe(false);
    vi.unstubAllGlobals();
  });
});
