import { eq } from 'drizzle-orm';
import { fulfillments, manualTasks, orderLineItems, orders, pendingSupplierOrders, suppliers, type Database } from '@fulfillment-tracker/db';
import { createSupplierClient } from '@fulfillment-tracker/adapters/suppliers';
import type { OrderSourceShipTo } from '@fulfillment-tracker/adapters/orderSource';
import type { Env } from '../env.js';
import { newId, now } from './id.js';

export interface PlaceSupplierOrderLineItem {
  sku: string;
  quantity: number;
  title?: string;
}

export interface PlaceSupplierOrderOptions {
  /** Buyer shipping address — required for the manual-task/Buy Queue paste-address flow. Not needed for 'api' suppliers. */
  shipTo?: OrderSourceShipTo;
  buyerName?: string;
  /** Defaults to every orderLineItems row for orderId when omitted. */
  lineItems?: PlaceSupplierOrderLineItem[];
}

/**
 * Places a supplier order for one fulfillment, branching on `supplier.kind`
 * — the branch that was missing everywhere this used to be inlined (see
 * DECISIONS.md): a 'manual' supplier (Amazon Retail, Temu — no real ordering
 * API for either) creates a `manual_tasks` row instead of calling
 * `createOrder` against an empty/nonexistent `apiBaseUrl`. An 'api' supplier
 * (AliExpress, CJ) — the one that actually spends real money — doesn't call
 * `SupplierClient.createOrder` directly either anymore: it queues a
 * `pending_supplier_orders` row instead and stops there. Everything about
 * the order (which supplier, cost, line items) is already fully computed by
 * the time this runs; only the real money-spending API call itself waits
 * for a human's one-click approval via `approveSupplierOrder` below — the
 * same kind of checkpoint manual suppliers already get for free through the
 * Buy Queue, extended to cover the case with zero human checkpoint before
 * this (see DECISIONS.md). Before the manual_tasks fix, nothing in
 * production code ever inserted a `manual_tasks` row at all — the entire Buy
 * Queue / Chrome extension flow had a fully-built consumer and no producer.
 */
export async function placeSupplierOrder(
  db: Database,
  env: Env,
  orderId: string,
  supplierId: string,
  supplierCostCents: number,
  opts: PlaceSupplierOrderOptions = {},
): Promise<string> {
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, supplierId));
  if (!supplier) throw new Error(`Supplier ${supplierId} not found`);

  const fulfillmentId = newId();
  await db.insert(fulfillments).values({
    id: fulfillmentId,
    orderId,
    supplierId,
    costCents: supplierCostCents,
    trackingNumber: null,
    carrierDeclared: null,
    carrierDetected: null,
    carrierFinal: null,
    trackingStatus: 'pending',
    pushedToStorefront: 0,
    source: 'supplier_api',
    createdAt: now(),
    updatedAt: now(),
  });

  const lineItems =
    opts.lineItems ??
    (await db
      .select({ sku: orderLineItems.sku, quantity: orderLineItems.quantity, title: orderLineItems.title })
      .from(orderLineItems)
      .where(eq(orderLineItems.orderId, orderId)));

  if (supplier.kind === 'manual') {
    await db.insert(manualTasks).values({
      id: newId(),
      orderId,
      supplierId,
      state: 'pending',
      payloadJson: JSON.stringify({ lineItems, shipTo: opts.shipTo, buyerName: opts.buyerName }),
      createdAt: now(),
      updatedAt: now(),
    });
  } else {
    await db.insert(pendingSupplierOrders).values({
      id: newId(),
      fulfillmentId,
      orderId,
      supplierId,
      costCents: supplierCostCents,
      lineItemsJson: JSON.stringify(lineItems),
      status: 'pending',
      createdAt: now(),
    });
  }

  return fulfillmentId;
}

/**
 * The one-click "yes, actually spend the money" step for an api-kind
 * supplier's pending order — everything else about the order was already
 * computed autonomously by `placeSupplierOrder` above; this is purely "make
 * the real API call now." Idempotent against double-approval (a second
 * click, a retried request): returns early if the row isn't still 'pending'
 * rather than placing the same order with the supplier twice.
 */
export async function approveSupplierOrder(db: Database, env: Env, pendingOrderId: string): Promise<void> {
  const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, pendingOrderId));
  if (!pending) throw new Error(`Pending supplier order ${pendingOrderId} not found`);
  if (pending.status !== 'pending') return; // already approved or rejected — no-op

  const [order] = await db.select().from(orders).where(eq(orders.id, pending.orderId));
  if (!order) throw new Error(`Order ${pending.orderId} not found`);
  const [supplier] = await db.select().from(suppliers).where(eq(suppliers.id, pending.supplierId));
  if (!supplier) throw new Error(`Supplier ${pending.supplierId} not found`);

  const lineItems = JSON.parse(pending.lineItemsJson) as PlaceSupplierOrderLineItem[];
  const supplierClient = createSupplierClient(env);
  await supplierClient.createOrder(supplier.apiBaseUrl, {
    externalOrderRef: order.externalOrderNumber,
    lineItems: lineItems.map((li) => ({ sku: li.sku, quantity: li.quantity })),
  });

  await db
    .update(pendingSupplierOrders)
    .set({ status: 'approved', decidedAt: now() })
    .where(eq(pendingSupplierOrders.id, pendingOrderId));
}

/** Declines a pending supplier order — never calls the supplier's API. The fulfillment shell is left as-is for the user to handle via the existing order actions (see routes/api/orders.ts). */
export async function rejectSupplierOrder(db: Database, pendingOrderId: string): Promise<void> {
  const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, pendingOrderId));
  if (!pending) throw new Error(`Pending supplier order ${pendingOrderId} not found`);
  if (pending.status !== 'pending') return;

  await db
    .update(pendingSupplierOrders)
    .set({ status: 'rejected', decidedAt: now() })
    .where(eq(pendingSupplierOrders.id, pendingOrderId));
}
