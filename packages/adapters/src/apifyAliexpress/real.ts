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

    return rawItems.map((raw) => ({
      productId: String(raw.productId ?? ''),
      title: String(raw.title ?? ''),
      priceCents: priceToCents(raw.priceCurrent ?? raw.priceCurrentMin),
      imageUrl: raw.imageUrl ? String(raw.imageUrl) : undefined,
      productUrl: raw.productUrl ? String(raw.productUrl) : undefined,
      soldCount: raw.soldCount !== undefined && raw.soldCount !== null ? Number(raw.soldCount) : undefined,
    }));
  }
}
