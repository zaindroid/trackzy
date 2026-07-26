import { describe, expect, it, vi } from 'vitest';
import { RealEbayMarketResearchClient } from './real.js';
import type { EbayMarketResearchEnv } from './iface.js';

const ENV: EbayMarketResearchEnv = { EBAY_CLIENT_ID: 'client-1', EBAY_CLIENT_SECRET: 'secret-1' };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealEbayMarketResearchClient', () => {
  it('gets an app-level (client-credentials) token, then searches with the marketplace header and Bearer auth', async () => {
    let tokenBody: URLSearchParams | undefined;
    let searchHeaders: Record<string, string> | undefined;
    let searchUrl: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/identity/v1/oauth2/token')) {
          tokenBody = new URLSearchParams(init?.body as string);
          return jsonResponse({ access_token: 'app-token-1', expires_in: 7200 });
        }
        searchUrl = url;
        searchHeaders = init?.headers as Record<string, string>;
        return jsonResponse({
          total: 123,
          itemSummaries: [
            {
              itemId: 'v1|111|0',
              title: 'Silk Eye Mask',
              price: { value: '9.99', currency: 'USD' },
              itemWebUrl: 'https://www.ebay.com/itm/111',
              seller: { username: 'seller1' },
              shippingOptions: [{ shippingCost: { value: '0.00' } }],
              condition: 'New',
            },
          ],
        });
      }),
    );

    const client = new RealEbayMarketResearchClient(ENV);
    const result = await client.searchActiveListings('silk eye mask', 20);

    expect(tokenBody?.get('grant_type')).toBe('client_credentials');
    expect(tokenBody?.get('scope')).toBe('https://api.ebay.com/oauth/api_scope');
    expect(searchUrl).toContain('q=silk+eye+mask');
    expect(searchUrl).toContain('limit=20');
    expect(searchHeaders?.Authorization).toBe('Bearer app-token-1');
    expect(searchHeaders?.['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_US');

    expect(result.totalListings).toBe(123);
    expect(result.items).toEqual([
      {
        itemId: 'v1|111|0',
        title: 'Silk Eye Mask',
        priceCents: 999,
        url: 'https://www.ebay.com/itm/111',
        sellerUsername: 'seller1',
        freeShipping: true,
        condition: 'New',
      },
    ]);

    vi.unstubAllGlobals();
  });

  it('respects a custom EBAY_MARKETPLACE_ID', async () => {
    let searchHeaders: Record<string, string> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/identity/v1/oauth2/token')) return jsonResponse({ access_token: 't', expires_in: 7200 });
        searchHeaders = init?.headers as Record<string, string>;
        return jsonResponse({ total: 0, itemSummaries: [] });
      }),
    );

    const client = new RealEbayMarketResearchClient({ ...ENV, EBAY_MARKETPLACE_ID: 'EBAY_GB' });
    await client.searchActiveListings('widget');

    expect(searchHeaders?.['X-EBAY-C-MARKETPLACE-ID']).toBe('EBAY_GB');
    vi.unstubAllGlobals();
  });

  it('throws with the response body when the search call fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        if (String(input).includes('/identity/v1/oauth2/token')) return jsonResponse({ access_token: 't', expires_in: 7200 });
        return new Response('invalid marketplace', { status: 400 });
      }),
    );

    const client = new RealEbayMarketResearchClient(ENV);
    await expect(client.searchActiveListings('widget')).rejects.toThrow(/eBay Browse API search failed: 400/);
    vi.unstubAllGlobals();
  });
});

describe('RealEbayMarketResearchClient.searchSoldListings — Apify actor', () => {
  const APIFY_ENV = { ...ENV, APIFY_TOKEN: 'apify-token-1' };

  it('calls the configured Apify actor with the token and keyword, mapping the confirmed-live output fields', async () => {
    let calledUrl: string | undefined;
    let calledBody: Record<string, unknown> | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        calledUrl = String(input);
        calledBody = JSON.parse(init?.body as string);
        // Confirmed live against a real account — see real.ts's docstring.
        return jsonResponse([
          {
            itemId: '999',
            title: 'Silk Eye Mask',
            soldPrice: '9.99',
            endedAt: '2026-07-01T00:00:00.000Z',
            sellerUsername: null,
            shippingType: 'free',
            shippingPrice: null,
            condition: 'New',
            bidCount: null,
            url: 'https://www.ebay.com/itm/999',
          },
        ]);
      }),
    );

    const client = new RealEbayMarketResearchClient(APIFY_ENV);
    const result = await client.searchSoldListings('silk eye mask', 40);

    expect(calledUrl).toContain('/acts/caffein.dev~ebay-sold-listings/run-sync-get-dataset-items');
    expect(calledUrl).toContain('token=apify-token-1');
    expect(calledBody).toEqual({ keywords: ['silk eye mask'], count: 40 });
    expect(result.items).toEqual([
      {
        itemId: '999',
        title: 'Silk Eye Mask',
        soldPriceCents: 999,
        soldDate: '2026-07-01T00:00:00.000Z',
        sellerUsername: undefined,
        freeShipping: true,
        condition: 'New',
        bidsCount: undefined,
        url: 'https://www.ebay.com/itm/999',
      },
    ]);

    vi.unstubAllGlobals();
  });

  it('respects a custom APIFY_EBAY_SOLD_ACTOR_ID', async () => {
    let calledUrl: string | undefined;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        calledUrl = String(input);
        return jsonResponse([]);
      }),
    );

    const client = new RealEbayMarketResearchClient({ ...APIFY_ENV, APIFY_EBAY_SOLD_ACTOR_ID: 'someone~other-actor' });
    await client.searchSoldListings('widget');

    expect(calledUrl).toContain('/acts/someone~other-actor/run-sync-get-dataset-items');
    vi.unstubAllGlobals();
  });

  it('throws with the response body when the Apify actor call fails', async () => {
    // 400, not 5xx/429 — those are retryable in fetchWithBackoff (real
    // exponential-backoff delays), which would blow past the test timeout.
    vi.stubGlobal('fetch', vi.fn(async () => new Response('bad input', { status: 400 })));

    const client = new RealEbayMarketResearchClient(APIFY_ENV);
    await expect(client.searchSoldListings('widget')).rejects.toThrow(/Apify eBay sold-listings actor failed: 400/);
    vi.unstubAllGlobals();
  });
});
