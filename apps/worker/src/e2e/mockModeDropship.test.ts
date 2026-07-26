import { describe, expect, it } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { computeHmacSha256Base64 } from '@fulfillment-tracker/adapters/hmac';
import { MockEbayOrderSource } from '@fulfillment-tracker/adapters/ebay';
import {
  createDb,
  fulfillments,
  manualTasks,
  messages,
  orderLineItems,
  orders,
  storefronts,
  suppliers,
  trackingEvents,
  users,
  webhookEvents,
} from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import { pollGmailForUser } from '../gmailIngestion.js';
import { pushTrackingWithProxy } from '../trackingUploader.js';

const AUTH_HEADERS = { Authorization: 'Bearer dev-user', 'Content-Type': 'application/json' };
const SEVENTEENTRACK_SECRET = 'test-17track-shared-secret'; // matches vitest.config.ts's miniflare binding

const USER_ID = 'usr_e2e';
const STOREFRONT_ID = 'sf_e2e_ebay';
const SUPPLIER_ID = 'sup_e2e_amazon_retail';
const ORDER_ID = 'ord_e2e';
const MANUAL_TASK_ID = 'mt_e2e';
const FULFILLMENT_ID = 'ff_e2e';

/**
 * Spec section 11's own end-to-end scenario, exercised across every Phase 2
 * milestone in sequence with zero real credentials:
 *
 *   eBay order -> non-API-mode manual supplier -> manual task claimed and
 *   completed by "the Edge Agent" (Chrome extension) -> mock Gmail delivers
 *   the Amazon shipping-confirmation email -> TBA tracking number proxied to
 *   a compliant Bluecare Express number -> non-API DOM upload queue surfaces
 *   the *proxied* number -> extension completes the upload -> a Delivered
 *   17TRACK event fires the buyer-messaging + feedback-reminder engine.
 *
 * "Scored to Amazon Retail" from the original spec prose is represented here
 * by seeding the manual task directly rather than driving it through
 * `matchListing()` — that cascade (milestone 8) only searches `kind='api'`
 * suppliers by design (see DECISIONS.md milestone 8), and no milestone wired
 * automatic manual-task creation from order intake (Phase 1's `OrderWorkflow`
 * remains Shopify-only, untouched, per "extend don't rewrite" — see
 * DECISIONS.md milestone 2). That specific order-intake-to-manual-task
 * handoff is a documented scope boundary, not silently glossed over; this
 * test instead proves every downstream piece composes correctly once a
 * manual task exists, exactly like each individual milestone's own tests do,
 * just chained together in one realistic sequence.
 */
