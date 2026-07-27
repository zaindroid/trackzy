import { isMockMode } from '../mockMode.js';
import type { LemonSqueezyClient, LemonSqueezyEnv } from './iface.js';
import { RealLemonSqueezyClient } from './real.js';
import { MockLemonSqueezyClient } from './mock.js';

export * from './iface.js';
export { RealLemonSqueezyClient } from './real.js';
export { MockLemonSqueezyClient } from './mock.js';

export function createLemonSqueezyClient(env: LemonSqueezyEnv): LemonSqueezyClient {
  if (isMockMode(env.MOCK_MODE, env.LEMONSQUEEZY_API_KEY)) {
    return new MockLemonSqueezyClient();
  }
  return new RealLemonSqueezyClient(env);
}
