import { storefronts, type Database } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { createEbayOrderSource } from '@fulfillment-tracker/adapters/ebay';
import { createAmazonOrderSource } from '@fulfillment-tracker/adapters/amazon';
import type { OrderSource } from '@fulfillment-tracker/adapters/orderSource';
import type { Env } from '../env.js';
import { resolveSecretRef } from './secretRef.js';

/**
 * Resolves the right `OrderSource` for a storefront (eBay or Amazon —
 * Shopify is intentionally excluded, see DECISIONS.md milestone 2), wiring
 * up its OAuth tokens and a refresh callback that persists a renewed
 * `oauthExpiresAt` back onto the `storefronts` row. Shared by the repricing
 * sweep and, from milestone 9, the messaging engine — both need "give me a
 * live OrderSource for this storefront" and neither should re-derive the
 * OAuth plumbing independently.
 */
export async function createOrderSourceForStorefront(
  env: Env,
  db: Database,
  storefront: typeof storefronts.$inferSelect,
): Promise<OrderSource | null> {
  if (!storefront.oauthAccessTokenRef || !storefront.oauthRefreshTokenRef) {
    return null; // storefront has no OAuth connection configured
  }

  const tokens = {
    accessToken: resolveSecretRef(storefront.oauthAccessTokenRef, env),
    refreshToken: resolveSecretRef(storefront.oauthRefreshTokenRef, env),
    expiresAt: storefront.oauthExpiresAt ?? 0,
  };
  const onTokenRefreshed = async (refreshed: { expiresAt: number }) => {
    await db.update(storefronts).set({ oauthExpiresAt: refreshed.expiresAt }).where(eq(storefronts.id, storefront.id));
  };

  if (storefront.platform === 'ebay') {
    return createEbayOrderSource(env, tokens, onTokenRefreshed, storefront.nonApiMode === 1);
  }
  if (storefront.platform === 'amazon') {
    return createAmazonOrderSource(env, tokens, onTokenRefreshed);
  }
  return null; // shopify (or any future platform without an OrderSource implementation)
}
