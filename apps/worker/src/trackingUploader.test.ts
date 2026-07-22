import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, fulfillments, orders, storefronts, suppliers, trackingEvents, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { MockEbayOrderSource } from '@fulfillment-tracker/adapters/ebay';
import { pushTrackingWithProxy } from './trackingUploader.js';

const USER_ID = 'usr_tu';
const SUPPLIER_ID = 'sup_tu';

async function seedOrderAndFulfillment(opts: {
  orderId: string;
  fulfillmentId: string;
  storefrontId: string;
  platform: 'ebay' | 'shopify';
  nonApiMode?: boolean;
  trackingNumber: string;
  carrierFinal: string | null;
}) {
  const db = createDb(env.DB);
  await db.insert(storefronts).values({
    id: opts.storefrontId,
    userId: USER_ID,
    platform: opts.platform,
    shopDomain: `${opts.storefrontId}.example`,
    accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
    createdAt: 0,
    nonApiMode: opts.nonApiMode ? 1 : 0,
  });
  await db.insert(orders).values({
    id: opts.orderId,
    storefrontId: opts.storefrontId,
    externalOrderId: `ext-${opts.orderId}`,
    externalOrderNumber: opts.orderId,
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
    id: opts.fulfillmentId,
    orderId: opts.orderId,
    supplierId: SUPPLIER_ID,
    costCents: 3000,
    trackingNumber: opts.trackingNumber,
    carrierDeclared: opts.carrierFinal,
    carrierDetected: opts.carrierFinal,
    carrierFinal: opts.carrierFinal,
    trackingStatus: 'pending',
    pushedToStorefront: 0,
    source: 'supplier_api',
    createdAt: 0,
    updatedAt: 0,
  });
}

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-tu', email: 'tu@test.dev', createdAt: 0 });
  await db.insert(suppliers).values({
    id: SUPPLIER_ID,
    userId: USER_ID,
    name: 'Amazon Business',
    apiBaseUrl: 'https://sellingpartnerapi-na.amazon.com',
    apiKeyRef: 'env:AMAZON_BUSINESS_API_KEY',
    emailSenderPattern: '@amazon.com',
    parserId: 'amazon-business-v1',
    active: 1,
    createdAt: 0,
    kind: 'api',
    provider: 'amazon_business',
  });
});

describe('pushTrackingWithProxy', () => {
  it('proxies an AMZL (TBA) tracking number before pushing to an API-mode eBay storefront', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_proxy',
      fulfillmentId: 'ff_proxy',
      storefrontId: 'sf_proxy',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA123456789012',
      carrierFinal: 'AMZL',
    });
    const ebay = new MockEbayOrderSource(false);

    const result = await pushTrackingWithProxy(env, ebay, 'ff_proxy');

    expect(result).toEqual({ pushed: true, proxied: true });
    expect(ebay.calls).toHaveLength(1);
    const [call] = ebay.calls;
    const [, pushedInput] = call!.args as [string, { trackingNumber: string; carrier: string }];
    expect(pushedInput.trackingNumber).toMatch(/^BCE[0-9A-F]{10}$/); // proxied, not the raw TBA number
    expect(pushedInput.trackingNumber).not.toBe('TBA123456789012');

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, 'ff_proxy'));
    expect(fulfillment?.pushedToStorefront).toBe(1);

    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_proxy'));
    expect(event?.originalTracking).toBe('TBA123456789012');
    expect(event?.proxyTracking).toMatch(/^BCE[0-9A-F]{10}$/);
  });

  it('pushes a USPS tracking number straight through, unproxied', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_passthrough',
      fulfillmentId: 'ff_passthrough',
      storefrontId: 'sf_passthrough',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: '70123456789012345674',
      carrierFinal: 'USPS',
    });
    const ebay = new MockEbayOrderSource(false);

    const result = await pushTrackingWithProxy(env, ebay, 'ff_passthrough');

    expect(result).toEqual({ pushed: true, proxied: false });
    const [call] = ebay.calls;
    const [, pushedInput] = call!.args as [string, { trackingNumber: string; carrier: string }];
    expect(pushedInput.trackingNumber).toBe('70123456789012345674'); // unchanged

    const db = createDb(env.DB);
    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_passthrough'));
    expect(event?.proxyTracking).toBeNull();
    expect(event?.proxyCarrier).toBeNull();
  });

  it('does not proxy AMZL tracking destined for a non-eBay (Shopify) storefront', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_amzl_shopify',
      fulfillmentId: 'ff_amzl_shopify',
      storefrontId: 'sf_amzl_shopify',
      platform: 'shopify',
      trackingNumber: 'TBA123456789012',
      carrierFinal: 'AMZL',
    });
    const shopifySource = new MockEbayOrderSource(false); // stand-in OrderSource; platform gate is what's under test

    const result = await pushTrackingWithProxy(env, shopifySource, 'ff_amzl_shopify');

    expect(result.proxied).toBe(false);
    const [call] = shopifySource.calls;
    const [, pushedInput] = call!.args as [string, { trackingNumber: string }];
    expect(pushedInput.trackingNumber).toBe('TBA123456789012');
  });

  it('records the proxy tracking_events row but leaves pushedToStorefront=0 for a non-API-mode eBay storefront', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_nonapi',
      fulfillmentId: 'ff_nonapi',
      storefrontId: 'sf_nonapi',
      platform: 'ebay',
      nonApiMode: true,
      trackingNumber: 'TBA999999999999',
      carrierFinal: 'AMZL',
    });
    const ebay = new MockEbayOrderSource(true); // non_api_mode -> pushTracking throws NonApiModeError

    const result = await pushTrackingWithProxy(env, ebay, 'ff_nonapi');

    expect(result).toEqual({ pushed: false, proxied: true });

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, 'ff_nonapi'));
    expect(fulfillment?.pushedToStorefront).toBe(0); // still pending — the extension will complete it

    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_nonapi'));
    expect(event?.proxyTracking).toMatch(/^BCE[0-9A-F]{10}$/); // proxy conversion still happened before the push attempt
  });
});
