import { describe, expect, it, vi } from 'vitest';
import { RealScraperEbayClient } from './real.js';
import { MockScraperEbayClient } from './mock.js';

describe('RealScraperEbayClient', () => {
  it('sums items_sold, takes median price, and reads seller/shipping', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { item_price: { from: { value: 9.89 } }, items_sold: 200, seller_name: 'a', shipping_cost: 'Free delivery' },
            { item_price: { value: 14.5 }, items_sold: 40, seller_name: 'b', shipping_cost: '+$3.00 shipping' },
          ]),
          { status: 200 },
        ),
      ),
    );
    const out = await new RealScraperEbayClient({ SCRAPER_API_KEY: 'k' }).searchDemand('led strip');
    expect(out.totalSold).toBe(240);
    expect(out.medianPriceCents).toBe(1220); // even count → Math.round((989+1450)/2)
    expect(out.items[0]!.freeShipping).toBe(true);
    expect(out.items[1]!.freeShipping).toBe(false);
    vi.unstubAllGlobals();
  });

  it('throws on a non-200', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('no', { status: 500 })));
    await expect(new RealScraperEbayClient({ SCRAPER_API_KEY: 'k' }).searchDemand('x')).rejects.toThrow(/ScraperAPI/);
    vi.unstubAllGlobals();
  });
});

describe('MockScraperEbayClient', () => {
  it('is deterministic and returns demand signals', async () => {
    const c = new MockScraperEbayClient();
    const a = await c.searchDemand('widget');
    const b = await c.searchDemand('widget');
    expect(a).toEqual(b);
    expect(a.totalSold).toBeGreaterThanOrEqual(0);
    expect(a.items.length).toBeGreaterThan(0);
  });
});
