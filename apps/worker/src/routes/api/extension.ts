import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { createDb, fulfillments, manualTasks, orders, storefronts, trackingEvents } from '@fulfillment-tracker/db';
import { shouldRouteThroughTrackingProxy, type Carrier } from '@fulfillment-tracker/core';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';
import { completeManualProxyConversion } from '../../trackingUploader.js';

/**
 * Endpoints the Manifest V3 Chrome Extension polls directly (spec 6d, 5a).
 * Uses the same authed-API pattern as the rest of `/api/*` — the extension
 * stores the user's bearer token exactly like the dashboard does (see
 * apps/extension), so no separate auth scheme was needed.
 */
const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

async function userOrderIds(db: ReturnType<typeof createDb>, userId: string): Promise<string[]> {
  const sfRows = await db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.userId, userId));
  const sfIds = sfRows.map((r) => r.id);
  if (sfIds.length === 0) return [];
  const orderRows = await db.select({ id: orders.id }).from(orders).where(inArray(orders.storefrontId, sfIds));
  return orderRows.map((r) => r.id);
}

/**
 * The content script calls this when it detects a supplier checkout page, to
 * find the address it should 1-click paste (spec 6d "PasteMe" parity). Single-
 * tenant simplification: returns the oldest `claimed` task, since the schema
 * has no per-supplier checkout-domain column to match against more precisely
 * — see DECISIONS.md.
 */
app.get('/active-manual-task', async (c) => {
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  if (orderIds.length === 0) return c.json({ task: null });

  const [task] = await db
    .select()
    .from(manualTasks)
    .where(and(inArray(manualTasks.orderId, orderIds), eq(manualTasks.state, 'claimed')))
    .orderBy(manualTasks.createdAt)
    .limit(1);

  if (!task) return c.json({ task: null });
  return c.json({ task: { ...task, payload: JSON.parse(task.payloadJson) } });
});

/**
 * The non-API-mode tracking-upload queue (spec 5a/7): fulfillments whose
 * owning storefront bypasses the eBay Fulfillment API and needs the
 * extension to paste the (already-proxied, if applicable) tracking number
 * directly into eBay's DOM. Reuses existing `fulfillments` columns rather
 * than a dedicated queue table — see DECISIONS.md milestone 2.
 */
app.get('/pending-tracking-uploads', async (c) => {
  const db = createDb(c.env.DB);
  const nonApiStorefronts = await db
    .select({ id: storefronts.id })
    .from(storefronts)
    .where(and(eq(storefronts.userId, c.get('userId')), eq(storefronts.nonApiMode, 1)));
  const storefrontIds = nonApiStorefronts.map((s) => s.id);
  if (storefrontIds.length === 0) return c.json({ uploads: [] });

  const relevantOrders = await db
    .select({ id: orders.id, externalOrderId: orders.externalOrderId, externalOrderNumber: orders.externalOrderNumber })
    .from(orders)
    .where(inArray(orders.storefrontId, storefrontIds));
  const orderById = new Map(relevantOrders.map((o) => [o.id, o]));
  if (relevantOrders.length === 0) return c.json({ uploads: [] });

  const rows = await db
    .select()
    .from(fulfillments)
    .where(
      and(
        inArray(fulfillments.orderId, relevantOrders.map((o) => o.id)),
        eq(fulfillments.pushedToStorefront, 0),
        isNotNull(fulfillments.trackingNumber),
      ),
    );

  // Prefer the most recent proxied tracking number/carrier over the
  // fulfillment's raw one — e.g. an Amazon Logistics (TBA...) or
  // AliExpress/Temu carrier must never reach eBay's DOM un-proxied (spec 7
  // hard rule). A fulfillment that NEEDS proxying but has no proxied event
  // yet is excluded entirely rather than falling back to its raw tracking
  // number — this queue is "ready to paste into eBay," not "here's
  // whatever we've got"; it surfaces separately from
  // pending-tracking-proxy-conversions below until a human supplies a
  // converted number.
  const uploads = (
    await Promise.all(
      rows.map(async (f) => {
        const [latestEvent] = await db
          .select({ proxyTracking: trackingEvents.proxyTracking, proxyCarrier: trackingEvents.proxyCarrier })
          .from(trackingEvents)
          .where(and(eq(trackingEvents.fulfillmentId, f.id), isNotNull(trackingEvents.proxyTracking)))
          .orderBy(desc(trackingEvents.createdAt))
          .limit(1);

        if (!latestEvent && shouldRouteThroughTrackingProxy(f.carrierFinal as Carrier | null, 'ebay')) {
          return null; // still awaiting a manual TrackCaptain claim — not safe to upload yet
        }

        return {
          fulfillmentId: f.id,
          externalOrderId: orderById.get(f.orderId)?.externalOrderId,
          externalOrderNumber: orderById.get(f.orderId)?.externalOrderNumber,
          trackingNumber: latestEvent?.proxyTracking ?? f.trackingNumber,
          carrier: latestEvent?.proxyCarrier ?? f.carrierFinal,
        };
      }),
    )
  ).filter((u): u is NonNullable<typeof u> => u !== null);

  return c.json({ uploads });
});

