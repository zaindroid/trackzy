import { isMockMode } from '../../mockMode.js';
import type { SupplierApiClient } from '../iface.js';
import type { AmazonBusinessEnv } from './iface.js';
import { RealAmazonBusinessClient } from './real.js';
import { MockAmazonBusinessClient } from './mock.js';

export * from './iface.js';
export { RealAmazonBusinessClient } from './real.js';
export { MockAmazonBusinessClient } from './mock.js';

export function createAmazonBusinessClient(env: AmazonBusinessEnv): SupplierApiClient {
  if (isMockMode(env.MOCK_MODE, env.AMAZON_BUSINESS_API_KEY)) {
    return new MockAmazonBusinessClient();
  }
  return new RealAmazonBusinessClient(env);
}
