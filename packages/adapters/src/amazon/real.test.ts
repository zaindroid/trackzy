import { describe, expect, it, vi, beforeEach } from 'vitest';
import { RealAmazonOrderSource } from './real.js';

const LWA_ACCESS_TOKEN = 'lwa-access-token';
const RDT_TOKEN = 'restricted-data-token-xyz';
const FIXED_TOKENS = { accessToken: LWA_ACCESS_TOKEN, refreshToken: 'refresh-1', expiresAt: Date.now() + 3600_000 };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('RealAmazonOrderSource — Restricted Data Token handling', () => {
  let calls: { url: string; accessTokenHeader: string | null }[];

  beforeEach(() => {
    calls = [];
  });

  function stubFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const accessTokenHeader = (init?.headers as Record<string, string> | undefined)?.['x-amz-access-token'] ?? null;
        calls.push({ url, accessTokenHeader });

        if (url.includes('/orders/v0/orders/ORDER-1/orderItems')) {
          return jsonResponse({
            payload: {
              OrderItems: [
                { OrderItemId: 'li-1', SellerSKU: 'SKU-1', Title: 'Item One', QuantityOrdered: 1, ItemPrice: { Amount: '19.99' } },
              ],
            },
          });
        }
        if (url.includes('/tokens/2021-03-01/restrictedDataToken')) {
          return jsonResponse({ restrictedDataToken: RDT_TOKEN });
        }
        if (url.includes('/orders/v0/orders/ORDER-1/address')) {
          return jsonResponse({
            payload: {
              ShippingAddress: {
                Name: 'Jamie Buyer',
                AddressLine1: '1 Infinite Loop',
                City: 'Cupertino',
                StateOrRegion: 'CA',
                PostalCode: '95014',
                CountryCode: 'US',
              },
            },
          });
        }
        if (url.includes('/orders/v0/orders/ORDER-1')) {
          return jsonResponse({ payload: { AmazonOrderId: 'ORDER-1', PurchaseDate: '2026-01-01T00:00:00Z', OrderTotal: { Amount: '19.99', CurrencyCode: 'USD' } } });
        }
        return jsonResponse({ error: 'unexpected url in test' }, 404);
      }),
    );
  }

  it('requests a Restricted Data Token and uses it (not the plain LWA token) to fetch the shipping address', async () => {
    stubFetch();
    const source = new RealAmazonOrderSource({}, FIXED_TOKENS, async () => undefined);

    const order = await source.getOrder('ORDER-1');

    expect(order?.shipTo).toEqual({
      name: 'Jamie Buyer',
      address1: '1 Infinite Loop',
      address2: undefined,
      city: 'Cupertino',
      state: 'CA',
      zip: '95014',
      country: 'US',
    });

    const rdtCall = calls.find((c) => c.url.includes('/tokens/2021-03-01/restrictedDataToken'));
    expect(rdtCall).toBeDefined();
    expect(rdtCall?.accessTokenHeader).toBe(LWA_ACCESS_TOKEN); // requesting the RDT itself uses the normal token

    const addressCall = calls.find((c) => c.url.includes('/orders/v0/orders/ORDER-1/address'));
    expect(addressCall).toBeDefined();
    expect(addressCall?.accessTokenHeader).toBe(RDT_TOKEN); // but the PII read itself uses the RDT, not the LWA token
    expect(addressCall?.accessTokenHeader).not.toBe(LWA_ACCESS_TOKEN);

    vi.unstubAllGlobals();
  });

  it('gracefully omits shipTo when the address fetch fails, without failing the whole order fetch', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/orders/v0/orders/ORDER-1/orderItems')) {
          return jsonResponse({ payload: { OrderItems: [] } });
        }
        if (url.includes('/tokens/2021-03-01/restrictedDataToken')) {
          return jsonResponse({ restrictedDataToken: RDT_TOKEN });
        }
        if (url.includes('/orders/v0/orders/ORDER-1/address')) {
          return jsonResponse({ error: 'forbidden' }, 403);
        }
        if (url.includes('/orders/v0/orders/ORDER-1')) {
          return jsonResponse({ payload: { AmazonOrderId: 'ORDER-1', PurchaseDate: '2026-01-01T00:00:00Z' } });
        }
        return jsonResponse({}, 404);
      }),
    );
    const source = new RealAmazonOrderSource({}, FIXED_TOKENS, async () => undefined);

    const order = await source.getOrder('ORDER-1');

    expect(order?.externalOrderId).toBe('ORDER-1');
    expect(order?.shipTo).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
