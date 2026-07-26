import { suppliers, type Database } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import {
  createAliExpressClient,
  createSupplierApiClient,
  type AliExpressTokenSet,
  type SupplierApiClient,
  type SupplierApiProvider,
} from '@fulfillment-tracker/adapters/supplierApi';
import type { Env } from '../env.js';
import { resolveSecretRef } from './secretRef.js';
import { encryptCredential } from './credentialCrypto.js';

/**
 * Resolves a `SupplierApiClient` for a given `suppliers` row. Amazon
 * Business and CJ use a static, process-wide key (`createSupplierApiClient`
 * handles them unchanged); AliExpress needs a per-supplier, refreshable
 * session token, so this is the one provider that reads/writes the
 * `oauth*Ref` columns on the owning row — same `*_ref` pointer + "refresh
 * callback overwrites with a literal value" convention already used for
 * `storefronts`/`users.gmail*` (see DECISIONS.md). Every call site that
 * needs a `SupplierApiClient` for a real `suppliers` row should go through
 * this function rather than calling `createSupplierApiClient` directly, so
 * AliExpress's refresh handling can never be silently bypassed.
 */
export async function createSupplierApiClientForSupplier(
  env: Env,
  db: Database,
  supplier: typeof suppliers.$inferSelect,
): Promise<SupplierApiClient> {
  if (supplier.provider === 'aliexpress') {
    const tokens: AliExpressTokenSet = {
      accessToken: supplier.oauthAccessTokenRef ? await resolveSecretRef(supplier.oauthAccessTokenRef, env) : '',
      refreshToken: supplier.oauthRefreshTokenRef ? await resolveSecretRef(supplier.oauthRefreshTokenRef, env) : '',
      expiresAt: supplier.oauthExpiresAt ?? 0,
    };
    const onTokenRefreshed = async (refreshed: AliExpressTokenSet) => {
      // Always re-encrypted on write — see the identical note in
      // orderSourceForStorefront.ts. AliExpress rotates both tokens on every
      // refresh (unlike eBay/Amazon), so both are re-encrypted here.
      await db
        .update(suppliers)
        .set({
          oauthAccessTokenRef: await encryptCredential(env, refreshed.accessToken),
          oauthRefreshTokenRef: await encryptCredential(env, refreshed.refreshToken),
          oauthExpiresAt: refreshed.expiresAt,
        })
        .where(eq(suppliers.id, supplier.id));
    };
    return createAliExpressClient(env, tokens, onTokenRefreshed);
  }
  return createSupplierApiClient(supplier.provider as SupplierApiProvider, env);
}
