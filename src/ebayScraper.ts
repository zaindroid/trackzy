import type { EbaySoldSignal } from './types.js';

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

interface ScraperItem {
  item_price?: { from?: { value?: number }; value?: number };
  items_sold?: number;
}

/**
 * Real eBay DEMAND signal via ScraperAPI's structured endpoint — bypasses Apify
 * and the sold-search sign-in wall. Each listing carries `items_sold` (units
 * that listing has moved), so summing across the result page gives proven sales
 * volume for the niche. Cheap enough for the free tier (one call per niche).
 *
 * `soldCount` = total items_sold across the page (proven demand). `salesPerDay`
 * is left as a rough estimate over a nominal 90-day window (listings vary in
 * age, so treat it as indicative, not exact). Returns null on failure so the
 * caller can fall back.
 */
export async function fetchEbayDemand(keyword: string, apiKey: string, timeoutMs = 70_000): Promise<EbaySoldSignal | null> {
  const url = `https://api.scraperapi.com/structured/ebay/search?api_key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(keyword)}&country=us`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(url, { signal: controller.signal });
  } catch (err) {
    console.warn(`[demand] ScraperAPI failed for "${keyword}" (${err instanceof Error ? err.message : err}) — falling back`);
    return null;
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok) {
    console.warn(`[demand] ScraperAPI ${res.status} for "${keyword}" — falling back`);
    return null;
  }
  const data = (await res.json()) as unknown;
  const items: ScraperItem[] = Array.isArray(data) ? (data as ScraperItem[]) : [];
  if (items.length === 0) return null;

  const prices = items
    .map((i) => Math.round((i.item_price?.from?.value ?? i.item_price?.value ?? 0) * 100))
    .filter((c) => c > 0);
  const soldCount = items.reduce((sum, i) => sum + (typeof i.items_sold === 'number' ? i.items_sold : 0), 0);

  return {
    soldCount,
    salesPerDay: Math.round((soldCount / 90) * 10) / 10,
    medianSoldPriceCents: median(prices),
  };
}