/**
 * The manual tracking-proxy-conversion queue: fulfillments whose tracking
 * number eBay won't natively recognize (Amazon Logistics, or an
 * AliExpress/Temu carrier — see shouldRouteThroughTrackingProxy) and that
 * have no converted number recorded yet. No automated proxy API exists in
 * production (Bluecare Express and Aquiline are both blocked by eBay — see
 * DECISIONS.md), so a human claims a converted number by hand (e.g. via
 * TrackCaptain's dashboard, see content/trackCaptain.ts) and submits it
 * through the /complete endpoint below.
 */
app.get('/pending-tracking-proxy-conversions', async (c) => {
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  if (orderIds.length === 0) return c.json({ conversions: [] });

  const relevantOrders = await db
    .select({ id: orders.id, storefrontId: orders.storefrontId, externalOrderId: orders.externalOrderId, externalOrderNumber: orders.externalOrderNumber })
    .from(orders)
    .where(inArray(orders.id, orderIds));
  const orderById = new Map(relevantOrders.map((o) => [o.id, o]));

  const relevantStorefronts = await db
    .select({ id: storefronts.id, platform: storefronts.platform })
    .from(storefronts)
    .where(inArray(storefronts.id, relevantOrders.map((o) => o.storefrontId)));
  const platformByStorefrontId = new Map(relevantStorefronts.map((s) => [s.id, s.platform]));

  const rows = await db
    .select()
    .from(fulfillments)
    .where(and(inArray(fulfillments.orderId, orderIds), eq(fulfillments.pushedToStorefront, 0), isNotNull(fulfillments.trackingNumber)));

  const conversions = (
    await Promise.all(
      rows.map(async (f) => {
        const order = orderById.get(f.orderId);
        const platform = order ? platformByStorefrontId.get(order.storefrontId) : undefined;
        if (!order || !platform || !shouldRouteThroughTrackingProxy(f.carrierFinal as Carrier | null, platform)) return null;

        const [existing] = await db
          .select({ id: trackingEvents.id })
          .from(trackingEvents)
          .where(and(eq(trackingEvents.fulfillmentId, f.id), isNotNull(trackingEvents.proxyTracking)))
          .limit(1);
        if (existing) return null; // already converted — will surface in pending-tracking-uploads instead

        return {
          fulfillmentId: f.id,
          externalOrderId: order.externalOrderId,
          externalOrderNumber: order.externalOrderNumber,
          originalTrackingNumber: f.trackingNumber,
          originalCarrier: f.carrierFinal,
        };
      }),
    )
  ).filter((u): u is NonNullable<typeof u> => u !== null);

  return c.json({ conversions });
});

const completeProxyConversionSchema = z.object({
  trackingNumber: z.string().min(1),
  carrier: z.string().min(1),
});

app.post('/pending-tracking-proxy-conversions/:fulfillmentId/complete', async (c) => {
  const parsed = completeProxyConversionSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  const fulfillmentId = c.req.param('fulfillmentId');
  const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
  if (!fulfillment || !orderIds.includes(fulfillment.orderId)) {
    return errorResponse(c, 'NOT_FOUND', 'Fulfillment not found', 404);
  }

  const result = await completeManualProxyConversion(c.env, fulfillmentId, parsed.data.trackingNumber, parsed.data.carrier);
  return c.json({ ok: true, ...result });
});

app.post('/pending-tracking-uploads/:fulfillmentId/complete', async (c) => {
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  const fulfillmentId = c.req.param('fulfillmentId');
  const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
  if (!fulfillment || !orderIds.includes(fulfillment.orderId)) {
    return errorResponse(c, 'NOT_FOUND', 'Fulfillment not found', 404);
  }

  await db
    .update(fulfillments)
    .set({ pushedToStorefront: 1, updatedAt: now() })
    .where(eq(fulfillments.id, fulfillmentId));

  return c.json({ ok: true });
});

export default app;