describe('MOCK_MODE end-to-end: eBay + manual Amazon Retail supplier dropship flow', () => {
  it('runs the full buy-queue -> Gmail -> tracking-proxy -> delivery -> messaging chain', async () => {
    const db = createDb(env.DB);

    await db.insert(users).values({
      id: USER_ID,
      clerkUserId: 'dev-user',
      email: 'e2e@test.dev',
      createdAt: 0,
      gmailRefreshTokenRef: 'env:GMAIL_OAUTH_REFRESH_TOKEN',
      gmailAccessTokenRef: 'env:GMAIL_OAUTH_ACCESS_TOKEN',
      gmailTokenExpiresAt: Date.now() + 3_600_000,
      gmailLastPolledAt: 0,
    });
    await db.insert(storefronts).values({
      id: STOREFRONT_ID,
      userId: USER_ID,
      platform: 'ebay',
      shopDomain: 'e2e-ebay-store',
      accessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
      webhookSecretRef: 'env:EBAY_WEBHOOK_SECRET',
      createdAt: 0,
      nonApiMode: 1, // this seller's eBay account has no Fulfillment-API tracking-upload capability
      oauthAccessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
      oauthRefreshTokenRef: 'env:EBAY_OAUTH_REFRESH_TOKEN',
      oauthExpiresAt: Date.now() + 3_600_000,
    });
    await db.insert(suppliers).values({
      id: SUPPLIER_ID,
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
    });
    await db.insert(orders).values({
      id: ORDER_ID,
      storefrontId: STOREFRONT_ID,
      externalOrderId: 'ebay-e2e-order-1',
      externalOrderNumber: 'e2e-order-1',
      status: 'fulfilling',
      currency: 'USD',
      subtotalCents: 5999,
      shippingCents: 0,
      marginCents: 2200,
      rawPayloadId: null,
      createdAt: 0,
      updatedAt: 0,
    });
    await db.insert(orderLineItems).values({
      id: 'li_e2e_1',
      orderId: ORDER_ID,
      externalLineItemId: 'ebay-e2e-li-1',
      fulfillmentOrderLineItemId: null,
      sku: 'WIDGET-RED-L',
      title: 'Widget - Red / Large',
      quantity: 1,
      quantityFulfilled: 0,
      unitPriceCents: 5999,
    });
    await db.insert(manualTasks).values({
      id: MANUAL_TASK_ID,
      orderId: ORDER_ID,
      supplierId: SUPPLIER_ID,
      state: 'pending',
      payloadJson: JSON.stringify({
        sku: 'WIDGET-RED-L',
        quantity: 1,
        shipTo: { name: 'Jordan Buyer', address1: '742 Evergreen Terrace', city: 'Springfield', state: 'IL', zip: '62704', country: 'US' },
      }),
      createdAt: 0,
      updatedAt: 0,
    });

    // --- 1. Buy Queue: claim the task (milestone 6) ---
    const claimRes = await SELF.fetch(`https://worker.example.com/api/manual-tasks/${MANUAL_TASK_ID}/claim`, {
      method: 'POST',
      headers: AUTH_HEADERS,
    });
    expect(claimRes.status).toBe(200);

    // --- 2. The Edge Agent reads the active task to 1-click paste the address (milestone 6) ---
    const activeRes = await SELF.fetch('https://worker.example.com/api/extension/active-manual-task', { headers: AUTH_HEADERS });
    const activeBody = (await activeRes.json()) as { task: { id: string; payload: { shipTo: { name: string } } } | null };
    expect(activeBody.task?.id).toBe(MANUAL_TASK_ID);
    expect(activeBody.task?.payload.shipTo.name).toBe('Jordan Buyer');

    // --- 3. Human places the order on Amazon; extension fires "mark ordered" (milestone 6) ---
    const markOrderedRes = await SELF.fetch(`https://worker.example.com/api/manual-tasks/${MANUAL_TASK_ID}/mark-ordered`, {
      method: 'POST',
      headers: AUTH_HEADERS,
      body: JSON.stringify({ supplierOrderRef: '111-2223334-5556667' }),
    });
    expect(markOrderedRes.status).toBe(200);
    const [orderedTask] = await db.select().from(manualTasks).where(eq(manualTasks.id, MANUAL_TASK_ID));
    expect(orderedTask?.state).toBe('ordered');

    // A fulfillment shell awaiting tracking now exists (the actual "place
    // this order and open a fulfillment shell" wiring for manual suppliers
    // is the documented scope boundary above; inserted directly here to
    // represent the state the system is in once a human has ordered).
    await db.insert(fulfillments).values({
      id: FULFILLMENT_ID,
      orderId: ORDER_ID,
      supplierId: SUPPLIER_ID,
      costCents: 3400,
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

    // --- 4. Gmail Parsing Engine picks up Amazon's shipping-confirmation email (milestone 5) ---
    await pollGmailForUser(env, USER_ID);

    const [afterGmail] = await db.select().from(fulfillments).where(eq(fulfillments.id, FULFILLMENT_ID));
    expect(afterGmail?.trackingNumber).toBe('TBA123456789012');
    expect(afterGmail?.carrierFinal).toBe('AMZL');
    expect(afterGmail?.trackingStatus).toBe('pending'); // not needs_review — AMZL format was recognized
    expect(afterGmail?.source).toBe('regex');

    const [gmailEvent] = await db
      .select()
      .from(webhookEvents)
      .where(eq(webhookEvents.dedupKey, 'gmail:gmail-mock-amazon-1'));
    expect(gmailEvent?.error).toBeNull();

    // --- 5. Tracking Conversion Middleware: TBA -> proxied TrackCaptain number (milestone 7) ---
    const ebay = new MockEbayOrderSource(true); // non_api_mode -> pushTracking throws NonApiModeError
    const pushResult = await pushTrackingWithProxy(env, ebay, FULFILLMENT_ID);
    expect(pushResult).toEqual({ pushed: false, proxied: true });

    const [proxyEvent] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, FULFILLMENT_ID));
    expect(proxyEvent?.originalTracking).toBe('TBA123456789012');
    expect(proxyEvent?.proxyTracking).toMatch(/^TT[0-9A-F]{10}$/);

    const [afterProxy] = await db.select().from(fulfillments).where(eq(fulfillments.id, FULFILLMENT_ID));
    expect(afterProxy?.pushedToStorefront).toBe(0); // API push was skipped (non-API mode); extension completes it below

    // --- 6. Non-API DOM upload queue surfaces the *proxied* number, not the raw TBA one (milestones 2, 6, 7) ---
    const uploadsRes = await SELF.fetch('https://worker.example.com/api/extension/pending-tracking-uploads', { headers: AUTH_HEADERS });
    const uploadsBody = (await uploadsRes.json()) as { uploads: { fulfillmentId: string; trackingNumber: string; carrier: string }[] };
    const upload = uploadsBody.uploads.find((u) => u.fulfillmentId === FULFILLMENT_ID);
    expect(upload?.trackingNumber).toBe(proxyEvent?.proxyTracking);
    expect(upload?.trackingNumber).not.toBe('TBA123456789012');
    expect(upload?.carrier).toBe('UPS');

    const completeRes = await SELF.fetch(
      `https://worker.example.com/api/extension/pending-tracking-uploads/${FULFILLMENT_ID}/complete`,
      { method: 'POST', headers: AUTH_HEADERS },
    );
    expect(completeRes.status).toBe(200);
    const [afterComplete] = await db.select().from(fulfillments).where(eq(fulfillments.id, FULFILLMENT_ID));
    expect(afterComplete?.pushedToStorefront).toBe(1);

    // --- 7. Carrier delivers; 17TRACK webhook fires the messaging engine (milestone 9) ---
    // The carrier tracks the shipment under its original AMZL number regardless of which
    // number was shown to the eBay buyer, so the webhook still keys off the raw one.
    const deliveredPayload = JSON.stringify({
      event: 'TRACKING_UPDATED',
      data: { number: 'TBA123456789012', track_info: { latest_status: { status: 'Delivered' } } },
    });
    const signature = await computeHmacSha256Base64(SEVENTEENTRACK_SECRET, deliveredPayload);
    const trackingRes = await SELF.fetch('https://worker.example.com/webhooks/17track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-17Track-Sign': signature },
      body: deliveredPayload,
    });
    expect(trackingRes.status).toBe(200);

    // Two tracking_events rows now exist for this fulfillment: the proxy conversion (step 5)
    // and this delivery event.
    const allEvents = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, FULFILLMENT_ID));
    const delivery = allEvents.find((e) => e.status === 'delivered');
    expect(delivery?.rawStatus).toBe('Delivered');

    // --- 8. Buyer messaging: delivered notice sent, feedback reminder scheduled (milestone 9) ---
    const messageRows = await db.select().from(messages).where(eq(messages.orderId, ORDER_ID));
    const triggers = messageRows.map((m) => m.trigger).sort();
    expect(triggers).toEqual(['delivered', 'feedback_reminder']);
    const deliveredMessage = messageRows.find((m) => m.trigger === 'delivered');
    expect(deliveredMessage?.status).toBe('sent'); // eBay storefront has a real OrderSource -> not skipped like Shopify
    const reminder = messageRows.find((m) => m.trigger === 'feedback_reminder');
    expect(reminder?.status).toBe('pending'); // scheduled, not sent immediately — see messaging.ts
  });
});
