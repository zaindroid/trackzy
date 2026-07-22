import { isMockMode } from '../mockMode.js';
import type { OAuthTokenSet, OnTokenRefreshed, OrderSource } from '../orderSource/iface.js';
import type { EbayEnv } from './iface.js';
import { RealEbayOrderSource } from './real.js';
import { MockEbayOrderSource } from './mock.js';

export * from './iface.js';
export { RealEbayOrderSource, NonApiModeError } from './real.js';
export { MockEbayOrderSource } from './mock.js';

export function createEbayOrderSource(
  env: EbayEnv,
  tokens: OAuthTokenSet,
  onTokenRefreshed: OnTokenRefreshed,
  nonApiMode: boolean,
): OrderSource {
  if (isMockMode(env.MOCK_MODE, env.EBAY_CLIENT_ID, env.EBAY_CLIENT_SECRET)) {
    return new MockEbayOrderSource(nonApiMode);
  }
  return new RealEbayOrderSource(env, tokens, onTokenRefreshed, nonApiMode);
}
