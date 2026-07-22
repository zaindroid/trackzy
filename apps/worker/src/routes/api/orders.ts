import { Hono } from 'hono';
import { z } from 'zod';
import { and, desc, eq, inArray, like } from 'drizzle-orm';
import {
  createDb,
  disputes,
  fulfillmentLineItems,
  fulfillments,
  orderLineItems,
  orders,
  storefronts,
  webhookEvents,
} from '@fulfillment-tracker/db';
import { detectCarrier } from '@fulfillment-tracker/core';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { newId, now } from '../../lib/id.js';
import { safeGetWorkflowInstance } from '../../lib/workflow.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const createOrderSchema = z.object({
  storefrontId: z.string(),
  externalOrderId: z.string(),
  externalOrderNumber: z.string(),
  currency: z.string().default('USD'),
  subtotalCents: z.number().int(),
  shippingCents: z.number().int().default(0),
  lineItems: z
    .array(
      z.object({
        externalLineItemId: z.string(),
        sku: z.string(),
        title: z.string(),
        quantity: z.number().int().positive(),
        unitPriceCents: z.number().int(),
      }),
    )
    .min(1),
});

const trackingSchema = z.object({
  fulfillmentId: z.string().optional(),
  trackingNumber: z.string().min(4),
  carrier: z.enum(['UPS', 'USPS', 'FEDEX', 'DHL']).optional(),
});

async function userStorefrontIds(db: ReturnType<typeof createDb>, userId: string): Promise<string[]> {
  const rows = await db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.userId, userId));
  return rows.map((r) => r.id);
}

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const sfIds = await userStorefrontIds(db, c.get('userId'));
  if (sfIds.length === 0) return c.json({ orders: [] });

  const status = c.req.query('status');
  const search = c.req.query('search');

  const conditions = [inArray(orders.storefrontId, sfIds)];
  if (status) conditions.push(eq(orders.status, status as (typeof orders.status.enumValues)[number]));
  if (search) conditions.push(like(orders.externalOrderNumber, `%${search}%`));

  const rows = await db
    .select()
    .from(orders)
    .where(and(...conditions))
    .orderBy(desc(orders.createdAt));

  return c.json({ orders: rows });
});

