import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, fulfillments, orders, storefronts, suppliers, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { notifyTrackingReceived } from './notifyTrackingReceived.js';
import type { TrackingReceivedEvent } from '../workflows/types.js';

const USER_ID = 'usr_ntr';
const SUPPLIER_ID = 'sup_ntr';

async function seed(platform: 'ebay' | 'shopify', storefrontId: string, orderId: string, fulfillmentId: string) {
  const db = createDb(env.DB);
  await db.insert(storefronts).values({
    id: storefrontId,
    userId: USER_ID,
    platform,
    shopDomain: `${storefrontId}.example`,
    accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
    webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
    oauthAccessTokenRef: platform === 'ebay' ? 'env:EBAY_OAUTH_ACCESS_TOKEN' : null,
    oauthRefreshTokenRef: platform === 'ebay' ? 'env:EBAY_OAUTH_REFRESH_TOKEN' : null,
    oauthExpiresAt: platform === 'ebay' ? Date.now() + 3600_000 : null,
    createdAt: 0,
  });
  await db.insert(orders).values({
    id: orderId,
    storefrontId,
    externalOrderId: `ext-${orderId}`,
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
    supplierId: SUPPLIER_ID,
    costCents: 3000,
    trackingNumber: '1Z999AA10123456780',
    carrierDeclared: 'UPS',
    carrierDetected: 'UPS',
    carrierFinal: 'UPS',
    trackingStatus: 'pending',
    pushedToStorefront: 0,
    source: 'supplier_api',
    createdAt: 0,
    updatedAt: 0,
  });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-ntr', email: 'ntr@test.dev', createdAt: 0 });
  await db.insert(suppliers).values({
    id: SUPPLIER_ID,
    userId: USER_ID,
    name: 'Acme',
    apiBaseUrl: 'https://api.example.com',
    apiKeyRef: 'env:SUPPLIER_API_KEY',
    emailSenderPattern: '@acme.example.com',
    parserId: 'acme-v1',
    active: 1,
    createdAt: 0,
  });
});

const EVENT: TrackingReceivedEvent = {
  fulfillmentId: 'unused',
  trackingNumber: '1Z999AA10123456780',
  carrierDeclared: 'UPS',
  source: 'regex',
};

describe('notifyTrackingReceived', () => {
  it('pushes directly via OrderSource (not a workflow event) for an eBay storefront', async () => {
    const storefrontId = 'sf_ntr_ebay';
    const orderId = 'ord_ntr_ebay';
    const fulfillmentId = 'ful_ntr_ebay';
    await seed('ebay', storefrontId, orderId, fulfillmentId);
    const db = createDb(env.DB);

    await notifyTrackingReceived(env, db, fulfillmentId, orderId, EVENT);

    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
    expect(fulfillment?.pushedToStorefront).toBe(1);
  });

  it('does not throw for a shopify storefront (delegates to the workflow event path, which no-ops safely with no running instance in tests)', async () => {
    const storefrontId = 'sf_ntr_shopify';
    const orderId = 'ord_ntr_shopify';
    const fulfillmentId = 'ful_ntr_shopify';
    await seed('shopify', storefrontId, orderId, fulfillmentId);
    const db = createDb(env.DB);

    await expect(notifyTrackingReceived(env, db, fulfillmentId, orderId, EVENT)).resolves.not.toThrow();

    // Shopify's push happens inside OrderWorkflow's own step, not here — this
    // helper only dispatches the event, so pushedToStorefront stays 0.
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
    expect(fulfillment?.pushedToStorefront).toBe(0);
  });
});
