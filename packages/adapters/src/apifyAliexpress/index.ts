import { isMockMode } from '../mockMode.js';
import type { ApifyAliexpressClient, ApifyAliexpressEnv } from './iface.js';
import { RealApifyAliexpressClient } from './real.js';
import { MockApifyAliexpressClient } from './mock.js';

export * from './iface.js';
export { RealApifyAliexpressClient } from './real.js';
export { MockApifyAliexpressClient } from './mock.js';

export function createApifyAliexpressClient(env: ApifyAliexpressEnv): ApifyAliexpressClient {
  if (isMockMode(env.MOCK_MODE, env.APIFY_TOKEN)) {
    return new MockApifyAliexpressClient();
  }
  return new RealApifyAliexpressClient(env);
}
