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
import { handleEmail } from './email.js';

const ACME_TRACKING_EMAIL = [
  'From: Acme Supply Co <shipping@acmesupply.example.com>',
  'To: orders@demo-store.myshopify.com',
  'Subject: Your order has shipped!',
  'Message-ID: <acme-1001-ship-001@acmesupply.example.com>',
  'Date: Wed, 16 Jul 2026 10:15:00 +0000',
  'Content-Type: text/plain; charset="UTF-8"',
  'MIME-Version: 1.0',
  '',
  'Order #AC-10293 has shipped!',
  '',
  'Tracking Number: 1Z999AA10123456780',
  'Carrier: UPS',
  'SKU: WIDGET-RED-L',
  '',
  'Thank you for your business.',
].join('\r\n');

// Same body shape but WITHOUT the "Tracking Number:" label the acme regex
// parser requires, so the regex parser must fail and fall through to Gemini,
// which finds the token via its broad format scan.
const ACME_UNSTRUCTURED_EMAIL = [
  'From: Acme Supply Co <shipping@acmesupply.example.com>',
  'To: orders@demo-store.myshopify.com',
  'Subject: Re: your package',
  'Message-ID: <acme-1001-ship-unstructured@acmesupply.example.com>',
  'Date: Wed, 16 Jul 2026 10:20:00 +0000',
  'Content-Type: text/plain; charset="UTF-8"',
  'MIME-Version: 1.0',
  '',
  "Hey, just a heads up your package 1Z999AA10123456780 is on the way!",
].join('\r\n');

const MALFORMED_UNMATCHED_EMAIL = [
  'From: no-reply@random-marketing.example.com',
  'To: orders@demo-store.myshopify.com',
  'Subject: Re: your recent purchase',
  'Message-ID: <marketing-blast-001@random-marketing.example.com>',
  'Date: Fri, 18 Jul 2026 08:00:00 +0000',
  'Content-Type: text/plain; charset="UTF-8"',
  'MIME-Version: 1.0',
  '',
  'Thanks so much for your order! Check out our other products - use code',
  'SAVE10 for 10% off your next purchase.',
].join('\r\n');

function createForwardableMessage(raw: string, from: string): ForwardableEmailMessage {
  const bytes = new TextEncoder().encode(raw);
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
  return {
    from,
    to: 'orders@demo-store.myshopify.com',
    raw: stream,
    rawSize: bytes.length,
    headers: new Headers(),
    setReject: () => {},
    forward: async () => {},
    reply: async () => {},
  } as unknown as ForwardableEmailMessage;
}

let acmeSupplierId: string;

beforeEach(async () => {
  const db = createDb(env.DB);
  const userId = 'usr_email_test';
  const storefrontId = 'sf_email_test';
  acmeSupplierId = 'sup_acme_email_test';

  await db.insert(users).values({ id: userId, clerkUserId: 'dev-user', email: 'demo@test.dev', createdAt: 0 });
  await db.insert(storefronts).values({
    id: storefrontId,
    userId,
    platform: 'shopify',
    shopDomain: 'demo-store.myshopify.com',
    accessTokenRef: 'env:SHOPIFY_ACCESS_TOKEN',
    webhookSecretRef: 'env:SHOPIFY_WEBHOOK_SECRET',
    createdAt: 0,
  });
  await db.insert(suppliers).values({
    id: acmeSupplierId,
    userId,
    name: 'Acme Supply Co',
    apiBaseUrl: 'https://api.acmesupply.example.com',
    apiKeyRef: 'env:SUPPLIER_API_KEY',
    emailSenderPattern: '@acmesupply.example.com',
    parserId: 'acme-supply-v1',
    active: 1,
    createdAt: 0,
  });
});

async function seedOrderAwaitingTracking(orderId: string) {
  const db = createDb(env.DB);
  await db.insert(orders).values({
    id: orderId,
    storefrontId: 'sf_email_test',
    externalOrderId: `gid://shopify/Order/${orderId}`,
    externalOrderNumber: '#9001',
    status: 'fulfilling',
    currency: 'USD',
    subtotalCents: 4450,
    shippingCents: 500,
    marginCents: 1000,
    rawPayloadId: null,
    createdAt: 0,
    updatedAt: 0,
  });
  const fulfillmentId = `${orderId}-ff`;
  await db.insert(fulfillments).values({
    id: fulfillmentId,
    orderId,
    supplierId: acmeSupplierId,
    costCents: 3000,
    trackingNumber: null,
    carrierDeclared: null,
    carrierDetected: null,
    carrierFinal: null,
    trackingStatus: 'pending',
    pushedToStorefront: 0,
    source: 'supplier_api',
    createdAt: 0,
    updatedAt: 0,
  });
  return fulfillmentId;
}

describe('handleEmail', () => {
  it('extracts tracking via the regex parser and validates the carrier', async () => {
    const fulfillmentId = await seedOrderAwaitingTracking('ord_regex_test');
    await handleEmail(createForwardableMessage(ACME_TRACKING_EMAIL, 'shipping@acmesupply.example.com'), env);

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
    expect(fulfillment?.trackingNumber).toBe('1Z999AA10123456780');
    expect(fulfillment?.carrierFinal).toBe('UPS');
    expect(fulfillment?.source).toBe('regex');
    expect(fulfillment?.trackingStatus).toBe('pending');

    const [event] = await db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.source, 'email'), eq(webhookEvents.dedupKey, '<acme-1001-ship-001@acmesupply.example.com>')));
    expect(event?.error).toBeNull();
  });

  it('falls back to Gemini when the regex parser cannot match, and still succeeds', async () => {
    const fulfillmentId = await seedOrderAwaitingTracking('ord_gemini_test');
    await handleEmail(
      createForwardableMessage(ACME_UNSTRUCTURED_EMAIL, 'shipping@acmesupply.example.com'),
      env,
    );

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, fulfillmentId));
    expect(fulfillment?.trackingNumber).toBe('1Z999AA10123456780');
    expect(fulfillment?.source).toBe('gemini');
  });

  it('records a Needs-review webhook_event when sender and content both fail to yield a candidate', async () => {
    await handleEmail(
      createForwardableMessage(MALFORMED_UNMATCHED_EMAIL, 'no-reply@random-marketing.example.com'),
      env,
    );

    const db = createDb(env.DB);
    const [event] = await db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.source, 'email'), eq(webhookEvents.dedupKey, '<marketing-blast-001@random-marketing.example.com>')));
    expect(event).toBeDefined();
    expect(event?.error).toContain('No supplier matched sender');
  });

  it('is idempotent under duplicate Message-ID delivery', async () => {
    await handleEmail(createForwardableMessage(MALFORMED_UNMATCHED_EMAIL, 'no-reply@random-marketing.example.com'), env);
    await handleEmail(createForwardableMessage(MALFORMED_UNMATCHED_EMAIL, 'no-reply@random-marketing.example.com'), env);

    const db = createDb(env.DB);
    const events = await db
      .select()
      .from(webhookEvents)
      .where(and(eq(webhookEvents.source, 'email'), eq(webhookEvents.dedupKey, '<marketing-blast-001@random-marketing.example.com>')));
    expect(events).toHaveLength(1);
  });
});
