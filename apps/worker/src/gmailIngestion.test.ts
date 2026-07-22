import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  fulfillments,
  orders,
  storefronts,
  suppliers,
  users,
  webhookEvents,
} from '@fulfillment-tracker/db';
import { and, eq } from 'drizzle-orm';
import { pollGmailForUser } from './gmailIngestion.js';

const USER_ID = 'usr_gmail_test';
const STOREFRONT_ID = 'sf_gmail_test';
const AMAZON_RETAIL_SUPPLIER_ID = 'sup_amazon_retail_test';
const ALIEXPRESS_SUPPLIER_ID = 'sup_aliexpress_test';
const ORDER_A_ID = 'ord_gmail_a';
const ORDER_B_ID = 'ord_gmail_b';
const FULFILLMENT_A_ID = 'ff_gmail_a';
const FULFILLMENT_B_ID = 'ff_gmail_b';

async function seedOrderAwaitingTracking(db: ReturnType<typeof createDb>, orderId: string, fulfillmentId: string, supplierId: string) {
  await db.insert(orders).values({
    id: orderId,
    storefrontId: STOREFRONT_ID,
    externalOrderId: `gid://ebay/Order/${orderId}`,
    externalOrderNumber: orderId,
    status: 'fulfilling',
    currency: 'USD',
    subtotalCents: 4999,
    shippingCents: 0,
    marginCents: 1500,
    rawPayloadId: null,
    createdAt: 0,
    updatedAt: 0,
  });
  await db.insert(fulfillments).values({
    id: fulfillmentId,
    orderId,
    supplierId,
    costCents: 3000,
    trackingNumber: null,
    carrierDeclared: null,
    carrierDetected: null,
    carrierFinal: null,
    trackingStatus: 'pending',
    pushedToStorefront: 0,
    source: 'manual',
    createdAt: 0,
    updatedAt: 0,
  });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({
    id: USER_ID,
    clerkUserId: 'dev-user-gmail-test',
    email: 'gmail-test@test.dev',
    createdAt: 0,
    gmailRefreshTokenRef: 'env:GMAIL_OAUTH_REFRESH_TOKEN',
    gmailAccessTokenRef: 'env:GMAIL_OAUTH_ACCESS_TOKEN',
    gmailTokenExpiresAt: Date.now() + 3600_000,
    gmailLastPolledAt: 0,
  });
  await db.insert(storefronts).values({
    id: STOREFRONT_ID,
    userId: USER_ID,
    platform: 'ebay',
    shopDomain: 'gmail-test-ebay-store',
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values([
    {
      id: AMAZON_RETAIL_SUPPLIER_ID,
      userId: USER_ID,
      name: 'Amazon Retail (Manual)',
      apiBaseUrl: 'https://www.amazon.com',
      apiKeyRef: 'PLACEHOLDER__NO_API_KEY_MANUAL_SUPPLIER',
      emailSenderPattern: '@amazon.com',
      parserId: 'amazon-retail-manual-v1',
      active: 1,
      createdAt: 0,
      kind: 'manual',
      provider: 'amazon_retail',
    },
    {
      id: ALIEXPRESS_SUPPLIER_ID,
      userId: USER_ID,
      name: 'AliExpress Open Platform',
      apiBaseUrl: 'https://api.aliexpress.com',
      apiKeyRef: 'env:ALIEXPRESS_APP_KEY',
      emailSenderPattern: '@aliexpress.com',
      parserId: 'aliexpress-v1',
      active: 1,
      createdAt: 0,
      kind: 'api',
      provider: 'aliexpress',
    },
  ]);
  await seedOrderAwaitingTracking(db, ORDER_A_ID, FULFILLMENT_A_ID, AMAZON_RETAIL_SUPPLIER_ID);
  await seedOrderAwaitingTracking(db, ORDER_B_ID, FULFILLMENT_B_ID, ALIEXPRESS_SUPPLIER_ID);
});

describe('pollGmailForUser', () => {
  it('resolves the Amazon Retail fixture email onto its pending fulfillment with AMZL detected', async () => {
    await pollGmailForUser(env, USER_ID);

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, FULFILLMENT_A_ID));
    expect(fulfillment?.trackingNumber).toBe('TBA123456789012');
    expect(fulfillment?.carrierFinal).toBe('AMZL');
    expect(fulfillment?.trackingStatus).toBe('pending');
    expect(fulfillment?.source).toBe('regex');
  });

  it('resolves the AliExpress fixture email but flags needs_review for its unrecognized carrier format', async () => {
    await pollGmailForUser(env, USER_ID);

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, FULFILLMENT_B_ID));
    expect(fulfillment?.trackingNumber).toBe('LP00123456789CN');
    expect(fulfillment?.carrierFinal).toBeNull();
    expect(fulfillment?.trackingStatus).toBe('needs_review');
  });

  it('records a webhook_events row per processed Gmail message, dedup-keyed by gmail:<messageId>', async () => {
    await pollGmailForUser(env, USER_ID);

    const db = createDb(env.DB);
    const [event] = await db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.source, 'email'), eq(webhookEvents.dedupKey, 'gmail:gmail-mock-amazon-1')));
    expect(event).toBeDefined();
    expect(event?.error).toBeNull();
  });

  it('advances gmailLastPolledAt after a poll', async () => {
    const before = Date.now();
    await pollGmailForUser(env, USER_ID);

    const db = createDb(env.DB);
    const [user] = await db.select().from(users).where(eq(users.id, USER_ID));
    expect(user?.gmailLastPolledAt).toBeGreaterThanOrEqual(before);
  });

  it('does not reprocess an already-seen Gmail message (dedup by webhook_events)', async () => {
    await pollGmailForUser(env, USER_ID);

    // Simulate a re-delivery / re-poll that would otherwise see the same
    // fixture messages again by resetting the cursor back to 0.
    const db = createDb(env.DB);
    await db.update(users).set({ gmailLastPolledAt: 0 }).where(eq(users.id, USER_ID));
    await pollGmailForUser(env, USER_ID);

    const events = await db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.source, 'email'), eq(webhookEvents.dedupKey, 'gmail:gmail-mock-amazon-1')));
    expect(events).toHaveLength(1);
  });

  it('is a no-op for a user with no connected Gmail inbox', async () => {
    const db = createDb(env.DB);
    await db.update(users).set({ gmailRefreshTokenRef: null, gmailAccessTokenRef: null }).where(eq(users.id, USER_ID));

    await pollGmailForUser(env, USER_ID);

    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, FULFILLMENT_A_ID));
    expect(fulfillment?.trackingNumber).toBeNull();
  });
});
