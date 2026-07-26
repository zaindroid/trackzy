import type { EbayDemandResult, ScraperEbayClient } from './iface.js';

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic, network-free mock. */
export class MockScraperEbayClient implements ScraperEbayClient {
  async searchDemand(keyword: string): Promise<EbayDemandResult> {
    const base = hashString(keyword);
    const count = 5 + (base % 10);
    const items = Array.from({ length: count }, (_, i) => ({
      priceCents: 800 + ((base + i * 137) % 4000),
      sellerName: `seller_${(base + i) % 50}`,
      freeShipping: (base + i) % 3 === 0,
      itemsSold: (base + i * 53) % 400,
    }));
    const prices = items.map((i) => i.priceCents).sort((a, b) => a - b);
    return {
      items,
      totalSold: items.reduce((s, i) => s + i.itemsSold, 0),
      medianPriceCents: prices[Math.floor(prices.length / 2)] ?? 0,
    };
  }
}
