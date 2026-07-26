import type { Env } from '../env.js';

export interface SourcedListingHandoff {
  ebayItemId: string;
  sku: string;
  supplierProvider: string;
  supplierProductId: string;
  costCents: number;
  imageUrl?: string;
  title: string;
  priceCents: number;
}

/**
 * Best-effort notify trackzy that this SKU was sourced from a specific
 * supplier product, so trackzy fulfills it with a *deterministic* match
 * instead of re-deriving one. Authenticated by forwarding the same Clerk
 * bearer token the sourcing request carried — both products share one Clerk
 * app, so trackzy's authMiddleware resolves the same user. Never throws:
 * fulfillment degrades gracefully to trackzy's own supplier matching if this
 * fails or `TRACKZY_BASE_URL` isn't configured (see the plan).
 */
export async function notifyTrackzy(env: Env, bearerToken: string | undefined, payload: SourcedListingHandoff): Promise<void> {
  if (!env.TRACKZY_BASE_URL || !bearerToken) return;
  try {
    await fetch(`${env.TRACKZY_BASE_URL}/api/external/sourced-listing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: bearerToken },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    console.error('[trackzyHandoff] failed (non-fatal):', err);
  }
}
