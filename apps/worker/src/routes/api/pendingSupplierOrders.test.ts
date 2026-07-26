import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, orderLineItems, orders, pendingSupplierOrders, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { placeSupplierOrder } from '../../lib/placeSupplierOrder.js';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user-pso-api', 'Content-Type': 'application/json' };
const OTHER_AUTH_HEADERS = { Authorization: 'Bearer dev-user-pso-other', 'Content-Type': 'application/json' };
const USER_ID = 'usr_pso_api';
const OTHER_USER_ID = 'usr_pso_api_other';
const STOREFRONT_ID = 'sf_pso_api';
const SUPPLIER_ID = 'sup_pso_api_cj';
const ORDER_ID = 'ord_pso_api';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values([
    { id: USER_ID, clerkUserId: 'dev-user-pso-api', email: 'pso-api@test.dev', createdAt: 0 },
    { id: OTHER_USER_ID, clerkUserId: 'dev-user-pso-other', email: 'pso-other@test.dev', createdAt: 0 },
  ]);
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'ebay-store-pso-api',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_CLIENT_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: SUPPLIER_ID,
    userId: USER_ID,
    name: 'CJ Dropshipping',
    apiBaseUrl: 'https://api.cjdropshipping.example.com',
    apiKeyRef: 'env:CJ_API_KEY',
    emailSenderPattern: '@cjdropshipping.example.com',
    parserId: 'generic-fallback-v1',
    kind: 'api',
    provider: 'cj',
    active: 1,
    createdAt: 0,
  });
  await db.insert(orders).values({
    id: ORDER_ID,
    storefrontId: STOREFRONT_ID,
    externalOrderId: 'ebay-order-pso-api-1',
    externalOrderNumber: '#EB-PSO-API-1',
    status: 'fulfilling',
    currency: 'USD',
    subtotalCents: 5000,
    shippingCents: 500,
    marginCents: 1500,
    rawPayloadId: null,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(orderLineItems).values({
    id: 'li_pso_api_1',
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

async function seedPendingOrder(): Promise<string> {
  const db = createDb(env.DB);
  const fulfillmentId = await placeSupplierOrder(db, env, ORDER_ID, SUPPLIER_ID, 1500);
  const [pending] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.fulfillmentId, fulfillmentId));
  return pending!.id;
}

describe('GET /api/pending-supplier-orders', () => {
  it('lists the pending order with supplier name and order number attached, scoped to the authed user', async () => {
    await seedPendingOrder();

    const res = await SELF.fetch('https://worker.example.com/api/pending-supplier-orders', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { pendingSupplierOrders: { supplierName: string; externalOrderNumber: string; status: string }[] };
    expect(body.pendingSupplierOrders).toHaveLength(1);
    expect(body.pendingSupplierOrders[0]?.supplierName).toBe('CJ Dropshipping');
    expect(body.pendingSupplierOrders[0]?.externalOrderNumber).toBe('#EB-PSO-API-1');
    expect(body.pendingSupplierOrders[0]?.status).toBe('pending');
  });

  it('never returns another user\'s pending order', async () => {
    await seedPendingOrder();
    const res = await SELF.fetch('https://worker.example.com/api/pending-supplier-orders', { headers: OTHER_AUTH_HEADERS });
    const body = (await res.json()) as { pendingSupplierOrders: unknown[] };
    expect(body.pendingSupplierOrders).toHaveLength(0);
  });
});

describe('POST /api/pending-supplier-orders/:id/approve', () => {
  it('approves and flips the status, and a second click is rejected with 409 rather than re-placing the order', async () => {
    const id = await seedPendingOrder();

    const res = await SELF.fetch(`https://worker.example.com/api/pending-supplier-orders/${id}/approve`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [row] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, id));
    expect(row?.status).toBe('approved');

    const secondRes = await SELF.fetch(`https://worker.example.com/api/pending-supplier-orders/${id}/approve`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(secondRes.status).toBe(409);
  });

  it('404s for another user\'s pending order rather than letting them approve it', async () => {
    const id = await seedPendingOrder();
    const res = await SELF.fetch(`https://worker.example.com/api/pending-supplier-orders/${id}/approve`, {
      method: 'POST',
      headers: OTHER_AUTH_HEADERS,
    });
    expect(res.status).toBe(404);

    const db = createDb(env.DB);
    const [row] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, id));
    expect(row?.status).toBe('pending'); // untouched
  });
});

describe('POST /api/pending-supplier-orders/:id/reject', () => {
  it('rejects and flips the status', async () => {
    const id = await seedPendingOrder();

    const res = await SELF.fetch(`https://worker.example.com/api/pending-supplier-orders/${id}/reject`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [row] = await db.select().from(pendingSupplierOrders).where(eq(pendingSupplierOrders.id, id));
    expect(row?.status).toBe('rejected');
  });
});
