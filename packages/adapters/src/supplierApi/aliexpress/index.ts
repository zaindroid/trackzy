import { isMockMode } from '../../mockMode.js';
import type { SupplierApiClient } from '../iface.js';
import type { AliExpressEnv, AliExpressOnTokenRefreshed, AliExpressTokenSet } from './iface.js';
import { RealAliExpressClient } from './real.js';
import { MockAliExpressClient } from './mock.js';

export * from './iface.js';
export { RealAliExpressClient, refreshAliExpressSessionIfStale } from './real.js';
export { MockAliExpressClient } from './mock.js';
export { signAliExpressParams } from './sign.js';

/**
 * Unlike the other `SupplierApiClient` factories (Amazon Business, CJ — a
 * static process-wide key is enough), AliExpress needs a per-supplier
 * session token plus a refresh callback (see real.ts's docstring) — this
 * factory's signature reflects that; callers resolve `tokens` from the
 * owning `suppliers` row's `oauth*Ref` columns (see
 * apps/worker/src/lib/supplierApiClientForSupplier.ts).
 */
export function createAliExpressClient(
  env: AliExpressEnv,
  tokens: AliExpressTokenSet,
  onTokenRefreshed: AliExpressOnTokenRefreshed,
): SupplierApiClient {
  if (isMockMode(env.MOCK_MODE, env.ALIEXPRESS_APP_KEY, env.ALIEXPRESS_APP_SECRET, tokens.accessToken)) {
    return new MockAliExpressClient();
  }
  return new RealAliExpressClient(env, tokens, onTokenRefreshed);
}
