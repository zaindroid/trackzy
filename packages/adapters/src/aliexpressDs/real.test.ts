import { describe, expect, it, vi } from 'vitest';
import { RealAliexpressDsClient } from './real.js';
import { MockAliexpressDsClient } from './mock.js';

const ENV = {
  ALIEXPRESS_APP_KEY: '540440',
  ALIEXPRESS_APP_SECRET: 'secret',
  ALIEXPRESS_ACCESS_TOKEN: 'static_tok', // static token path (no refresh call)
};

function dsResponse(products: unknown[]) {
  return new Response(
    JSON.stringify({ aliexpress_ds_text_search_response: { data: { products: { selection_search_product: products } } } }),
    { status: 200 },
  );
}

describe('RealAliexpressDsClient', () => {
  it('signs, parses, and returns cheapest-first USD products', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      dsResponse([
        { itemId: '1', title: 'A', targetSalePrice: '3.51', itemMainPic: 'https://img/a.jpg', itemUrl: '//x.com/1.html?appkey=1', orders: '50,000+', score: '4.5' },
        { itemId: '2', title: 'B', targetSalePrice: '1.02', itemMainPic: 'https://img/b.jpg', itemUrl: '//x.com/2.html', orders: '10', score: '4.8' },
      ]),
    );
    vi.stubGlobal('fetch', fetchMock);

    const out = await new RealAliexpressDsClient(ENV).searchProducts('led strip', 5);
    expect(out).toHaveLength(2);
    expect(out[0]!.costCents).toBe(102); // cheapest first
    expect(out[0]!.productId).toBe('2');
    expect(out[0]!.orders).toBe(10);
    expect(out[0]!.productUrl).toBe('https://x.com/2.html'); // https-normalized, query stripped
    // A signed request went out with a sign param.
    const body = fetchMock.mock.calls[0]![1].body as URLSearchParams;
    expect(body.get('sign')).toMatch(/^[0-9A-F]+$/);
    expect(body.get('method')).toBe('aliexpress.ds.text.search');
    vi.unstubAllGlobals();
  });

  it('throws on an error_response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error_response: { code: 'x', msg: 'bad' } }), { status: 200 })));
    await expect(new RealAliexpressDsClient(ENV).searchProducts('x')).rejects.toThrow(/AliExpress DS error/);
    vi.unstubAllGlobals();
  });
});

describe('MockAliexpressDsClient', () => {
  it('is deterministic and cheapest-first', async () => {
    const c = new MockAliexpressDsClient();
    const a = await c.searchProducts('widget');
    expect(a).toEqual(await c.searchProducts('widget'));
    for (let i = 1; i < a.length; i++) expect(a[i]!.costCents).toBeGreaterThanOrEqual(a[i - 1]!.costCents);
  });
});
