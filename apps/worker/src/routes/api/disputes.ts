import { Hono } from 'hono';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { createDb, disputes, fulfillments, orders, storefronts } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

const patchSchema = z.object({
  draftSubject: z.string().min(1).optional(),
  draftBody: z.string().min(1).optional(),
  status: z.enum(['draft', 'approved', 'sent', 'resolved', 'rejected']).optional(),
});

async function userFulfillmentIds(db: ReturnType<typeof createDb>, userId: string): Promise<string[]> {
  const sfRows = await db.select({ id: storefronts.id }).from(storefronts).where(eq(storefronts.userId, userId));
  const sfIds = sfRows.map((r) => r.id);
  if (sfIds.length === 0) return [];
  const orderRows = await db.select({ id: orders.id }).from(orders).where(inArray(orders.storefrontId, sfIds));
  const orderIds = orderRows.map((r) => r.id);
  if (orderIds.length === 0) return [];
  const ffRows = await db.select({ id: fulfillments.id }).from(fulfillments).where(inArray(fulfillments.orderId, orderIds));
  return ffRows.map((r) => r.id);
}

app.get('/', async (c) => {
  const db = createDb(c.env.DB);
  const fulfillmentIds = await userFulfillmentIds(db, c.get('userId'));
  if (fulfillmentIds.length === 0) return c.json({ disputes: [] });
  const rows = await db.select().from(disputes).where(inArray(disputes.fulfillmentId, fulfillmentIds));
  return c.json({ disputes: rows });
});

app.get('/:id', async (c) => {
  const db = createDb(c.env.DB);
  const fulfillmentIds = await userFulfillmentIds(db, c.get('userId'));
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, c.req.param('id')));
  if (!dispute || !fulfillmentIds.includes(dispute.fulfillmentId)) {
    return errorResponse(c, 'NOT_FOUND', 'Dispute not found', 404);
  }
  return c.json({ dispute });
});

app.patch('/:id', async (c) => {
  const parsed = patchSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const fulfillmentIds = await userFulfillmentIds(db, c.get('userId'));
  const disputeId = c.req.param('id');
  const [dispute] = await db.select().from(disputes).where(eq(disputes.id, disputeId));
  if (!dispute || !fulfillmentIds.includes(dispute.fulfillmentId)) {
    return errorResponse(c, 'NOT_FOUND', 'Dispute not found', 404);
  }

  // Approving immediately "sends" via the placeholder email adapter (spec
  // section 8: "approved -> marked sent; real sending is a placeholder adapter").
  // TODO(HUMAN): wire packages/adapters real email sending through env.DISPUTE_EMAIL
  // (Cloudflare send_email binding) once a verified sending domain is configured.
  const finalStatus = parsed.data.status === 'approved' ? 'sent' : parsed.data.status;

  await db
    .update(disputes)
    .set({
      ...(parsed.data.draftSubject !== undefined && { draftSubject: parsed.data.draftSubject }),
      ...(parsed.data.draftBody !== undefined && { draftBody: parsed.data.draftBody }),
      ...(finalStatus !== undefined && { status: finalStatus }),
      updatedAt: now(),
    })
    .where(eq(disputes.id, disputeId));

  return c.json({ ok: true, status: finalStatus ?? dispute.status });
});

export default app;
