import { isMockMode } from '../mockMode.js';
import type { EbayListingClient, EbayListingEnv } from './iface.js';
import { RealEbayListingClient } from './real.js';
import { MockEbayListingClient } from './mock.js';

export * from './iface.js';
export { RealEbayListingClient } from './real.js';
export { MockEbayListingClient } from './mock.js';

export function createEbayListingClient(env: EbayListingEnv): EbayListingClient {
  if (isMockMode(env.MOCK_MODE, env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET)) {
    return new MockEbayListingClient();
  }
  return new RealEbayListingClient(env);
}
