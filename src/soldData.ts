import { config } from './config.js';
import type { EbaySoldSignal } from './types.js';

// The crawl window the Apify sold-listings actor reports over, used to turn a
// sold count into a per-day velocity. Adjust if the actor's window differs.
const SOLD_WINDOW_DAYS = 30;

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

function priceToCents(raw: unknown): number {
  if (raw == null) return 0;
  const m = String(raw).match(/([\d,]+\.?\d*)/);
  return m ? Math.round(Number(m[1]!.replace(/,/g, '')) * 100) : 0;
}

/**
 * Confirmed-SOLD demand signal. This is the piece with no free official route
 * (eBay Marketplace Insights is gated; scraping is Akamai-walled from CI IPs).
 * OPTIONAL: if APIFY_TOKEN is set, we use a managed sold-listings actor (the
 * same one the main app validated). Without it, returns null and the product is
 * ranked on price + competition only.
 *
 * TODO(HUMAN): if you get eBay Marketplace Insights API approval, implement it
 * here instead of Apify — it's the free, first-party path.
 */
export async function fetchEbaySold(keyword: string): Promise<EbaySoldSignal | null> {
  if (!config.apifyToken) return null;

  const url = `https://api.apify.com/v2/acts/${config.apifyEbaySoldActorId}/run-sync-get-dataset-items?token=${encodeURIComponent(config.apifyToken)}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keywords: [keyword], count: 100 }),
  });
  if (!res.ok) {
    console.warn(`[sold] Apify failed for "${keyword}": ${res.status} — continuing without sold data`);
    return null;
  }
  const items = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(items) || items.length === 0) return null;

  const prices = items.map((i) => priceToCents(i.soldPrice ?? i.price)).filter((c) => c > 0);
  const soldCount = items.length;
  return {
    soldCount,
    salesPerDay: Math.round((soldCount / SOLD_WINDOW_DAYS) * 10) / 10,
    medianSoldPriceCents: median(prices),
  };
}
