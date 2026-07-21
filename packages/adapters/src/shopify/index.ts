import { isMockMode } from '../mockMode.js';
import type { ShopifyClient, ShopifyEnv } from './iface.js';
import { RealShopifyClient } from './real.js';
import { MockShopifyClient } from './mock.js';

export * from './iface.js';
export { RealShopifyClient } from './real.js';
export { MockShopifyClient } from './mock.js';

export function createShopifyClient(env: ShopifyEnv): ShopifyClient {
  if (isMockMode(env.MOCK_MODE, env.SHOPIFY_ACCESS_TOKEN)) {
    return new MockShopifyClient();
  }
  return new RealShopifyClient(env);
}
