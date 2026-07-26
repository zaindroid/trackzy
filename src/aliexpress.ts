import { createHash } from 'node:crypto';
import { config } from './config.js';
import type { SupplierMatch } from './types.js';

/**
 * AliExpress supplier match + cost.
 *
 * The official Affiliate API (`aliexpress.affiliate.product.query`) is a SIGNED
 * key/secret API with NO CAPTCHA — the reliable way to source from CI. It needs
 * an approved AppKey/AppSecret (register at portals.aliexpress.com). Until those
 * are set, this returns null (products are marked not-sourceable but still show
 * on Radar as demand signals).
 *
 * NOTE: The signing below is the AliExpress TOP "md5" scheme scaffold. The exact
 * method name, params, and result shape depend on your approved API version —
 * verify against your account's API console before relying on it. Marked
 * TODO(HUMAN) for that reason.
 */
export async function findAliexpressSupplier(keyword: string): Promise<SupplierMatch | null> {
  if (!config.aliexpressAppKey || !config.aliexpressAppSecret) return null;

  try {
    const gateway = 'https://api-sg.aliexpress.com/sync';
    const params: Record<string, string> = {
      method: 'aliexpress.affiliate.product.query',
      app_key: config.aliexpressAppKey,
      sign_method: 'md5',
      timestamp: String(Date.now()),
      format: 'json',
      v: '2.0',
      keywords: keyword,
      page_size: '10',
      sort: 'LAST_VOLUME_DESC', // best-selling first
    };
    params.sign = signTop(params, config.aliexpressAppSecret);

    const res = await fetch(gateway, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params),
    });
    if (!res.ok) {
      console.warn(`[aliexpress] query failed for "${keyword}": ${res.status}`);
      return null;
    }
    const json = (await res.json()) as any;
    // TODO(HUMAN): confirm this path against your API version's response shape.
    const product =
      json?.aliexpress_affiliate_product_query_response?.resp_result?.result?.products?.product?.[0];
    if (!product) return null;

    const price = Number(product.target_sale_price ?? product.sale_price ?? 0);
    return {
      productId: String(product.product_id ?? ''),
      url: String(product.product_detail_url ?? ''),
      costCents: Math.round(price * 100),
      rating: product.evaluate_rate ? Number(String(product.evaluate_rate).replace('%', '')) / 20 : undefined,
      orders: product.lastest_volume ? Number(product.lastest_volume) : undefined,
      imageUrl: product.product_main_image_url ? String(product.product_main_image_url) : undefined,
    };
  } catch (err) {
    console.warn(`[aliexpress] error for "${keyword}":`, err);
    return null;
  }
}

/** AliExpress TOP request signing (md5): concat secret + sorted k+v + secret, MD5, uppercase hex. */
function signTop(params: Record<string, string>, secret: string): string {
  const sorted = Object.keys(params)
    .filter((k) => k !== 'sign')
    .sort()
    .map((k) => `${k}${params[k]}`)
    .join('');
  return createHash('md5').update(secret + sorted + secret).digest('hex').toUpperCase();
}
