import { supplierConnections, type Database } from '@sourcing/db';
import { and, eq } from 'drizzle-orm';
import { createCjClient, type SupplierApiClient } from '@fulfillment-tracker/adapters/supplierApi';
import type { Env } from '../env.js';
import { decryptCredential } from './credentialCrypto.js';

/**
 * Builds a supplier product-search client for a user's connected supplier.
 * v1 is CJ-only (its search is reliable; AliExpress's is not — see
 * DECISIONS.md, deferred to phase 2). Returns `null` when the user hasn't
 * connected the given provider. In mock mode the returned client is CJ's
 * mock regardless of the (possibly absent) token.
 */
export async function createSupplierClientForUser(
  env: Env,
  db: Database,
  userId: string,
  provider: 'cj' = 'cj',
): Promise<SupplierApiClient | null> {
  const [conn] = await db
    .select()
    .from(supplierConnections)
    .where(and(eq(supplierConnections.userId, userId), eq(supplierConnections.provider, provider)));
  if (!conn) return null;

  const apiKey = await decryptCredential(env, conn.apiKeyRef);
  return createCjClient({ MOCK_MODE: env.MOCK_MODE, CJ_API_KEY: apiKey, CJ_BASE_URL: conn.apiBaseUrl });
}
