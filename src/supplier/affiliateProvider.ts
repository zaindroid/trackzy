import { createHash } from 'node:crypto';
import type { SupplierMatch, SupplierProvider } from './types.js';

/**
 * AliExpress Affiliate API supplier provider — "our own API", no Apify, no
 * CAPTCHA, and NO per-result cost (so it never touches the Apify monthly
 * ceiling: resultsConsumed is always 0). This is the sustainable replacement
 * for the Apify supplier lookups. Uses the official signed TOP gateway
 * (`aliexpress.affiliate.product.query`), which needs an approved
 * AppKey/AppSecret.
 *
 * TODO(HUMAN): the request signing + response field mapping below follow
 * AliExpress's published TOP/Affiliate docs but can't be exercised without live
 * keys — verify the exact `method` version and response shape against your
 * approved app's API console on the first real call, then remove this note.
 */
export class AffiliateSupplierProvider implements SupplierProvider {
  readonly source = 'aliexpress:affiliate';

  constructor(
    private readonly appKey: string,
    private readonly appSecret: string,
    private readonly gateway = 'https://api-sg.aliexpress.com/sync',
  ) {}

  async lookup(query: string, maxItems: number): Promise<{ match: SupplierMatch | null; resultsConsumed: number }> {
    const params: Record<string, string> = {
      method: 'aliexpress.affiliate.product.query',
      app_key: this.appKey,
      sign_method: 'md5',
      timestamp: String(Date.now()),
      format: 'json',
      v: '2.0',
      keywords: query,
      page_size: String(Math.min(Math.max(maxItems, 1), 50)),
      page_no: '1',
      sort: 'LAST_VOLUME_DESC', // best-selling first
      target_currency: 'USD',
      target_language: 'EN',
    };
    params.sign = signTop(params, this.appSecret);

    const res = await fetch(this.gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    if (!res.ok) throw new Error(`AliExpress Affiliate ${res.status}: ${(await res.text()).slice(0, 200)}`);

    const json = (await res.json()) as any;
    // Surface a returned API error rather than silently treating it as "no match".
    const apiErr = json?.error_response;
    if (apiErr) throw new Error(`AliExpress Affiliate error: ${JSON.stringify(apiErr).slice(0, 200)}`);

    const products = json?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product;
    const list: any[] = Array.isArray(products) ? products : products ? [products] : [];
    if (list.length === 0) return { match: null, resultsConsumed: 0 };

    // Cheapest plausible priced result (already volume-sorted for relevance).
    const priced = list
      .map((p) => ({ p, cents: toCents(p.target_sale_price ?? p.sale_price ?? p.target_app_sale_price) }))
      .filter((x) => x.cents > 0)
      .sort((a, b) => a.cents - b.cents);
    if (priced.length === 0) return { match: null, resultsConsumed: 0 };

    const best = priced[0]!.p;
    const match: SupplierMatch = {
      productId: String(best.product_id ?? ''),
      url: String(best.product_detail_url ?? ''),
      costCents: priced[0]!.cents,
      rating: best.evaluate_rate ? Number(String(best.evaluate_rate).replace('%', '')) / 20 : undefined,
      orders: best.lastest_volume != null ? Number(best.lastest_volume) : undefined,
      imageUrl: best.product_main_image_url ? String(best.product_main_image_url) : undefined,
    };
    // resultsConsumed 0 — the Affiliate API has no per-result billing.
    return { match, resultsConsumed: 0 };
  }
}

function toCents(raw: unknown): number {
  if (raw == null) return 0;
  const m = String(raw).match(/([\d,]+\.?\d*)/);
  return m ? Math.round(Number(m[1]!.replace(/,/g, '')) * 100) : 0;
}

/** AliExpress TOP md5 signing: MD5(secret + sorted(k+v) + secret), uppercase hex. */
function signTop(params: Record<string, string>, secret: string): string {
  const base = Object.keys(params)
    .filter((k) => k !== 'sign')
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return createHash('md5').update(secret + base + secret).digest('hex').toUpperCase();
}
