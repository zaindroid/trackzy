import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createDb, manualTasks, orders, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';

// Must match the EBAY_DELETION_VERIFICATION_TOKEN binding in vitest.config.ts.
const VERIFICATION_TOKEN = 'test-ebay-deletion-verification-token';
const ENDPOINT_URL = 'https://worker.example.com/webhooks/ebay-account-deletion';

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: 'usr_ed', clerkUserId: 'dev-user-ed', email: 'ed@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: 'sf_ed',
    userId: 'usr_ed',
    platform: 'ebay',
    shopDomain: 'ebay-store-ed',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_CLIENT_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: 'sup_ed',
    userId: 'usr_ed',
    name: 'Manual Supplier',
    apiBaseUrl: '',
    apiKeyRef: 'env:SUPPLIER_API_KEY',
    emailSenderPattern: '@manual.example.com',
    parserId: 'manual-v1',
    kind: 'manual',
    provider: 'manual',
    active: 1,
    createdAt: 0,
  });
  await db.insert(orders).values({
    id: 'ord_ed',
    storefrontId: 'sf_ed',
    externalOrderId: 'ebay-order-1',
    externalOrderNumber: '#EB1',
    currency: 'USD',
    subtotalCents: 1000,
    shippingCents: 500,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(manualTasks).values({
    id: 'mt_ed',
    orderId: 'ord_ed',
    supplierId: 'sup_ed',
    state: 'pending',
    payloadJson: JSON.stringify({
      buyerName: 'deleteme_buyer',
      shipTo: { name: 'Jane Doe', address1: '123 Elm St', city: 'Springfield', state: 'IL', zip: '62701', country: 'US' },
    }),
    createdAt: 0,
    updatedAt: 0,
  });
});

describe('GET /webhooks/ebay-account-deletion (endpoint verification)', () => {
  it('returns the sha256(challengeCode + verificationToken + endpoint) hex hash eBay expects', async () => {
    const challengeCode = 'abc123';
    const res = await SELF.fetch(`${ENDPOINT_URL}?challenge_code=${challengeCode}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { challengeResponse: string };
    const expected = await sha256Hex(challengeCode + VERIFICATION_TOKEN + ENDPOINT_URL);
    expect(body.challengeResponse).toBe(expected);
  });

  it('400s when challenge_code is missing', async () => {
    const res = await SELF.fetch(ENDPOINT_URL);
    expect(res.status).toBe(400);
  });
});

describe('POST /webhooks/ebay-account-deletion (deletion notification)', () => {
  it('redacts buyerName/shipTo from every manual_tasks row matching the deleted username', async () => {
    const res = await SELF.fetch(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification: { notificationId: 'n1', data: { username: 'deleteme_buyer', userId: '123' } },
      }),
    });
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const [row] = await db.select({ payloadJson: manualTasks.payloadJson }).from(manualTasks).where(eq(manualTasks.id, 'mt_ed'));
    const parsed = JSON.parse(row!.payloadJson);
    expect(parsed.buyerName).toBe('[deleted]');
    expect(parsed.shipTo).toBeUndefined();
  });

  it('leaves unrelated manual_tasks rows untouched', async () => {
    await SELF.fetch(ENDPOINT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notification: { notificationId: 'n2', data: { username: 'someone_else', userId: '999' } },
      }),
    });

    const db = createDb(env.DB);
    const [row] = await db.select({ payloadJson: manualTasks.payloadJson }).from(manualTasks).where(eq(manualTasks.id, 'mt_ed'));
    const parsed = JSON.parse(row!.payloadJson);
    expect(parsed.buyerName).toBe('deleteme_buyer');
    expect(parsed.shipTo).toBeDefined();
  });

  it('acks 200 even with a malformed body, since eBay retries on non-200', async () => {
    const res = await SELF.fetch(ENDPOINT_URL, { method: 'POST', body: 'not json' });
    expect(res.status).toBe(200);
  });
});
