import type { SupplierApiClient } from './iface.js';
import { createAmazonBusinessClient, type AmazonBusinessEnv } from './amazonBusiness/index.js';
import { createAliExpressClient, type AliExpressEnv } from './aliexpress/index.js';
import { createCjClient, type CjEnv } from './cj/index.js';

export * from './iface.js';
export * from './amazonBusiness/index.js';
export * from './aliexpress/index.js';
export * from './cj/index.js';

export type SupplierApiProvider = 'amazon_business' | 'aliexpress' | 'cj';
export type SupplierApiEnv = AmazonBusinessEnv & AliExpressEnv & CjEnv;

/** Dispatches on `suppliers.provider` (see packages/db/src/schema.ts) to the matching API-driven supplier adapter. */
export function createSupplierApiClient(provider: SupplierApiProvider, env: SupplierApiEnv): SupplierApiClient {
  switch (provider) {
    case 'amazon_business':
      return createAmazonBusinessClient(env);
    case 'aliexpress':
      return createAliExpressClient(env);
    case 'cj':
      return createCjClient(env);
  }
}
