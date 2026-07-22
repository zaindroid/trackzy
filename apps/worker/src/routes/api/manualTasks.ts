import { Hono } from 'hono';
import { z } from 'zod';
import { eq, inArray } from 'drizzle-orm';
import { createDb, manualTasks, orders, storefronts } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { now } from '../../lib/id.js';

/**
 * Backend for the dashboard's "Buy Queue" page (spec 6d): lists MANUAL-supplier
 * orders awaiting a human to place them on the actual supplier site, and the
 * claim -> mark-ordered lifecycle the Chrome Extension's "Mark ordered" button
 * drives (spec 6d: "Clicking 'Mark ordered' fires the manual-order-placed
 * event. Automation resumes, waiting for the Gmail Parsing Engine...").
 */
const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

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
  if (orderIds.length === 0) return c.json({ manualTasks: [] });

  const rows = await db.select().from(manualTasks).where(inArray(manualTasks.orderId, orderIds));
  const state = c.req.query('state');
  const filtered = state ? rows.filter((t) => t.state === state) : rows;

  return c.json({ manualTasks: filtered });
});

app.post('/:id/claim', async (c) => {
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  const taskId = c.req.param('id');
  const [task] = await db.select().from(manualTasks).where(eq(manualTasks.id, taskId));
  if (!task || !orderIds.includes(task.orderId)) {
    return errorResponse(c, 'NOT_FOUND', 'Manual task not found', 404);
  }
  if (task.state !== 'pending') {
    return errorResponse(c, 'INVALID_STATE', `Only pending tasks can be claimed (current state: ${task.state})`, 409);
  }

  await db.update(manualTasks).set({ state: 'claimed', updatedAt: now() }).where(eq(manualTasks.id, taskId));
  return c.json({ ok: true });
});

const markOrderedSchema = z.object({
  supplierOrderRef: z.string().min(1).optional(),
});

app.post('/:id/mark-ordered', async (c) => {
  const parsed = markOrderedSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) {
    return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);
  }
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  const taskId = c.req.param('id');
  const [task] = await db.select().from(manualTasks).where(eq(manualTasks.id, taskId));
  if (!task || !orderIds.includes(task.orderId)) {
    return errorResponse(c, 'NOT_FOUND', 'Manual task not found', 404);
  }
  if (task.state !== 'claimed') {
    return errorResponse(c, 'INVALID_STATE', `Only claimed tasks can be marked ordered (current state: ${task.state})`, 409);
  }

  const payload = JSON.parse(task.payloadJson) as Record<string, unknown>;
  if (parsed.data.supplierOrderRef) {
    payload.supplierOrderRef = parsed.data.supplierOrderRef;
  }

  await db
    .update(manualTasks)
    .set({ state: 'ordered', payloadJson: JSON.stringify(payload), updatedAt: now() })
    .where(eq(manualTasks.id, taskId));

  // From here, automation resumes via the Gmail Parsing Engine (milestone 5)
  // picking up the supplier's shipping-confirmation email and resolving
  // tracking onto this task's fulfillment — no further action needed here.
  return c.json({ ok: true });
});

app.post('/:id/abandon', async (c) => {
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  const taskId = c.req.param('id');
  const [task] = await db.select().from(manualTasks).where(eq(manualTasks.id, taskId));
  if (!task || !orderIds.includes(task.orderId)) {
    return errorResponse(c, 'NOT_FOUND', 'Manual task not found', 404);
  }
  if (task.state === 'ordered') {
    return errorResponse(c, 'INVALID_STATE', 'Cannot abandon a task that has already been ordered', 409);
  }

  await db.update(manualTasks).set({ state: 'abandoned', updatedAt: now() }).where(eq(manualTasks.id, taskId));
  return c.json({ ok: true });
});

export default app;
