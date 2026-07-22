import { createDb, fulfillments, orders, storefronts, trackingEvents, type Database } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { shouldRouteThroughTrackingProxy, type Carrier } from '@fulfillment-tracker/core';
import { createTrackingProxyClient } from '@fulfillment-tracker/adapters/trackingProxy';
import { NonApiModeError } from '@fulfillment-tracker/adapters/ebay';
import type { OrderSource } from '@fulfillment-tracker/adapters/orderSource';
import type { Env } from './env.js';
import { newId, now } from './lib/id.js';
import { sendBuyerMessage } from './messaging.js';

export interface PushTrackingResult {
  pushed: boolean;
  proxied: boolean;
}

/**
 * Tracking Uploader Middleware (spec section 7): the single place every
 * marketplace tracking push goes through, so the Amazon-Logistics-to-eBay
 * proxy rule can never be silently bypassed by a caller pushing tracking
 * directly through `OrderSource.pushTracking`. Always records a
 * `tracking_events` row (proxied or not) before attempting the push, so the
 * audit trail exists even if the push itself fails.
 */
export async function pushTrackingWithProxy(
  env: Env,
  orderSource: OrderSource,
  fulfillmentId: string,
  lineItemIds?: string[],
): Promise<PushTrackingResult> {
  const db = createDb(env.DB);
  const [row] = await db
    .select({
      orderId: fulfillments.orderId,
      trackingNumber: fulfillments.trackingNumber,
      carrierFinal: fulfillments.carrierFinal,
      externalOrderId: orders.externalOrderId,
      platform: storefronts.platform,
    })
    .from(fulfillments)
    .innerJoin(orders, eq(fulfillments.orderId, orders.id))
    .innerJoin(storefronts, eq(orders.storefrontId, storefronts.id))
    .where(eq(fulfillments.id, fulfillmentId));

  if (!row || !row.trackingNumber) {
    throw new Error(`Fulfillment ${fulfillmentId} has no tracking number to push`);
  }

  let trackingToPush = row.trackingNumber;
  let carrierToPush = row.carrierFinal ?? 'UNKNOWN';
  let proxied = false;

  if (shouldRouteThroughTrackingProxy(row.carrierFinal as Carrier | null, row.platform)) {
    const proxyClient = createTrackingProxyClient(env);
    const conversion = await proxyClient.convertTracking(row.trackingNumber, carrierToPush);
    trackingToPush = conversion.proxyTracking;
    carrierToPush = conversion.proxyCarrier;
    proxied = true;
    await recordTrackingEvent(db, fulfillmentId, row.trackingNumber, conversion.proxyTracking, conversion.proxyCarrier);
  } else {
    await recordTrackingEvent(db, fulfillmentId, row.trackingNumber, null, null);
  }

  try {
    await orderSource.pushTracking(row.externalOrderId, {
      trackingNumber: trackingToPush,
      carrier: carrierToPush,
      lineItemIds,
    });
    await db.update(fulfillments).set({ pushedToStorefront: 1, updatedAt: now() }).where(eq(fulfillments.id, fulfillmentId));
    await sendBuyerMessage(env, row.orderId, 'shipped').catch(() => undefined); // best-effort — never fail the push over a messaging hiccup
    return { pushed: true, proxied };
  } catch (err) {
    if (err instanceof NonApiModeError) {
      // Not pushed via the API — fulfillments.pushedToStorefront stays 0.
      // The Chrome Extension completes this out-of-band once a human
      // uploads `trackingToPush` through eBay's own DOM (spec 5a), via
      // POST /api/extension/pending-tracking-uploads/:id/complete.
      return { pushed: false, proxied };
    }
    throw err;
  }
}

async function recordTrackingEvent(
  db: Database,
  fulfillmentId: string,
  originalTracking: string,
  proxyTracking: string | null,
  proxyCarrier: string | null,
): Promise<void> {
  await db.insert(trackingEvents).values({
    id: newId(),
    fulfillmentId,
    originalTracking,
    proxyTracking,
    proxyCarrier,
    status: 'pending',
    rawStatus: null,
    createdAt: now(),
  });
}
