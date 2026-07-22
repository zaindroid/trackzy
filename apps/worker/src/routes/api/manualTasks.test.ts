import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, manualTasks, orders, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user', 'Content-Type': 'application/json' };

async function seed() {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: 'usr_mt', clerkUserId: 'dev-user', email: 'd@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: 'sf_mt',
    userId: 'usr_mt',
    platform: 'ebay',
    shopDomain: 'mt-test-ebay-store',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: 'sup_mt',
    userId: 'usr_mt',
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
  await db.insert(orders).values({
    id: 'ord_mt',
    storefrontId: 'sf_mt',
    externalOrderId: 'ebay-mt-order-1',
    externalOrderNumber: 'mt-order-1',
    status: 'fulfilling',
    currency: 'USD',
    subtotalCents: 4250,
    shippingCents: 0,
    marginCents: 1400,
    rawPayloadId: null,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(manualTasks).values({
    id: 'mt_1',
    orderId: 'ord_mt',
    supplierId: 'sup_mt',
    state: 'pending',
    payloadJson: JSON.stringify({ sku: 'GIZMO-GREEN-S', quantity: 1 }),
    createdAt: 0,
    updatedAt: 0,
  });
}

beforeEach(seed);

describe('GET /api/manual-tasks', () => {
  it('lists manual tasks for the authed user', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/manual-tasks', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { manualTasks: { id: string }[] };
    expect(body.manualTasks.map((t) => t.id)).toEqual(['mt_1']);
  });

  it('filters by state', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/manual-tasks?state=claimed', { headers: AUTH_HEADERS });
    const body = (await res.json()) as { manualTasks: unknown[] };
    expect(body.manualTasks).toEqual([]);
  });
});

describe('POST /api/manual-tasks/:id/claim', () => {
  it('transitions pending -> claimed', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/manual-tasks/mt_1/claim', {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [task] = await db.select().from(manualTasks).where(eq(manualTasks.id, 'mt_1'));
    expect(task?.state).toBe('claimed');
  });

  it('rejects claiming a task that is not pending', async () => {
    await SELF.fetch('https://worker.example.com/api/manual-tasks/mt_1/claim', { method: 'POST', headers: AUTH_HEADERS });
    const second = await SELF.fetch('https://worker.example.com/api/manual-tasks/mt_1/claim', {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(second.status).toBe(409);
  });
});

describe('POST /api/manual-tasks/:id/mark-ordered', () => {
  it('transitions claimed -> ordered and stores the supplierOrderRef', async () => {
    await SELF.fetch('https://worker.example.com/api/manual-tasks/mt_1/claim', { method: 'POST', headers: AUTH_HEADERS });
    const res = await SELF.fetch('https://worker.example.com/api/manual-tasks/mt_1/mark-ordered', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ supplierOrderRef: '111-9999999-1111111' }),
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [task] = await db.select().from(manualTasks).where(eq(manualTasks.id, 'mt_1'));
    expect(task?.state).toBe('ordered');
    expect(JSON.parse(task?.payloadJson ?? '{}')).toMatchObject({ supplierOrderRef: '111-9999999-1111111' });
  });

  it('rejects marking a still-pending (unclaimed) task as ordered', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/manual-tasks/mt_1/mark-ordered', {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/manual-tasks/:id/abandon', () => {
  it('transitions pending -> abandoned', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/manual-tasks/mt_1/abandon', {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(res.status).toBe(200);
    const db = createDb(env.DB);
    const [task] = await db.select().from(manualTasks).where(eq(manualTasks.id, 'mt_1'));
    expect(task?.state).toBe('abandoned');
  });
});
