import { eq } from 'drizzle-orm';
import { orders, storefronts, type Database } from '@fulfillment-tracker/db';
import type { Env } from '../env.js';
import { safeGetWorkflowInstance } from './workflow.js';
import { createOrderSourceForStorefront } from './orderSourceForStorefront.js';
import { pushTrackingWithProxy } from '../trackingUploader.js';
import type { TrackingReceivedEvent } from '../workflows/types.js';

/**
 * Single place email.ts and gmailIngestion.ts hand off once a fulfillment's
 * tracking number/carrier has just been written — branches on the owning
 * order's storefront platform, since Shopify and eBay/Amazon fulfill
 * tracking completely differently. Shopify sends a workflow event (the
 * pre-existing Phase 1 path — `OrderWorkflow` is Shopify-only, see
 * DECISIONS.md); eBay/Amazon have no such workflow instance (their orders
 * arrive via `marketplaceSync.ts`'s polling, not a webhook-triggered
 * Workflow), so this calls `pushTrackingWithProxy` directly instead — the
 * same middleware that enforces the tracking-proxy hard rule either way.
 */
export async function notifyTrackingReceived(
  env: Env,
  db: Database,
  fulfillmentId: string,
  orderId: string,
  event: TrackingReceivedEvent,
): Promise<void> {
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order) return;
  const [storefront] = await db.select().from(storefronts).where(eq(storefronts.id, order.storefrontId));
  if (!storefront) return;

  if (storefront.platform === 'shopify') {
    const instance = await safeGetWorkflowInstance(env.ORDER_WORKFLOW, orderId);
    await instance?.sendEvent({ type: 'tracking-received', payload: event });
    return;
  }

  const orderSource = await createOrderSourceForStorefront(env, db, storefront);
  if (!orderSource) return; // storefront has no OAuth configured yet — tracking stays recorded but unpushed
  await pushTrackingWithProxy(env, orderSource, fulfillmentId);
}
