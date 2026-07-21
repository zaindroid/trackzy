import { isMockMode } from '../mockMode.js';
import type { SupplierClient, SupplierEnv } from './iface.js';
import { GenericRestSupplierClient } from './real.js';
import { MockSupplierClient } from './mock.js';

export * from './iface.js';
export { GenericRestSupplierClient } from './real.js';
export { MockSupplierClient } from './mock.js';

export function createSupplierClient(env: SupplierEnv): SupplierClient {
  if (isMockMode(env.MOCK_MODE, env.SUPPLIER_API_KEY)) {
    return new MockSupplierClient();
  }
  return new GenericRestSupplierClient(env);
}
