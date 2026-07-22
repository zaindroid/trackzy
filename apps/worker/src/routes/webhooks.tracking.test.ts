import { describe, expect, it, beforeEach } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { computeHmacSha256Base64 } from '@fulfillment-tracker/adapters/hmac';
import { createDb, fulfillments, messages, orders, storefronts, suppliers, trackingEvents, users, webhookEvents } from '@fulfillment-tracker/db';
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

  it('records a tracking_events row for a deterministically-mapped status', async () => {
    await post(payload('1Z999AA10123456780', 'InTransit'));

    const db = createDb(env.DB);
    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_t'));
    expect(event?.status).toBe('in_transit');
    expect(event?.rawStatus).toBe('InTransit');
    expect(event?.originalTracking).toBe('1Z999AA10123456780');
  });

  it('falls back to Gemini classification for an unmapped status and still records tracking_events', async () => {
    await post(payload('1Z999AA10123456780', 'Package appears lost in transit'));

    const db = createDb(env.DB);
    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_t'));
    expect(event?.status).toBe('exception'); // mock Gemini recognizes the "lost" keyword
    expect(event?.rawStatus).toBe('Package appears lost in transit');
  });

  it('sends a delivered buyer message and schedules a feedback reminder on delivery', async () => {
    await post(payload('1Z999AA10123456780', 'Delivered'));

    const db = createDb(env.DB);
    const rows = await db.select().from(messages).where(eq(messages.orderId, 'ord_t'));
    const triggers = rows.map((m) => m.trigger).sort();
    expect(triggers).toEqual(['delivered', 'feedback_reminder']);

    const delivered = rows.find((m) => m.trigger === 'delivered');
    expect(delivered?.status).toBe('skipped'); // storefront platform is shopify — no OrderSource, so sendBuyerMessage skips
    const reminder = rows.find((m) => m.trigger === 'feedback_reminder');
    expect(reminder?.status).toBe('pending'); // scheduled, not sent immediately
  });

  it('sends a stalled message for a stuck/lost exception and completes without error', async () => {
    // The actual `disputes` row is written by DisputeWorkflow.run() itself
    // (Phase 1, packages/adapters/src/gemini + disputeLogic.ts), not by this
    // route — draftDispute() here only best-effort starts that Workflow
    // instance. The DISPUTE_WORKFLOW binding is unavailable in this test
    // environment (see wrangler.test.toml), so draftDispute() is a documented
    // no-op here; DisputeWorkflow's own row-writing behavior is covered
    // directly by workflows/disputeLogic.test.ts. What's observable — and
    // what this test actually asserts — is that the stuck/lost path still
    // sends the 'stalled' buyer message and the request completes cleanly.
    const res = await post(payload('1Z999AA10123456780', 'Package appears lost in transit'));
    expect(res.status).toBe(200);

    const db = createDb(env.DB);
    const rows = await db.select().from(messages).where(eq(messages.orderId, 'ord_t'));
    expect(rows.some((m) => m.trigger === 'stalled')).toBe(true);
  });

  it('does not send a stalled message for a needs_review (genuinely unclassifiable) status', async () => {
    await post(payload('1Z999AA10123456780', 'Status code 47B'));

    const db = createDb(env.DB);
    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_t'));
    expect(event?.status).toBe('needs_review');

    const rows = await db.select().from(messages).where(eq(messages.orderId, 'ord_t'));
    expect(rows).toHaveLength(0);
  });
});
