import { Hono } from 'hono';
import { eq, inArray } from 'drizzle-orm';
import { createDb, orders, pendingSupplierOrders, storefronts, suppliers } from '@fulfillment-tracker/db';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { approveSupplierOrder, rejectSupplierOrder } from '../../lib/placeSupplierOrder.js';

/**
 * The one-click approval queue for api-kind supplier orders (AliExpress, CJ)
 * — see DECISIONS.md. Everything about each entry (supplier, cost, line
 * items) was already computed autonomously by `placeSupplierOrder`; this is
 * purely the review-and-click surface, plus enough order/supplier context
 * for a human to sanity-check before committing real money.
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
  if (orderIds.length === 0) return c.json({ pendingSupplierOrders: [] });

  const rows = await db.select().from(pendingSupplierOrders).where(inArray(pendingSupplierOrders.orderId, orderIds));
  if (rows.length === 0) return c.json({ pendingSupplierOrders: [] });

  const relevantOrders = await db
    .select({ id: orders.id, externalOrderNumber: orders.externalOrderNumber })
    .from(orders)
    .where(inArray(orders.id, rows.map((r) => r.orderId)));
  const orderById = new Map(relevantOrders.map((o) => [o.id, o]));

  const relevantSuppliers = await db
    .select({ id: suppliers.id, name: suppliers.name })
    .from(suppliers)
    .where(inArray(suppliers.id, rows.map((r) => r.supplierId)));
  const supplierById = new Map(relevantSuppliers.map((s) => [s.id, s]));

  return c.json({
    pendingSupplierOrders: rows.map((r) => ({
      ...r,
      lineItems: JSON.parse(r.lineItemsJson),
      externalOrderNumber: orderById.get(r.orderId)?.externalOrderNumber,
      supplierName: supplierById.get(r.supplierId)?.name,
    })),
  });
});

app.post('/:id/approve', async (c) => {
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  const id = c.req.param('id');
  const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, id));
  if (!pending || !orderIds.includes(pending.orderId)) {
    return errorResponse(c, 'NOT_FOUND', 'Pending supplier order not found', 404);
  }
  if (pending.status !== 'pending') {
    return errorResponse(c, 'INVALID_STATE', `Already ${pending.status}`, 409);
  }

  await approveSupplierOrder(db, c.env, id);
  return c.json({ ok: true });
});

app.post('/:id/reject', async (c) => {
  const db = createDb(c.env.DB);
  const orderIds = await userOrderIds(db, c.get('userId'));
  const id = c.req.param('id');
  const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, id));
  if (!pending || !orderIds.includes(pending.orderId)) {
    return errorResponse(c, 'NOT_FOUND', 'Pending supplier order not found', 404);
  }
  if (pending.status !== 'pending') {
    return errorResponse(c, 'INVALID_STATE', `Already ${pending.status}`, 409);
  }

  await rejectSupplierOrder(db, id);
  return c.json({ ok: true });
});

export default app;
