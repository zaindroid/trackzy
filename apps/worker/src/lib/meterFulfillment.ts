import { eq } from 'drizzle-orm';
import { orders, storefronts, users, type Database } from '@fulfillment-tracker/db';
import type { Env } from '../env.js';

/**
 * Best-effort, NON-BLOCKING meter of a fulfilled order against the Zearch
 * platform credit balance (which lives in the sourcing worker's DB). Called
 * when trackzy auto-places a supplier order. Dormant unless both SOURCING_BASE_URL
 * and INTERNAL_SERVICE_TOKEN are configured — so it can never affect the existing
 * trackzy fulfillment pipeline. Every failure is swallowed: fulfillment is
 * post-sale and must never be blocked or failed by metering.
 */
export async function meterFulfillment(db: Database, env: Env, orderId: string): Promise<void> {
  if (!env.SOURCING_BASE_URL || !env.INTERNAL_SERVICE_TOKEN) return;
  try {
    const [row] = await db
      .select({ clerkUserId: users.clerkUserId })
      .from(orders)
      .innerJoin(storefronts, eq(orders.storefrontId, storefronts.id))
      .innerJoin(users, eq(storefronts.userId, users.id))
      .where(eq(orders.id, orderId))
      .limit(1);
    if (!row?.clerkUserId) return;

    await fetch(`${env.SOURCING_BASE_URL}/internal/fulfillment-charge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${env.INTERNAL_SERVICE_TOKEN}` },
      body: JSON.stringify({ clerkUserId: row.clerkUserId, orderId }),
    });
  } catch (err) {
    console.error('[meterFulfillment] non-fatal:', err);
  }
}
