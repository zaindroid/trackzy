import { isMockMode } from '../../mockMode.js';
import type { SupplierApiClient } from '../iface.js';
import type { AliExpressEnv } from './iface.js';
import { RealAliExpressClient } from './real.js';
import { MockAliExpressClient } from './mock.js';

export * from './iface.js';
export { RealAliExpressClient } from './real.js';
export { MockAliExpressClient } from './mock.js';
export { signAliExpressParams } from './sign.js';

export function createAliExpressClient(env: AliExpressEnv): SupplierApiClient {
  if (isMockMode(env.MOCK_MODE, env.ALIEXPRESS_APP_KEY, env.ALIEXPRESS_APP_SECRET)) {
    return new MockAliExpressClient();
  }
  return new RealAliExpressClient(env);
}
