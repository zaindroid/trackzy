import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { computeHmacSha256Base64 } from '@fulfillment-tracker/adapters/hmac';
import { createDb, fulfillments, orders, storefronts, suppliers, users, webhookEvents } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';

// Must match the SEVENTEENTRACK_API_KEY binding configured in vitest.config.ts.
const SHARED_SECRET = 'test-17track-shared-secret';

function payload(trackingNumber: string, status: string) {
  return JSON.stringify({ event: 'TRACKING_UPDATED', data: { number: trackingNumber, track_info: { latest_status: { status } } } });
}

async function post(body: string, opts: { badSignature?: boolean } = {}) {
  const signature = opts.badSignature ? 'bad-signature' : await computeHmacSha256Base64(SHARED_SECRET, body);
  return SELF.fetch('https://worker.example.com/webhooks/17track', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-17Track-Sign': signature },
    body,
  });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: 'usr_t', clerkUserId: 'dev-user', email: 'd@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: 'sf_t',
    userId: 'usr_t',
    platform: 'shopify',
    shopDomain: 'demo-store.myshopify.com',
    accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
    webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: 'sup_t',
    userId: 'usr_t',
    name: 'Acme Supply Co',
    apiBaseUrl: 'https://api.acmesupply.example.com',
    apiKeyRef: 'env:SUPPLIER_API_KEY',
    emailSenderPattern: '@acmesupply.example.com',
    parserId: 'acme-supply-v1',
    active: 1,
    createdAt: 0,
  });
  await db.insert(orders).values({
    id: 'ord_t',
    storefrontId: 'sf_t',
    externalOrderId: 'gid://shopify/Order/ord_t',
    externalOrderNumber: '#9101',
    status: 'partially_shipped',
    currency: 'USD',
    subtotalCents: 4450,
    shippingCents: 500,
    marginCents: 1000,
    rawPayloadId: null,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(fulfillments).values({
    id: 'ff_t',
    orderId: 'ord_t',
    supplierId: 'sup_t',
    costCents: 3000,
    trackingNumber: '1Z999AA10123456780',
    carrierDeclared: 'UPS',
    carrierDetected: 'UPS',
    carrierFinal: 'UPS',
    trackingStatus: 'in_transit',
    pushedToStorefront: 1,
    source: 'regex',
    createdAt: 0,
    updatedAt: 0,
  });
});

describe('POST /webhooks/17track', () => {
  it('rejects an invalid signature', async () => {
    const res = await post(payload('1Z999AA10123456780', 'Delivered'), { badSignature: true });
    expect(res.status).toBe(401);
  });

  it('accepts a validly-signed event and updates the matching fulfillment status', async () => {
    const res = await post(payload('1Z999AA10123456780', 'Delivered'));
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [event] = await db.select().from(webhookEvents).where(eq(webhookEvents.source, '17track'));
    expect(event).toBeDefined();
    expect(event?.error).toBeNull();
  });

  it('deduplicates identical event bodies', async () => {
    const body = payload('1Z999AA10123456780', 'InTransit');
    const first = await post(body);
    const second = await post(body);
    expect(first.status).toBe(200);
    expect((await second.json())).toEqual({ ok: true, deduped: true });

    const db = createDb(env.DB);
    const events = await db.select().from(webhookEvents).where(eq(webhookEvents.source, '17track'));
    expect(events).toHaveLength(1);
  });
});
