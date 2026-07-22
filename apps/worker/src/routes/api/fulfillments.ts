import { Hono } from 'hono';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { createDb, fulfillments, orders, storefronts } from '@fulfillment-tracker/db';
import { detectCarrier } from '@fulfillment-tracker/core';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const patchSchema = z.object({
  trackingNumber: z.string().min(4).optional(),
  carrierFinal: z.enum(['UPS', 'USPS', 'FEDEX', 'DHL']).optional(),
});

async function userOrderIds(db: ReturnType<typeof createDb>, userId: string): Promise<string[]> {
  const sfRows = await db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.userId, userId));
  const sfIds = sfRows.map((r) => r.id);
  if (sfIds.length === 0) return [];
  const orderRows = await db.select({ id: orders.id }).from(orders).where(inArray(orders.storefrontId, sfIds));
  return orderRows.map((r) => r.id);
}

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  if (orderIds.length === 0) return c.json({ fulfillments: [] });

  const rows = await db.select().from(fulfillments).where(inArray(fulfillments.orderId, orderIds));
  const needsReview = c.req.query('needsReview');
  const filtered = needsReview === 'true' ? rows.filter((f) => f.trackingStatus === 'needs_review') : rows;

  return c.json({ fulfillments: filtered });
});

app.patch('/:id', async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  const fulfillmentId = c.req.param('id');
  const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
  if (!fulfillment || !orderIds.includes(fulfillment.orderId)) {
    return errorResponse(c, 'NOT_FOUND', 'Fulfillment not found', 404);
  }

  const trackingNumber = parsed.data.trackingNumber ?? fulfillment.trackingNumber;
  if (!trackingNumber) {
    return errorResponse(c, 'VALIDATION_ERROR', 'A tracking number is required', 400);
  }

  const detection = detectCarrier(trackingNumber, parsed.data.carrierFinal ?? null);
  if (detection.needsReview) {
    return errorResponse(c, 'VALIDATION_ERROR', 'Tracking number still fails carrier validation', 422);
  }

  await db
    .update(fulfillments)
    .set({
      trackingNumber,
      carrierDeclared: detection.carrierDeclared,
      carrierDetected: detection.carrierDetected,
      carrierFinal: detection.carrierFinal,
      trackingStatus: 'pending',
      source: 'manual',
      updatedAt: now(),
    })
    .where(eq(fulfillments.id, fulfillmentId));

  return c.json({ ok: true, carrierFinal: detection.carrierFinal });
});

export default app;
