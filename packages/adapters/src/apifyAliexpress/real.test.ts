import { describe, expect, it, vi } from 'vitest';
import { RealApifyAliexpressClient } from './real.js';
import { MockApifyAliexpressClient } from './mock.js';

const ENV = { APIFY_TOKEN: 'apify-token-1' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealApifyAliexpressClient', () => {
  it('calls the actor with searchQueries + best-selling sort, and parses "US $1.33" prices into cents', async () => {
    let calledUrl: string | undefined;
    let calledBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input);
        calledBody = JSON.parse(init?.body as string);
        return jsonResponse([
          {
            productId: '100500',
            title: 'Mulberry Silk Sleeping Mask',
            productUrl: 'https://www.aliexpress.com/item/100500.html',
            imageUrl: 'https://ae.img/1.jpg',
            priceCurrent: 'US $1.33',
            soldCount: 4200,
          },
        ]);
      }),
    );

    const client = new RealApifyAliexpressClient(ENV);
    const products = await client.searchProducts('silk eye mask');

    expect(calledUrl).toContain('/acts/devcake~aliexpress-products-scraper/run-sync-get-dataset-items');
    expect(calledUrl).toContain('token=apify-token-1');
    expect(calledBody).toEqual({ searchQueries: ['silk eye mask'], maxProducts: 50, sortBy: 'orders' });
    expect(products).toEqual([
      {
        productId: '100500',
        title: 'Mulberry Silk Sleeping Mask',
        priceCents: 133,
        imageUrl: 'https://ae.img/1.jpg',
        productUrl: 'https://www.aliexpress.com/item/100500.html',
        soldCount: 4200,
      },
    ]);

    vi.unstubAllGlobals();
  });

  it('throws with the response body on failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad input', { status: 400 })));
    const client = new RealApifyAliexpressClient(ENV);
    await expect(client.searchProducts('x')).rejects.toThrow(/Apify AliExpress actor failed: 400/);
    vi.unstubAllGlobals();
  });
});

describe('MockApifyAliexpressClient', () => {
  it('is deterministic and returns priced products with images/urls', async () => {
    const client = new MockApifyAliexpressClient();
    const a = await client.searchProducts('widget');
    const b = await client.searchProducts('widget');
    expect(a).toEqual(b);
    for (const p of a) {
      expect(p.priceCents).toBeGreaterThan(0);
      expect(p.productUrl).toMatch(/aliexpress\.com/);
    }
  });
});
