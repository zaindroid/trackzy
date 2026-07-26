import type { AliexpressDsClient, AliexpressDsEnv, AliexpressDsProduct } from './iface.js';

const REST_GATEWAY = 'https://api-sg.aliexpress.com/rest';
const SYNC_GATEWAY = 'https://api-sg.aliexpress.com/sync';
const REFRESH_MARGIN_MS = 5 * 60_000;

// HMAC-SHA256 (Workers-native Web Crypto) → uppercase hex.
async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('').toUpperCase();
}

function toCents(v: unknown): number {
  if (v == null) return 0;
  const m = String(v).match(/([\d,]+\.?\d*)/);
  return m ? Math.round(Number(m[1]!.replace(/,/g, '')) * 100) : 0;
}
function parseOrders(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10);
  return Number.isFinite(n) ? n : undefined;
}
function cleanUrl(raw: unknown): string {
  if (!raw) return '';
  let u = String(raw);
  if (u.startsWith('//')) u = 'https:' + u;
  else if (!u.startsWith('http')) u = 'https://' + u;
  return u.split('?')[0]!;
}

// Module-level access-token cache, keyed by refresh token. The DS token is the
// PLATFORM token (shared by every discovery call in the isolate), so caching it
// here — rather than per client instance — means many supplier lookups in one
// research run share a single refresh, instead of refreshing on every call.
const tokenCacheByRefresh = new Map<string, { token: string; expiresAt: number }>();

interface DsProduct {
  itemId?: string | number;
  title?: string;
  targetSalePrice?: string;
  targetOriginalPrice?: string;
  itemMainPic?: string;
  itemUrl?: string;
  orders?: string;
  score?: string;
}

/**
 * Two AliExpress gateways with DIFFERENT signing (verified live):
 *  - /rest system calls (token refresh): sign over apiPath + sorted key+value.
 *  - /sync business calls (ds.text.search): sign over sorted key+value, NO path.
 * The 30-day access token is minted from the (~60d, reusable) refresh token and
 * cached in-isolate so we don't refresh on every request.
 */
export class RealAliexpressDsClient implements AliexpressDsClient {
  constructor(private readonly env: AliexpressDsEnv) {}

  private async sign(params: Record<string, string>, secret: string, pathPrefix = ''): Promise<string> {
    const base = pathPrefix + Object.keys(params).sort().map((k) => `${k}${params[k]}`).join('');
    return hmacSha256Hex(secret, base);
  }

  private async getAccessToken(): Promise<string> {
    const { ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET, ALIEXPRESS_REFRESH_TOKEN, ALIEXPRESS_ACCESS_TOKEN } = this.env;

    if (ALIEXPRESS_APP_KEY && ALIEXPRESS_APP_SECRET && ALIEXPRESS_REFRESH_TOKEN) {
      const cached = tokenCacheByRefresh.get(ALIEXPRESS_REFRESH_TOKEN);
      if (cached && cached.expiresAt - REFRESH_MARGIN_MS > Date.now()) return cached.token;

      const path = '/auth/token/refresh';
      const params: Record<string, string> = {
        app_key: ALIEXPRESS_APP_KEY,
        sign_method: 'sha256',
        timestamp: String(Date.now()),
        refresh_token: ALIEXPRESS_REFRESH_TOKEN,
      };
      params.sign = await this.sign(params, ALIEXPRESS_APP_SECRET, path);
      const res = await fetch(REST_GATEWAY + path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
      });
      if (res.ok) {
        const json = (await res.json()) as { access_token?: string; expires_in?: number };
        if (json.access_token) {
          tokenCacheByRefresh.set(ALIEXPRESS_REFRESH_TOKEN, {
            token: json.access_token,
            expiresAt: Date.now() + (json.expires_in ?? 2592000) * 1000,
          });
          return json.access_token;
        }
      }
      // fall through to static token if refresh failed
    }
    if (ALIEXPRESS_ACCESS_TOKEN) return ALIEXPRESS_ACCESS_TOKEN;
    throw new Error('AliExpress DS: no usable access token (set ALIEXPRESS_REFRESH_TOKEN or ALIEXPRESS_ACCESS_TOKEN)');
  }

  async searchProducts(keyword: string, maxProducts = 8): Promise<AliexpressDsProduct[]> {
    const { ALIEXPRESS_APP_KEY, ALIEXPRESS_APP_SECRET } = this.env;
    if (!ALIEXPRESS_APP_KEY || !ALIEXPRESS_APP_SECRET) throw new Error('AliExpress DS: app key/secret not configured');
    const accessToken = await this.getAccessToken();

    const params: Record<string, string> = {
      method: 'aliexpress.ds.text.search',
      app_key: ALIEXPRESS_APP_KEY,
      access_token: accessToken,
      sign_method: 'sha256',
      timestamp: String(Date.now()),
      format: 'json',
      v: '2.0',
      keyWord: keyword,
      local: 'en_US',
      countryCode: 'US',
      currency: 'USD',
      sortBy: 'orders,desc',
      pageSize: String(Math.min(Math.max(maxProducts, 1), 50)),
      pageIndex: '1',
    };
    params.sign = await this.sign(params, ALIEXPRESS_APP_SECRET);

    const res = await fetch(SYNC_GATEWAY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    if (!res.ok) throw new Error(`AliExpress DS search failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as any;
    if (json?.error_response) throw new Error(`AliExpress DS error: ${JSON.stringify(json.error_response).slice(0, 200)}`);

    const list: DsProduct[] = json?.aliexpress_ds_text_search_response?.data?.products?.selection_search_product ?? [];
    return list
      .map((p) => {
        const costCents = toCents(p.targetSalePrice ?? p.targetOriginalPrice);
        const img = p.itemMainPic ? String(p.itemMainPic) : undefined;
        return {
          productId: String(p.itemId ?? ''),
          title: p.title ? String(p.title) : '',
          costCents,
          imageUrl: img,
          imageUrls: img ? [img] : [],
          productUrl: cleanUrl(p.itemUrl),
          orders: parseOrders(p.orders),
          rating: p.score ? Number(p.score) : undefined,
        };
      })
      .filter((p) => p.costCents > 0)
      .sort((a, b) => a.costCents - b.costCents);
  }
}
