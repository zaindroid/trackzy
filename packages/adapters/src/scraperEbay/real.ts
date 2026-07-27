import type { EbayDemandListing, EbayDemandResult, ScraperEbayClient, ScraperEbayEnv } from './iface.js';

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : Math.round((s[m - 1]! + s[m]!) / 2);
}

interface RawItem {
  item_price?: { from?: { value?: number }; value?: number };
  items_sold?: number;
  seller_name?: string;
  shipping_cost?: string;
}

/** Reads eBay's total active-results count from whichever shape ScraperAPI
 * returns it in (the structured endpoint may return a bare array, or an object
 * wrapping the items with a results/pagination total). Returns null if absent,
 * so the caller can fall back to the sampled page size. */
function parseActiveCount(data: unknown): number | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  const info = (d.search_information ?? d.pagination ?? {}) as Record<string, unknown>;
  const candidates = [d.total_results, d.total, info.total_results, info.total_entries, info.total];
  for (const c of candidates) {
    const n = typeof c === 'string' ? Number(c.replace(/[^0-9]/g, '')) : c;
    if (typeof n === 'number' && Number.isFinite(n) && n > 0) return Math.round(n);
  }
  return null;
}

export class RealScraperEbayClient implements ScraperEbayClient {
  constructor(private readonly env: ScraperEbayEnv) {}

  async searchDemand(keyword: string): Promise<EbayDemandResult> {
    const url = `https://api.scraperapi.com/structured/ebay/search?api_key=${encodeURIComponent(
      this.env.SCRAPER_API_KEY ?? '',
    )}&query=${encodeURIComponent(keyword)}&country=us`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ScraperAPI eBay search failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

    const data = (await res.json()) as unknown;
    // The endpoint may return a bare array of items, or an object wrapping them.
    const raw: RawItem[] = Array.isArray(data)
      ? (data as RawItem[])
      : Array.isArray((data as { results?: unknown }).results)
        ? ((data as { results: RawItem[] }).results)
        : Array.isArray((data as { products?: unknown }).products)
          ? ((data as { products: RawItem[] }).products)
          : [];

    const items: EbayDemandListing[] = raw.map((i) => ({
      priceCents: Math.round((i.item_price?.from?.value ?? i.item_price?.value ?? 0) * 100),
      sellerName: i.seller_name || undefined,
      freeShipping: /free/i.test(i.shipping_cost ?? ''),
      itemsSold: typeof i.items_sold === 'number' ? i.items_sold : 0,
    }));
    const prices = items.map((i) => i.priceCents).filter((c) => c > 0);
    // Prefer eBay's reported total active-listing count; fall back to the sampled
    // page size (the competition term's min-sample guard handles the difference).
    const activeListingCount = parseActiveCount(data) ?? items.length;
    return {
      items,
      totalSold: items.reduce((s, i) => s + i.itemsSold, 0),
      medianPriceCents: median(prices),
      activeListingCount,
    };
  }
}
