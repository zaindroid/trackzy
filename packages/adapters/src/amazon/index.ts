import { isMockMode } from '../mockMode.js';
import type { OAuthTokenSet, OnTokenRefreshed, OrderSource } from '../orderSource/iface.js';
import type { AmazonEnv } from './iface.js';
import { RealAmazonOrderSource } from './real.js';
import { MockAmazonOrderSource } from './mock.js';

export * from './iface.js';
export { RealAmazonOrderSource } from './real.js';
export { MockAmazonOrderSource } from './mock.js';

export function createAmazonOrderSource(
  env: AmazonEnv,
  tokens: OAuthTokenSet,
  onTokenRefreshed: OnTokenRefreshed,
): OrderSource {
  if (isMockMode(env.MOCK_MODE, env.AMAZON_LWA_CLIENT_ID, env.AMAZON_LWA_CLIENT_SECRET)) {
    return new MockAmazonOrderSource();
  }
  return new RealAmazonOrderSource(env, tokens, onTokenRefreshed);
}
