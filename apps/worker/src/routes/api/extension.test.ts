import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, fulfillments, manualTasks, orders, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user', 'Content-Type': 'application/json' };

async function seed() {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: 'usr_ext', clerkUserId: 'dev-user', email: 'd@test.dev', createdAt: 0 });
  await db.insert(storefronts).values([
    {
      id: 'sf_ext_nonapi',
      userId: 'usr_ext',
      platform: 'ebay',
      shopDomain: 'ext-test-ebay-store',
      accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
      webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
      createdAt: 0,
      nonApiMode: 1,
    },
    {
      id: 'sf_ext_api',
      userId: 'usr_ext',
      platform: 'shopify',
      shopDomain: 'ext-test-shopify-store.myshopify.com',
      accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
      webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
      createdAt: 0,
      nonApiMode: 0,
    },
  ]);
  await db.insert(suppliers).values({
    id: 'sup_ext',
    userId: 'usr_ext',
    name: 'Amazon Retail (Manual)',
    apiBaseUrl: 'https://www.amazon.com',
    apiKeyRef: 'PLACEHOLDER__NO_API_KEY_MANUAL_SUPPLIER',
    emailSenderPattern: '@amazon.com',
    parserId: 'amazon-retail-manual-v1',
    active: 1,
    createdAt: 0,
    kind: 'manual',
    provider: 'amazon_retail',
  });
  await db.insert(orders).values([
    {
      id: 'ord_ext_nonapi',
      storefrontId: 'sf_ext_nonapi',
      externalOrderId: 'ebay-ext-order-1',
      externalOrderNumber: 'ext-order-1',
      status: 'shipped',
      currency: 'USD',
      subtotalCents: 5999,
      shippingCents: 0,
      marginCents: 2000,
      rawPayloadId: null,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'ord_ext_api',
      storefrontId: 'sf_ext_api',
      externalOrderId: 'gid://shopify/Order/ext-1',
      externalOrderNumber: '#ext-1',
      status: 'shipped',
      currency: 'USD',
      subtotalCents: 3499,
      shippingCents: 0,
      marginCents: 1000,
      rawPayloadId: null,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: 'ord_ext_manual',
      storefrontId: 'sf_ext_nonapi',
      externalOrderId: 'ebay-ext-order-2',
      externalOrderNumber: 'ext-order-2',
      status: 'fulfilling',
      currency: 'USD',
      subtotalCents: 4250,
      shippingCents: 0,
      marginCents: 1400,
      rawPayloadId: null,
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
  // Fulfillment 1: non-API-mode storefront, has tracking, not yet pushed -> SHOULD appear in the upload queue.
  await db.insert(fulfillments).values({
    id: 'ff_ext_pending_upload',
    orderId: 'ord_ext_nonapi',
    supplierId: 'sup_ext',
    costCents: 3200,
    trackingNumber: 'BCE7F3A9D2E1',
    carrierDeclared: null,
    carrierDetected: null,
    carrierFinal: null,
    trackingStatus: 'in_transit',
    pushedToStorefront: 0,
    source: 'supplier_api',
    createdAt: 0,
    updatedAt: 0,
  });
  // Fulfillment 2: API-mode storefront, has tracking, not pushed -> should NOT appear (not non_api_mode).
  await db.insert(fulfillments).values({
    id: 'ff_ext_api_mode',
    orderId: 'ord_ext_api',
    supplierId: 'sup_ext',
    costCents: 2000,
    trackingNumber: '1Z999AA10123456780',
    carrierDeclared: 'UPS',
    carrierDetected: 'UPS',
    carrierFinal: 'UPS',
    trackingStatus: 'in_transit',
    pushedToStorefront: 0,
    source: 'supplier_api',
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(manualTasks).values({
    id: 'mt_ext_claimed',
    orderId: 'ord_ext_manual',
    supplierId: 'sup_ext',
    state: 'claimed',
    payloadJson: JSON.stringify({ sku: 'GIZMO-GREEN-S', quantity: 1, shipTo: { name: 'Jordan Buyer' } }),
    createdAt: 0,
    updatedAt: 0,
  });
}

beforeEach(seed);

describe('GET /api/extension/active-manual-task', () => {
  it('returns the claimed task with its payload parsed', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/extension/active-manual-task', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { task: { id: string; payload: { sku: string } } | null };
    expect(body.task?.id).toBe('mt_ext_claimed');
    expect(body.task?.payload.sku).toBe('GIZMO-GREEN-S');
  });

  it('returns null when there is no claimed task', async () => {
    const db = createDb(env.DB);
    await db.update(manualTasks).set({ state: 'ordered' }).where(eq(manualTasks.id, 'mt_ext_claimed'));

    const res = await SELF.fetch('https://worker.example.com/api/extension/active-manual-task', { headers: AUTH_HEADERS });
    const body = (await res.json()) as { task: null };
    expect(body.task).toBeNull();
  });
});

describe('GET /api/extension/pending-tracking-uploads', () => {
  it('includes only fulfillments on non_api_mode storefronts awaiting upload', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/extension/pending-tracking-uploads', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { uploads: { fulfillmentId: string; trackingNumber: string }[] };
    expect(body.uploads).toHaveLength(1);
    expect(body.uploads[0]?.fulfillmentId).toBe('ff_ext_pending_upload');
    expect(body.uploads[0]?.trackingNumber).toBe('BCE7F3A9D2E1');
  });
});

describe('POST /api/extension/pending-tracking-uploads/:id/complete', () => {
  it('marks the fulfillment as pushed and removes it from the queue', async () => {
    const completeRes = await SELF.fetch(
      'https://worker.example.com/api/extension/pending-tracking-uploads/ff_ext_pending_upload/complete',
      { method: 'POST', headers: AUTH_HEADERS },
    );
    expect(completeRes.status).toBe(200);

    const listRes = await SELF.fetch('https://worker.example.com/api/extension/pending-tracking-uploads', { headers: AUTH_HEADERS });
    const body = (await listRes.json()) as { uploads: unknown[] };
    expect(body.uploads).toEqual([]);
  });
});
