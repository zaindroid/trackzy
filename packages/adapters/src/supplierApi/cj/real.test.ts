import { describe, expect, it, vi } from 'vitest';
import { RealCjClient } from './real.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

const ENV = { CJ_API_KEY: 'access-token-1' };

describe('RealCjClient — searchProduct (real endpoint shape, confirmed live)', () => {
  it('searches productNameEn, not productName — confirmed live to return far more relevant results', async () => {
    let capturedUrl: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        capturedUrl = String(input);
        return jsonResponse({ result: true, data: { list: [{ pid: 'p1', productNameEn: 'Widget' }] } });
      }),
    );

    const client = new RealCjClient(ENV);
    const results = await client.searchProduct('widget');

    expect(new URL(capturedUrl!).searchParams.get('productNameEn')).toBe('widget');
    expect(new URL(capturedUrl!).searchParams.has('productName')).toBe(false);
    expect(results).toEqual([
      { supplierProductId: 'p1', title: 'Widget', imageUrl: undefined, productUrl: 'https://www.cjdropshipping.com/product/-p-p1.html' },
    ]);
    vi.unstubAllGlobals();
  });
});

describe('RealCjClient — getOffer (real per-variant shape, confirmed live)', () => {
  it('picks the cheapest variant as the offer price, and reports inStock when any variant has stock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          result: true,
          data: {
            variants: [
              { variantSellPrice: 12.5, inventoryNum: 0 },
              { variantSellPrice: 9.99, inventoryNum: 5 },
              { variantSellPrice: 15.0, inventoryNum: null },
            ],
          },
        }),
      ),
    );

    const client = new RealCjClient(ENV);
    const offer = await client.getOffer('p1');

    expect(offer.costCents).toBe(999); // the cheapest variant, not the first one
    expect(offer.inStock).toBe(true);
    vi.unstubAllGlobals();
  });

  it('treats a null inventoryNum as "not tracked, assume available" rather than out of stock', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ result: true, data: { variants: [{ variantSellPrice: 5.0, inventoryNum: null }] } }),
      ),
    );

    const client = new RealCjClient(ENV);
    const offer = await client.getOffer('p1');
    expect(offer.inStock).toBe(true);
    vi.unstubAllGlobals();
  });

  it('reports inStock=false only when every variant explicitly has zero inventory', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({ result: true, data: { variants: [{ variantSellPrice: 5.0, inventoryNum: 0 }] } }),
      ),
    );

    const client = new RealCjClient(ENV);
    const offer = await client.getOffer('p1');
    expect(offer.inStock).toBe(false);
    vi.unstubAllGlobals();
  });
});
