import { createHmac } from 'node:crypto';
import type { SupplierMatch, SupplierProvider } from './types.js';

// AliExpress business APIs use the /sync gateway with a `method` param and
// HMAC-SHA256 over the sorted key+value concatenation (NO api-path prepend —
// that's only for the /rest system/auth endpoints). Verified live.
const GATEWAY = 'https://api-sg.aliexpress.com/sync';

function toCents(v: unknown): number {
  if (v == null) return 0;
  const m = String(v).match(/([\d,]+\.?\d*)/);
  return m ? Math.round(Number(m[1]!.replace(/,/g, '')) * 100) : 0;
}

function parseOrders(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = parseInt(String(v).replace(/[^\d]/g, ''), 10); // "50,000+" -> 50000
  return Number.isFinite(n) ? n : undefined;
}

function cleanItemUrl(raw: unknown): string {
  if (!raw) return '';
  let u = String(raw);
  if (u.startsWith('//')) u = 'https:' + u;
  else if (!u.startsWith('http')) u = 'https://' + u;
  return u.split('?')[0]!; // AliExpress appends a messy double-`?` query; drop it
}

interface DsProduct {
  itemId?: string | number;
  targetSalePrice?: string;
  targetOriginalPrice?: string;
  itemMainPic?: string;
  itemUrl?: string;
  orders?: string;
  score?: string;
  evaluateRate?: string;
}

/**
 * AliExpress Dropshipper API supplier provider — the official, free-at-scale
 * source (no Apify, no per-result cost → resultsConsumed is always 0, so the
 * Apify ceiling never applies). Uses `aliexpress.ds.text.search`, ordered by
 * volume, and returns the cheapest priced match in USD (`targetSalePrice`).
 * Needs an OAuth access_token (see aliexpressToken.ts / the connect flow).
 */
export class AliexpressDsProvider implements SupplierProvider {
  readonly source = 'aliexpress:ds';

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    private readonly accessToken: string,
    private readonly timeoutMs = 40_000,
  ) {}

  async lookup(query: string, maxItems: number): Promise<{ match: SupplierMatch | null; resultsConsumed: number }> {
    const params: Record<string, string> = {
      method: 'aliexpress.ds.text.search',
      app_key: this.appKey,
      access_token: this.accessToken,
      sign_method: 'sha256',
      timestamp: String(Date.now()),
      format: 'json',
      v: '2.0',
      keyWord: query,
      local: 'en_US',
      countryCode: 'US',
      currency: 'USD',
      sortBy: 'orders,desc',
      pageSize: String(Math.min(Math.max(maxItems, 1), 50)),
      pageIndex: '1',
    };
    const signBase = Object.keys(params)
      .sort()
      .map((k) => `${k}${params[k]}`)
      .join('');
    params.sign = createHmac('sha256', this.appSecret).update(signBase).digest('hex').toUpperCase();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let json: any;
    try {
      const res = await fetch(GATEWAY, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(params),
        signal: controller.signal,
      });
      if (!res.ok) throw new Error(`AliExpress DS ${res.status}: ${(await res.text()).slice(0, 200)}`);
      json = await res.json();
    } finally {
      clearTimeout(timer);
    }
    if (json?.error_response) throw new Error(`AliExpress DS error: ${JSON.stringify(json.error_response).slice(0, 200)}`);

    const list: DsProduct[] = json?.aliexpress_ds_text_search_response?.data?.products?.selection_search_product ?? [];
    if (list.length === 0) return { match: null, resultsConsumed: 0 };

    // Cheapest priced item (USD target price), already volume-sorted for relevance.
    const priced = list
      .map((p) => ({ p, cents: toCents(p.targetSalePrice ?? p.targetOriginalPrice) }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => a.cents - b.cents);
    if (priced.length === 0) return { match: null, resultsConsumed: 0 };

    const best = priced[0]!.p;
    const match: SupplierMatch = {
      productId: String(best.itemId ?? ''),
      url: cleanItemUrl(best.itemUrl),
      costCents: priced[0]!.cents,
      rating: best.score ? Number(best.score) : undefined,
      orders: parseOrders(best.orders),
      imageUrl: best.itemMainPic ? String(best.itemMainPic) : undefined,
    };
    return { match, resultsConsumed: 0 };
  }
}
