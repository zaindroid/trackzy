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

export class RealScraperEbayClient implements ScraperEbayClient {
  constructor(private readonly env: ScraperEbayEnv) {}

  async searchDemand(keyword: string): Promise<EbayDemandResult> {
    const url = `https://api.scraperapi.com/structured/ebay/search?api_key=${encodeURIComponent(
      this.env.SCRAPER_API_KEY ?? '',
    )}&query=${encodeURIComponent(keyword)}&country=us`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`ScraperAPI eBay search failed: ${res.status} ${(await res.text()).slice(0, 200)}`);

    const data = (await res.json()) as unknown;
    const raw: RawItem[] = Array.isArray(data) ? (data as RawItem[]) : [];

    const items: EbayDemandListing[] = raw.map((i) => ({
      priceCents: Math.round((i.item_price?.from?.value ?? i.item_price?.value ?? 0) * 100),
      sellerName: i.seller_name || undefined,
      freeShipping: /free/i.test(i.shipping_cost ?? ''),
      itemsSold: typeof i.items_sold === 'number' ? i.items_sold : 0,
    }));
    const prices = items.map((i) => i.priceCents).filter((c) => c > 0);
    return {
      items,
      totalSold: items.reduce((s, i) => s + i.itemsSold, 0),
      medianPriceCents: median(prices),
    };
  }
}
