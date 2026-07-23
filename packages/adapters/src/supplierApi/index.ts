import type { SupplierApiClient } from './iface.js';
import { createAmazonBusinessClient, type AmazonBusinessEnv } from './amazonBusiness/index.js';
import type { AliExpressEnv } from './aliexpress/index.js';
import { createCjClient, type CjEnv } from './cj/index.js';

export * from './iface.js';
export * from './amazonBusiness/index.js';
export * from './aliexpress/index.js';
export * from './cj/index.js';

export type SupplierApiProvider = 'amazon_business' | 'aliexpress' | 'cj';
export type SupplierApiEnv = AmazonBusinessEnv & AliExpressEnv & CjEnv;

/**
 * Dispatches on `suppliers.provider` to the matching API-driven supplier
 * adapter — for `'amazon_business'`/`'cj'` only, both static-key providers
 * with no per-supplier state. `'aliexpress'` needs a per-supplier,
 * refreshable session token and a DB-backed refresh callback (see
 * `createAliExpressClient`'s docstring), which this env-only signature has
 * no way to supply; callers must resolve it via
 * `apps/worker/src/lib/supplierApiClientForSupplier.ts` instead. Throwing
 * here (rather than silently constructing a client with an empty session)
 * makes it impossible to accidentally bypass that resolver.
 */
export function createSupplierApiClient(provider: SupplierApiProvider, env: SupplierApiEnv): SupplierApiClient {
  switch (provider) {
    case 'amazon_business':
      return createAmazonBusinessClient(env);
    case 'aliexpress':
      throw new Error(
        "createSupplierApiClient() cannot construct an AliExpress client without per-supplier OAuth tokens — use createSupplierApiClientForSupplier(env, db, supplier) instead.",
      );
    case 'cj':
      return createCjClient(env);
  }
}
