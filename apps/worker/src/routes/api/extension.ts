import { Hono } from 'hono';
import { and, eq, inArray, isNotNull } from 'drizzle-orm';
import { createDb, fulfillments, manualTasks, orders, storefronts } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';

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

  const uploads = rows.map((f) => ({
    fulfillmentId: f.id,
    externalOrderId: orderById.get(f.orderId)?.externalOrderId,
    externalOrderNumber: orderById.get(f.orderId)?.externalOrderNumber,
    trackingNumber: f.trackingNumber,
    carrier: f.carrierFinal,
  }));

  return c.json({ uploads });
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
