import { describe, expect, it } from 'vitest';
import { MockEbayMarketResearchClient } from './mock.js';

describe('MockEbayMarketResearchClient', () => {
  const client = new MockEbayMarketResearchClient();

  it('returns a deterministic result for the same keyword', async () => {
    const a = await client.searchActiveListings('wireless earbuds');
    const b = await client.searchActiveListings('wireless earbuds');
    expect(a).toEqual(b);
  });

  it('respects the limit parameter', async () => {
    const result = await client.searchActiveListings('gaming mouse', 3);
    expect(result.items.length).toBeLessThanOrEqual(3);
  });

  it('produces items with the shape MarketListing expects', async () => {
    const result = await client.searchActiveListings('phone case');
    expect(result.totalListings).toBeGreaterThan(0);
    for (const item of result.items) {
      expect(item.itemId).toBeTruthy();
      expect(item.title).toContain('phone case');
      expect(item.priceCents).toBeGreaterThan(0);
      expect(item.url).toMatch(/^https:\/\/www\.ebay\.com/);
    }
  });

  it('searchSoldListings is deterministic for the same keyword', async () => {
    const a = await client.searchSoldListings('wireless earbuds');
    const b = await client.searchSoldListings('wireless earbuds');
    expect(a).toEqual(b);
  });

  it('searchSoldListings returns fewer items for a more specific (multi-word) keyword', async () => {
    const broad = await client.searchSoldListings('earbuds');
    const specific = await client.searchSoldListings('earbuds waterproof bluetooth for running');
    expect(specific.items.length).toBeLessThan(broad.items.length);
  });

  it('produces items with the shape SoldListing expects', async () => {
    const result = await client.searchSoldListings('phone case');
    for (const item of result.items) {
      expect(item.itemId).toBeTruthy();
      expect(item.soldPriceCents).toBeGreaterThan(0);
      expect(item.soldDate).toBeTruthy();
      expect(item.url).toMatch(/^https:\/\/www\.ebay\.com/);
    }
  });
});
