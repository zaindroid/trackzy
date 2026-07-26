import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchEbayDemand } from './ebayScraper.js';

afterEach(() => vi.unstubAllGlobals());

describe('fetchEbayDemand', () => {
  it('sums items_sold and takes the median price from ScraperAPI results', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify([
            { item_price: { from: { value: 9.89 } }, items_sold: 652 },
            { item_price: { from: { value: 14.5 } }, items_sold: 100 },
            { item_price: { value: 20 } }, // no items_sold, alt price shape
          ]),
          { status: 200 },
        ),
      ),
    );
    const out = await fetchEbayDemand('led strip', 'k');
    expect(out).toEqual({ soldCount: 752, salesPerDay: expect.any(Number), medianSoldPriceCents: 1450 });
  });

  it('returns null on a non-200 (caller falls back)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 500 })));
    expect(await fetchEbayDemand('x', 'k')).toBeNull();
  });

  it('returns null on an empty result set', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('[]', { status: 200 })));
    expect(await fetchEbayDemand('x', 'k')).toBeNull();
  });
});
