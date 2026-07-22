import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import {
  createDb,
  fulfillments,
  messageTemplates,
  messages,
  orderLineItems,
  orders,
  storefronts,
  suppliers,
  users,
} from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { sendBuyerMessage, scheduleFeedbackReminder, processPendingFeedbackReminders } from './messaging.js';

const USER_ID = 'usr_msg';
const EBAY_STOREFRONT_ID = 'sf_msg_ebay';
const SHOPIFY_STOREFRONT_ID = 'sf_msg_shopify';
const ORDER_EBAY_ID = 'ord_msg_ebay';
const ORDER_SHOPIFY_ID = 'ord_msg_shopify';

beforeEach(async () => {
  const db = createDb(env.DB);
  await db.insert(users).values({ id: USER_ID, clerkUserId: 'dev-user-msg', email: 'msg@test.dev', createdAt: 0 });
  await db.insert(storefronts).values([
    {
      id: EBAY_STOREFRONT_ID,
      userId: USER_ID,
      platform: 'ebay',
      shopDomain: 'msg-test-ebay-store',
      accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
      webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
      createdAt: 0,
      oauthAccessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
      oauthRefreshTokenRef: 'env:EBAY_OAUTH_REFRESH_TOKEN',
      oauthExpiresAt: Date.now() + 3600_000,
    },
    {
      id: SHOPIFY_STOREFRONT_ID,
      userId: USER_ID,
      platform: 'shopify',
      shopDomain: 'msg-test-shopify-store.myshopify.com',
      accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
      webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
      createdAt: 0,
    },
  ]);
  await db.insert(orders).values([
    {
      id: ORDER_EBAY_ID,
      storefrontId: EBAY_STOREFRONT_ID,
      externalOrderId: 'ebay-msg-order-1',
      externalOrderNumber: 'msg-order-1',
      status: 'shipped',
      currency: 'USD',
      subtotalCents: 4999,
      shippingCents: 0,
      marginCents: 1500,
      rawPayloadId: null,
      createdAt: 0,
      updatedAt: 0,
    },
    {
      id: ORDER_SHOPIFY_ID,
      storefrontId: SHOPIFY_STOREFRONT_ID,
      externalOrderId: 'gid://shopify/Order/msg-1',
      externalOrderNumber: '#msg-1',
      status: 'shipped',
      currency: 'USD',
      subtotalCents: 3499,
      shippingCents: 0,
      marginCents: 1000,
      rawPayloadId: null,
      createdAt: 0,
      updatedAt: 0,
    },
  ]);
  await db.insert(suppliers).values({
    id: 'sup_msg_placeholder',
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
  await db.insert(orderLineItems).values({
    id: 'li_msg_1',
    orderId: ORDER_EBAY_ID,
    externalLineItemId: 'ebay-li-msg-1',
    fulfillmentOrderLineItemId: null,
    sku: 'WIDGET-RED-L',
    title: 'Widget - Red / Large',
    quantity: 1,
    quantityFulfilled: 1,
    unitPriceCents: 4999,
  });
  await db.insert(fulfillments).values({
    id: 'ff_msg_1',
    orderId: ORDER_EBAY_ID,
    supplierId: 'sup_msg_placeholder',
    costCents: 3000,
    trackingNumber: '1Z999AA10123456780',
    carrierDeclared: 'UPS',
    carrierDetected: 'UPS',
    carrierFinal: 'UPS',
    trackingStatus: 'in_transit',
    pushedToStorefront: 1,
    source: 'supplier_api',
    createdAt: 0,
    updatedAt: 0,
  });
});

describe('sendBuyerMessage', () => {
  it('renders the default template and sends via the storefront OrderSource, recording a sent message', async () => {
    await sendBuyerMessage(env, ORDER_EBAY_ID, 'shipped');

    const db = createDb(env.DB);
    const [message] = await db.select().from(messages).where(eq(messages.orderId, ORDER_EBAY_ID));
    expect(message?.status).toBe('sent');
    expect(message?.trigger).toBe('shipped');
    expect(message?.body).toContain('1Z999AA10123456780'); // {{trackingNumber}} rendered
    expect(message?.body).toContain('UPS'); // {{carrier}} rendered
    expect(message?.sentAt).not.toBeNull();
  });

  it('renders a user-configured active template over the default when one exists', async () => {
    const db = createDb(env.DB);
    await db.insert(messageTemplates).values({
      id: 'tpl_msg_1',
      userId: USER_ID,
      trigger: 'shipped',
      bodyTemplate: 'Custom shipped message for SKU {{sku}}!',
      active: 1,
      createdAt: 0,
    });

    await sendBuyerMessage(env, ORDER_EBAY_ID, 'shipped');

    const [message] = await db.select().from(messages).where(eq(messages.orderId, ORDER_EBAY_ID));
    expect(message?.body).toBe('Custom shipped message for SKU WIDGET-RED-L!');
    expect(message?.templateId).toBe('tpl_msg_1');
  });

  it('records status=skipped for a storefront platform with no OrderSource implementation (Shopify)', async () => {
    await sendBuyerMessage(env, ORDER_SHOPIFY_ID, 'delivered');

    const db = createDb(env.DB);
    const [message] = await db.select().from(messages).where(eq(messages.orderId, ORDER_SHOPIFY_ID));
    expect(message?.status).toBe('skipped');
  });

  it('throws for an unknown order id', async () => {
    await expect(sendBuyerMessage(env, 'does-not-exist', 'sold')).rejects.toThrow();
  });
});

describe('scheduleFeedbackReminder + processPendingFeedbackReminders', () => {
  it('schedules a pending reminder that is not sent until it clears the minimum age', async () => {
    await scheduleFeedbackReminder(env, ORDER_EBAY_ID);

    const db = createDb(env.DB);
    const [pending] = await db.select().from(messages).where(eq(messages.orderId, ORDER_EBAY_ID));
    expect(pending?.status).toBe('pending');
    expect(pending?.trigger).toBe('feedback_reminder');

    await processPendingFeedbackReminders(env, 3 * 24 * 60 * 60 * 1000); // still too young to send
    const [stillPending] = await db.select().from(messages).where(eq(messages.orderId, ORDER_EBAY_ID));
    expect(stillPending?.status).toBe('pending');
  });

  it('sends a pending reminder once it clears the minimum age', async () => {
    await scheduleFeedbackReminder(env, ORDER_EBAY_ID);

    const db = createDb(env.DB);
    await processPendingFeedbackReminders(env, 0); // treat every pending reminder as old enough

    const [message] = await db.select().from(messages).where(eq(messages.orderId, ORDER_EBAY_ID));
    expect(message?.status).toBe('sent');
    expect(message?.sentAt).not.toBeNull();
  });
});
