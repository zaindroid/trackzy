import type { EbayMarketResearchClient, MarketListing, MarketSearchResult, SoldListing, SoldSearchResult } from './iface.js';

function hashString(value: string): number {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (h * 31 + value.charCodeAt(i)) >>> 0;
  return h;
}

/** Deterministic, fixture-backed mock — no network, no OAuth. */
export class MockEbayMarketResearchClient implements EbayMarketResearchClient {
  async searchActiveListings(keyword: string, limit = 50): Promise<MarketSearchResult> {
    const base = hashString(keyword);
    const count = Math.min(limit, 5 + (base % 20));
    const items: MarketListing[] = Array.from({ length: count }, (_, i) => {
      const id = `${base}${i}`;
      return {
        itemId: `v1|${id}|0`,
        title: `${keyword} - Item ${i + 1}`,
        priceCents: 1500 + ((base + i * 137) % 8500),
        url: `https://www.ebay.com/itm/${id}`,
        sellerUsername: `seller_${(base + i) % Math.max(1, Math.ceil(count / 2))}`,
        freeShipping: (base + i) % 2 === 0,
        condition: i % 3 === 0 ? 'New' : 'Used',
      };
    });
    return { totalListings: count * 3, items };
  }

  async searchSoldListings(keyword: string, maxItems = 60): Promise<SoldSearchResult> {
    const base = hashString(keyword);
    // Deliberately varies with the keyword so different seed keywords score
    // differently in tests/dev — a longer, more specific keyword (more
    // words) simulates a narrower niche: fewer sold items, fewer sellers,
    // matching the real-world pattern the deep-search loop is meant to find.
    const specificity = keyword.trim().split(/\s+/).length;
    const count = Math.min(maxItems, Math.max(3, 30 - specificity * 4 + (base % 10)));
    const items: SoldListing[] = Array.from({ length: count }, (_, i) => {
      const id = `${base}${i}`;
      return {
        itemId: `v1|${id}|0`,
        title: `${keyword} - Item ${i + 1}`,
        soldPriceCents: 1500 + ((base + i * 137) % 8500),
        // A fixed reference point, not Date.now() — keeps the mock genuinely
        // deterministic (two calls in the same test must return identical
        // results, even a few ms apart).
        soldDate: new Date(1_800_000_000_000 - i * 86_400_000).toISOString(),
        sellerUsername: `seller_${(base + i) % Math.max(1, Math.ceil(count / 3))}`,
        freeShipping: (base + i) % 2 === 0,
        condition: i % 3 === 0 ? 'New' : 'Used',
        bidsCount: i % 4 === 0 ? (base + i) % 8 : 0,
        url: `https://www.ebay.com/itm/${id}`,
      };
    });
    return { items };
  }
}
