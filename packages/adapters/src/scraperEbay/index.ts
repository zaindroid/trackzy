import { isMockMode } from '../mockMode.js';
import type { ScraperEbayClient, ScraperEbayEnv } from './iface.js';
import { RealScraperEbayClient } from './real.js';
import { MockScraperEbayClient } from './mock.js';

export * from './iface.js';
export { RealScraperEbayClient } from './real.js';
export { MockScraperEbayClient } from './mock.js';

export function createScraperEbayClient(env: ScraperEbayEnv): ScraperEbayClient {
  if (isMockMode(env.MOCK_MODE, env.SCRAPER_API_KEY)) {
    return new MockScraperEbayClient();
  }
  return new RealScraperEbayClient(env);
}
