import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, fulfillments, manualTasks, orderLineItems, orders, pendingSupplierOrders, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { approveSupplierOrder, placeSupplierOrder, rejectSupplierOrder } from './placeSupplierOrder.js';

const USER_ID = 'usr_pso_test';
const STOREFRONT_ID = 'sf_pso_test';
const API_SUPPLIER_ID = 'sup_pso_api';
const MANUAL_SUPPLIER_ID = 'sup_pso_manual';
const ORDER_ID = 'ord_pso_test';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-pso', email: 'pso@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'ebay-store-pso',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_CLIENT_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values([
    {
      id: API_SUPPLIER_ID,
      userId: USER_ID,
      name: 'CJ Dropshipping',
      apiBaseUrl: 'https://api.cjdropshipping.example.com',
      apiKeyRef: 'env:CJ_API_KEY',
      emailSenderPattern: '@cjdropshipping.example.com',
      parserId: 'cj-v1',
      kind: 'api',
      provider: 'cj',
      active: 1,
      createdAt: 0,
    },
    {
      id: MANUAL_SUPPLIER_ID,
      userId: USER_ID,
      name: 'Temu',
      apiBaseUrl: '',
      apiKeyRef: 'env:SUPPLIER_API_KEY',
      emailSenderPattern: '@temu.com',
      parserId: 'temu-v1',
      kind: 'manual',
      provider: 'manual',
      active: 1,
      createdAt: 0,
    },
  ]);
  await db.insert(orders).values({
    id: ORDER_ID,
    storefrontId: STOREFRONT_ID,
    externalOrderId: 'ebay-order-pso-1',
    externalOrderNumber: '#EB-PSO-1',
    status: 'evaluating',
    currency: 'USD',
    subtotalCents: 5000,
    shippingCents: 500,
    marginCents: null,
    rawPayloadId: null,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(orderLineItems).values({
    id: 'li_pso_1',
    orderId: ORDER_ID,
    externalLineItemId: 'ext-li-1',
    fulfillmentOrderLineItemId: null,
    sku: 'GADGET-1',
    title: 'Gadget',
    quantity: 2,
    quantityFulfilled: 0,
    unitPriceCents: 2000,
  });
});

describe('placeSupplierOrder', () => {
  it('creates a fulfillment shell and a pending approval row for an api-kind supplier — does NOT call the supplier API immediately', async () => {
    const db = createDb(env.DB);
    const fulfillmentId = await placeSupplierOrder(db, env, ORDER_ID, API_SUPPLIER_ID, 1500);

    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
    expect(fulfillment?.supplierId).toBe(API_SUPPLIER_ID);
    expect(fulfillment?.costCents).toBe(1500);

    const tasks = await db.select().from(manualTasks).where(eq(manualTasks.orderId, ORDER_ID));
    expect(tasks).toHaveLength(0);

    const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.fulfillmentId, fulfillmentId));
    expect(pending?.status).toBe('pending');
    expect(pending?.supplierId).toBe(API_SUPPLIER_ID);
    expect(pending?.costCents).toBe(1500);
    expect(JSON.parse(pending!.lineItemsJson)).toEqual([{ sku: 'GADGET-1', quantity: 2, title: 'Gadget' }]);
  });

  it('creates both a fulfillment shell AND a manual_tasks row for a manual-kind supplier, carrying shipTo through', async () => {
    const db = createDb(env.DB);
    const shipTo = { name: 'Jordan Buyer', address1: '742 Evergreen Terrace', city: 'Springfield', state: 'IL', zip: '62704', country: 'US' };
    const fulfillmentId = await placeSupplierOrder(db, env, ORDER_ID, MANUAL_SUPPLIER_ID, 1200, {
      shipTo,
      buyerName: 'jordan_buyer_99',
    });

    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
    expect(fulfillment?.supplierId).toBe(MANUAL_SUPPLIER_ID);

    const [task] = await db.select().from(manualTasks).where(eq(manualTasks.orderId, ORDER_ID));
    expect(task?.state).toBe('pending');
    const payload = JSON.parse(task!.payloadJson);
    expect(payload.shipTo).toEqual(shipTo);
    expect(payload.buyerName).toBe('jordan_buyer_99');
    expect(payload.lineItems).toEqual([{ sku: 'GADGET-1', quantity: 2, title: 'Gadget' }]);
  });
});

describe('approveSupplierOrder', () => {
  it('places the real order and marks the pending row approved', async () => {
    const db = createDb(env.DB);
    const fulfillmentId = await placeSupplierOrder(db, env, ORDER_ID, API_SUPPLIER_ID, 1500);
    const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.fulfillmentId, fulfillmentId));

    await approveSupplierOrder(db, env, pending!.id);

    const [updated] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, pending!.id));
    expect(updated?.status).toBe('approved');
    expect(updated?.decidedAt).toBeGreaterThan(0);
  });

  it('is idempotent against a second approval (no double-order on a duplicate click)', async () => {
    const db = createDb(env.DB);
    const fulfillmentId = await placeSupplierOrder(db, env, ORDER_ID, API_SUPPLIER_ID, 1500);
    const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.fulfillmentId, fulfillmentId));

    await approveSupplierOrder(db, env, pending!.id);
    const firstDecidedAt = (await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, pending!.id)))[0]!.decidedAt;

    await approveSupplierOrder(db, env, pending!.id); // second click — should no-op, not re-place the order

    const [final] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, pending!.id));
    expect(final?.status).toBe('approved');
    expect(final?.decidedAt).toBe(firstDecidedAt);
  });

  it('throws for an unknown pending order id', async () => {
    const db = createDb(env.DB);
    await expect(approveSupplierOrder(db, env, 'does-not-exist')).rejects.toThrow(/not found/);
  });
});

describe('rejectSupplierOrder', () => {
  it('marks the pending row rejected without calling the supplier', async () => {
    const db = createDb(env.DB);
    const fulfillmentId = await placeSupplierOrder(db, env, ORDER_ID, API_SUPPLIER_ID, 1500);
    const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.fulfillmentId, fulfillmentId));

    await rejectSupplierOrder(db, pending!.id);

    const [updated] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, pending!.id));
    expect(updated?.status).toBe('rejected');
    expect(updated?.decidedAt).toBeGreaterThan(0);
  });

  it('a rejected order cannot later be approved', async () => {
    const db = createDb(env.DB);
    const fulfillmentId = await placeSupplierOrder(db, env, ORDER_ID, API_SUPPLIER_ID, 1500);
    const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.fulfillmentId, fulfillmentId));

    await rejectSupplierOrder(db, pending!.id);
    await approveSupplierOrder(db, env, pending!.id); // should no-op — already decided

    const [final] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, pending!.id));
    expect(final?.status).toBe('rejected');
  });
});
