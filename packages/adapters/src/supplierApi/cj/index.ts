import { isMockMode } from '../../mockMode.js';
import type { SupplierApiClient } from '../iface.js';
import type { CjEnv } from './iface.js';
import { RealCjClient } from './real.js';
import { MockCjClient } from './mock.js';

export * from './iface.js';
export { RealCjClient } from './real.js';
export { MockCjClient } from './mock.js';

export function createCjClient(env: CjEnv): SupplierApiClient {
  if (isMockMode(env.MOCK_MODE, env.CJ_API_KEY)) {
    return new MockCjClient();
  }
  return new RealCjClient(env);
}
