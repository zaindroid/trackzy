import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, fulfillments, orders, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user' };

async function seed() {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: 'usr_api', clerkUserId: 'dev-user', email: 'd@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: 'sf_api',
    userId: 'usr_api',
    platform: 'shopify',
    shopDomain: 'demo-store.myshopify.com',
    accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
    webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: 'sup_api',
    userId: 'usr_api',
    name: 'Acme Supply Co',
    apiBaseUrl: 'https://api.acmesupply.example.com',
    apiKeyRef: 'env:SUPPLIER_API_KEY',
    emailSenderPattern: '@acmesupply.example.com',
    parserId: 'acme-supply-v1',
    active: 1,
    createdAt: 0,
  });
  await db.insert(orders).values({
    id: 'ord_api',
    storefrontId: 'sf_api',
    externalOrderId: 'gid://shopify/Order/api-1',
    externalOrderNumber: '#9401',
    status: 'exception',
    currency: 'USD',
    subtotalCents: 9900,
    shippingCents: 650,
    marginCents: 3050,
    rawPayloadId: null,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(fulfillments).values({
    id: 'ff_api',
    orderId: 'ord_api',
    supplierId: 'sup_api',
    costCents: 6200,
    trackingNumber: '9200111899223197428499',
    carrierDeclared: null,
    carrierDetected: 'USPS',
    carrierFinal: null,
    trackingStatus: 'needs_review',
    pushedToStorefront: 0,
    source: 'gemini',
    createdAt: 0,
    updatedAt: 0,
  });
}

beforeEach(seed);

describe('API auth guard', () => {
  it('rejects requests with no Authorization header', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/orders');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNAUTHORIZED');
  });

  it('rejects a session with no matching user account', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/orders', {
      headers: { Authorization: 'Bearer unknown-clerk-user' },
    });
    expect(res.status).toBe(401);
  });

  it('does not require auth for the health check', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/health');
    expect(res.status).toBe(200);
  });

  it('accepts the dev-user bearer token for a seeded user', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/orders', { headers: AUTH_HEADERS });
    expect(res.status).toBe(200);
  });
});

describe('GET /api/orders', () => {
  it('returns only the authed user\'s orders', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/orders', { headers: AUTH_HEADERS });
    const body = (await res.json()) as { orders: { id: string }[] };
    expect(body.orders.map((o) => o.id)).toEqual(['ord_api']);
  });
});

describe('GET /api/settings', () => {
  it('returns sensible defaults when no settings row exists yet', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/settings', { headers: AUTH_HEADERS });
    const body = (await res.json()) as { settings: { minMarginCents: number; marginMode: string } };
    expect(body.settings.minMarginCents).toBe(200);
    expect(body.settings.marginMode).toBe('absolute');
  });

  it('persists a PATCH and reflects it on the next GET', async () => {
    const patchRes = await SELF.fetch('https://worker.example.com/api/settings', {
      method: 'PATCH',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ minMarginCents: 500 }),
    });
    expect(patchRes.status).toBe(200);

    const getRes = await SELF.fetch('https://worker.example.com/api/settings', { headers: AUTH_HEADERS });
    const body = (await getRes.json()) as { settings: { minMarginCents: number } };
    expect(body.settings.minMarginCents).toBe(500);
  });
});

describe('PATCH /api/fulfillments/:id (Needs-review resolve flow)', () => {
  it('re-validates and resolves an ambiguous-carrier fulfillment', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/fulfillments/ff_api', {
      method: 'PATCH',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ carrierFinal: 'USPS' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { carrierFinal: string };
    expect(body.carrierFinal).toBe('USPS');

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, 'ff_api'));
    expect(fulfillment?.trackingStatus).toBe('pending');
    expect(fulfillment?.source).toBe('manual');
  });

  it('rejects a PATCH whose tracking number still fails validation', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/fulfillments/ff_api', {
      method: 'PATCH',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({ trackingNumber: 'not-a-real-number' }),
    });
    expect(res.status).toBe(422);
  });
});

describe('POST /api/suppliers/:id/test-parser', () => {
  it('runs the registered parser live against pasted email text', async () => {
    const res = await SELF.fetch('https://worker.example.com/api/suppliers/sup_api/test-parser', {
      method: 'POST',
      headers: { ...AUTH_HEADERS, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        subject: 'Shipped',
        text: 'Order #AC-99999 has shipped!\nTracking Number: 1Z999AA10123456780\nCarrier: UPS',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { candidate: { trackingNumber: string } | null; confidence: number };
    expect(body.candidate?.trackingNumber).toBe('1Z999AA10123456780');
    expect(body.confidence).toBe(1);
  });
});