app.post('/', async (c) => {
  const body = createOrderSchema.safeParse(await c.req.json());
  if (!body.success) {
    return errorResponse(c, 'VALIDATION_ERROR', body.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const sfIds = await userStorefrontIds(db, c.get('userId'));
  if (!sfIds.includes(body.data.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Unknown storefront', 404);
  }

  const orderId = newId();
  const timestamp = now();
  await db.batch([
    db.insert(orders).values({
      id: orderId,
      storefrontId: body.data.storefrontId,
      externalOrderId: body.data.externalOrderId,
      externalOrderNumber: body.data.externalOrderNumber,
      status: 'received',
      currency: body.data.currency,
      subtotalCents: body.data.subtotalCents,
      shippingCents: body.data.shippingCents,
      marginCents: null,
      rawPayloadId: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    }),
    ...body.data.lineItems.map((li) =>
      db.insert(orderLineItems).values({
        id: newId(),
        orderId,
        externalLineItemId: li.externalLineItemId,
        fulfillmentOrderLineItemId: null,
        sku: li.sku,
        title: li.title,
        quantity: li.quantity,
        quantityFulfilled: 0,
        unitPriceCents: li.unitPriceCents,
      }),
    ),
  ]);

  await c.env.ORDER_QUEUE.send({ orderId });
  return c.json({ orderId }, 201);
});

app.get('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const sfIds = await userStorefrontIds(db, c.get('userId'));
  const orderId = c.req.param('id');

  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || !sfIds.includes(order.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Order not found', 404);
  }

  const lineItems = await db.select().from(orderLineItems).where(eq(orderLineItems.orderId, orderId));
  const orderFulfillments = await db.select().from(fulfillments).where(eq(fulfillments.orderId, orderId));
  const fulfillmentIds = orderFulfillments.map((f) => f.id);
  const flItems = fulfillmentIds.length
    ? await db.select().from(fulfillmentLineItems).where(inArray(fulfillmentLineItems.fulfillmentId, fulfillmentIds))
    : [];
  const orderDisputes = fulfillmentIds.length
    ? await db.select().from(disputes).where(inArray(disputes.fulfillmentId, fulfillmentIds))
    : [];
  const [rawEvent] = order.rawPayloadId
    ? await db.select().from(webhookEvents).where(eq(webhookEvents.id, order.rawPayloadId))
    : [];

  return c.json({
    order,
    lineItems,
    fulfillments: orderFulfillments.map((f) => ({
      ...f,
      lineItems: flItems.filter((li) => li.fulfillmentId === f.id),
    })),
    disputes: orderDisputes,
    webhookEvent: rawEvent ?? null,
  });
});

app.post('/:id/approve', async (c) => {
  const db = createDb(c.env.DB);
  const sfIds = await userStorefrontIds(db, c.get('userId'));
  const orderId = c.req.param('id');
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || !sfIds.includes(order.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Order not found', 404);
  }
  if (order.status !== 'rejected') {
    return errorResponse(c, 'INVALID_STATE', 'Only rejected orders can be approved', 409);
  }

  await db.update(orders).set({ status: 'evaluating', updatedAt: now() }).where(eq(orders.id, orderId));
  try {
    await c.env.ORDER_WORKFLOW?.create({
      id: `${orderId}:approved:${now()}`,
      params: { orderId, forceApprove: true },
    });
  } catch {
    // Binding absent in test/local-without-workflows environments; DB state is already updated.
  }
  return c.json({ ok: true });
});

app.post('/:id/cancel', async (c) => {
  const db = createDb(c.env.DB);
  const sfIds = await userStorefrontIds(db, c.get('userId'));
  const orderId = c.req.param('id');
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || !sfIds.includes(order.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Order not found', 404);
  }
  if (order.status === 'shipped' || order.status === 'delivered') {
    return errorResponse(c, 'INVALID_STATE', 'Cannot cancel a shipped or delivered order', 409);
  }

  await db.update(orders).set({ status: 'cancelled', updatedAt: now() }).where(eq(orders.id, orderId));
  const instance = await safeGetWorkflowInstance(c.env.ORDER_WORKFLOW, orderId);
  await instance?.terminate().catch(() => undefined);
  return c.json({ ok: true });
});

app.post('/:id/tracking', async (c) => {
  const parsed = trackingSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const sfIds = await userStorefrontIds(db, c.get('userId'));
  const orderId = c.req.param('id');
  const [order] = await db.select().from(orders).where(eq(orders.id, orderId));
  if (!order || !sfIds.includes(order.storefrontId)) {
    return errorResponse(c, 'NOT_FOUND', 'Order not found', 404);
  }

  const targetFulfillmentId =
    parsed.data.fulfillmentId ??
    (await db.select({ id: fulfillments.id }).from(fulfillments).where(eq(fulfillments.orderId, orderId)).limit(1))[0]
      ?.id;
  if (!targetFulfillmentId) {
    return errorResponse(c, 'NOT_FOUND', 'No fulfillment exists for this order yet', 404);
  }

  const detection = detectCarrier(parsed.data.trackingNumber, parsed.data.carrier ?? null);
  if (detection.needsReview) {
    return errorResponse(c, 'VALIDATION_ERROR', 'Tracking number failed carrier validation', 422);
  }

  await db
    .update(fulfillments)
    .set({
      trackingNumber: parsed.data.trackingNumber,
      carrierDeclared: detection.carrierDeclared,
      carrierDetected: detection.carrierDetected,
      carrierFinal: detection.carrierFinal,
      trackingStatus: 'pending',
      source: 'manual',
      updatedAt: now(),
    })
    .where(eq(fulfillments.id, targetFulfillmentId));

  const instance = await safeGetWorkflowInstance(c.env.ORDER_WORKFLOW, orderId);
  await instance?.sendEvent({
    type: 'tracking-received',
    payload: {
      fulfillmentId: targetFulfillmentId,
      trackingNumber: parsed.data.trackingNumber,
      carrierDeclared: detection.carrierFinal ?? undefined,
      source: 'manual',
    },
  });

  return c.json({ ok: true, carrierFinal: detection.carrierFinal });
});

export default app;
