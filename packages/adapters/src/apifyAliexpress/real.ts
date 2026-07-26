import { TokenBucket, fetchWithBackoff } from '../rateLimit.js';
import type { AliexpressProduct, ApifyAliexpressClient, ApifyAliexpressEnv } from './iface.js';

function newBucket(): TokenBucket {
  return new TokenBucket({ capacity: 5, refillPerSecond: 2 });
}

// Parses AliExpress price strings like "US $1.33" (or a plain "1.33") into cents.
function priceToCents(raw: unknown): number {
  if (raw === undefined || raw === null) return 0;
  const match = String(raw).match(/([\d,]+\.?\d*)/);
  if (!match) return 0;
  return Math.round(Number.parseFloat(match[1]!.replace(/,/g, '')) * 100);
}

const EBAY_MAX_PICTURES = 12;

function normalizeUrl(u: string): string | null {
  const url = u.startsWith('//') ? `https:${u}` : u;
  return url.startsWith('http') ? url : null;
}

/**
 * Collects the product's full image gallery. The actor's field name for the
 * gallery isn't guaranteed stable, so we probe the common ones and accept both
 * plain-string arrays and arrays of `{url|imageUrl|src}` objects. Falls back to
 * the single `imageUrl`. Deduped, https-normalized, capped at eBay's 12-picture
 * limit so this array can feed AddFixedPriceItem directly.
 */
function extractImages(raw: Record<string, unknown>): string[] {
  const urls: string[] = [];
  const push = (v: unknown) => {
    if (typeof v === 'string') {
      const n = normalizeUrl(v);
      if (n) urls.push(n);
    } else if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      const candidate = o.url ?? o.imageUrl ?? o.src ?? o.image;
      if (typeof candidate === 'string') {
        const n = normalizeUrl(candidate);
        if (n) urls.push(n);
      }
    }
  };
  if (typeof raw.imageUrl === 'string') push(raw.imageUrl);
  for (const key of ['images', 'imageUrls', 'productImages', 'imageList', 'gallery', 'galleryImages']) {
    const val = raw[key];
    if (Array.isArray(val)) val.forEach(push);
  }
  return [...new Set(urls)].slice(0, EBAY_MAX_PICTURES);
}

export class RealApifyAliexpressClient implements ApifyAliexpressClient {
  private readonly bucket = newBucket();

  constructor(private readonly env: ApifyAliexpressEnv) {}

  /**
   * Input/output confirmed live against a real account (see iface.ts):
   * input `{ searchQueries: [keyword], maxProducts, sortBy: 'orders' }`
   * (maxProducts min is 50); output items carry `productId`, `title`,
   * `priceCurrent` (a "US $1.33" string), `imageUrl`, `productUrl`,
   * `soldCount`. `sortBy: orders` = best-selling first, the most useful order
   * for sourcing.
   */
  async searchProducts(keyword: string, maxProducts = 50): Promise<AliexpressProduct[]> {
    const actorId = this.env.APIFY_ALIEXPRESS_ACTOR_ID ?? 'devcake~aliexpress-products-scraper';
    const url = `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${encodeURIComponent(this.env.APIFY_TOKEN ?? '')}`;

    const res = await fetchWithBackoff(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchQueries: [keyword], maxProducts, sortBy: 'orders' }),
      },
      this.bucket,
    );
    if (!res.ok) {
      throw new Error(`Apify AliExpress actor failed: ${res.status} ${await res.text()}`);
    }
    const rawItems = (await res.json()) as Record<string, unknown>[];

    return rawItems.map((raw) => {
      const imageUrls = extractImages(raw);
      return {
        productId: String(raw.productId ?? ''),
        title: String(raw.title ?? ''),
        priceCents: priceToCents(raw.priceCurrent ?? raw.priceCurrentMin),
        imageUrl: imageUrls[0],
        imageUrls,
        productUrl: raw.productUrl ? String(raw.productUrl) : undefined,
        soldCount: raw.soldCount !== undefined && raw.soldCount !== null ? Number(raw.soldCount) : undefined,
      };
    });
  }
}
