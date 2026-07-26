import { isMockMode } from '../mockMode.js';
import type { AliexpressDsClient, AliexpressDsEnv } from './iface.js';
import { RealAliexpressDsClient } from './real.js';
import { MockAliexpressDsClient } from './mock.js';

export * from './iface.js';
export { RealAliexpressDsClient } from './real.js';
export { MockAliexpressDsClient } from './mock.js';

export function createAliexpressDsClient(env: AliexpressDsEnv): AliexpressDsClient {
  // Mock unless we have app creds + a token source (refresh or static access).
  if (isMockMode(env.MOCK_MODE, env.ALIEXPRESS_APP_KEY, env.ALIEXPRESS_APP_SECRET, env.ALIEXPRESS_REFRESH_TOKEN ?? env.ALIEXPRESS_ACCESS_TOKEN)) {
    return new MockAliexpressDsClient();
  }
  return new RealAliexpressDsClient(env);
}
