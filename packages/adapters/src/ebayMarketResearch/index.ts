import { isMockMode } from '../mockMode.js';
import type { EbayMarketResearchClient, EbayMarketResearchEnv } from './iface.js';
import { RealEbayMarketResearchClient } from './real.js';
import { MockEbayMarketResearchClient } from './mock.js';

export * from './iface.js';
export { RealEbayMarketResearchClient } from './real.js';
export { MockEbayMarketResearchClient } from './mock.js';

export function createEbayMarketResearchClient(env: EbayMarketResearchEnv): EbayMarketResearchClient {
  // All three required — EBAY_CLIENT_ID/SECRET for searchActiveListings,
  // APIFY_TOKEN for searchSoldListings (a different data source entirely,
  // see iface.ts) — any one missing/placeholder means at least one of the
  // two methods on this client would fail against a real account, same
  // multi-secret gate convention as every other adapter here.
  if (isMockMode(env.MOCK_MODE, env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET, env.APIFY_TOKEN)) {
    return new MockEbayMarketResearchClient();
  }
  return new RealEbayMarketResearchClient(env);
}
