import { describe, expect, it } from 'vitest';
import { createShopifyClient } from './index.js';
import { MockShopifyClient } from './mock.js';
import { RealShopifyClient } from './real.js';

describe('createShopifyClient', () => {
  it('returns the mock when MOCK_MODE=true', () => {
    const client = createShopifyClient({ MOCK_MODE: 'true', SHOPIFY_ACCESS_TOKEN: 'sk_live_real' });
    expect(client).toBeInstanceOf(MockShopifyClient);
  });

  it('returns the mock when the access token is an unfilled placeholder', () => {
    const client = createShopifyClient({
      MOCK_MODE: 'false',
      SHOPIFY_ACCESS_TOKEN: 'PLACEHOLDER__SHOPIFY_ACCESS_TOKEN',
    });
    expect(client).toBeInstanceOf(MockShopifyClient);
  });

  it('returns the real client when a real-looking token is configured and mock mode is off', () => {
    const client = createShopifyClient({ MOCK_MODE: 'false', SHOPIFY_ACCESS_TOKEN: 'shpat_real_token' });
    expect(client).toBeInstanceOf(RealShopifyClient);
  });
});
