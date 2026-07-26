import { describe, expect, it, beforeEach, vi } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, fulfillments, orders, storefronts, suppliers, trackingEvents, users } from '@fulfillment-tracker/db';
import { and, eq, isNotNull } from 'drizzle-orm';
import { MockEbayOrderSource } from '@fulfillment-tracker/adapters/ebay';
import { completeManualProxyConversion, pushTrackingWithProxy } from './trackingUploader.js';
import type { Env } from './env.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

// Real (non-mock) production mode with no proxy provider key configured at
// all — Bluecare Express/Aquiline are both dead (see DECISIONS.md) and
// neither TrackTaco nor TrackCaptain has a key set, so this is "forgot to
// configure a key," the safety-net case that should fall back to the
// manual-claim queue rather than attempt (and fail) a real API call.
const REAL_ENV: Env = {
  ...env,
  MOCK_MODE: 'false',
  BLUECARE_EXPRESS_API_KEY: undefined,
  AQUILINE_API_KEY: undefined,
  TRACKCAPTAIN_API_KEY: undefined,
  TRACKTACO_API_KEY: undefined,
};

// Real production mode with a real-looking TrackTaco key — TrackTaco is the
// default provider, so no TRACKING_PROXY_PROVIDER override needed. This is
// what an actual working deployment looks like today.
const REAL_ENV_WITH_TRACKTACO: Env = { ...REAL_ENV, TRACKTACO_API_KEY: 'tt_live_test-key' };

// Real production mode with TRACKING_PROXY_PROVIDER explicitly overridden
// to the alternate live provider, TrackCaptain.
const REAL_ENV_WITH_TRACKCAPTAIN: Env = { ...REAL_ENV, TRACKING_PROXY_PROVIDER: 'trackcaptain', TRACKCAPTAIN_API_KEY: 'tc_live_test-key' };

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
    oauthAccessTokenRef: 'env:EBAY_OAUTH_ACCESS_TOKEN',
    oauthRefreshTokenRef: 'env:EBAY_OAUTH_REFRESH_TOKEN',
    oauthExpiresAt: Date.now() + 3600_000,
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
    expect(pushedInput.trackingNumber).toMatch(/^TT[0-9A-F]{10}$/); // proxied, not the raw TBA number
    expect(pushedInput.trackingNumber).not.toBe('TBA123456789012');

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, 'ff_proxy'));
    expect(fulfillment?.pushedToStorefront).toBe(1);

    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_proxy'));
    expect(event?.originalTracking).toBe('TBA123456789012');
    expect(event?.proxyTracking).toMatch(/^TT[0-9A-F]{10}$/);
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
    expect(event?.proxyTracking).toMatch(/^TT[0-9A-F]{10}$/); // proxy conversion still happened before the push attempt
  });

  it('in real (non-mock) mode with no proxy key configured, records a pending proxy conversion and does NOT push', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_real_pending',
      fulfillmentId: 'ff_real_pending',
      storefrontId: 'sf_real_pending',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA555555555555',
      carrierFinal: 'AMZL',
    });
    const ebay = new MockEbayOrderSource(false);

    const result = await pushTrackingWithProxy(REAL_ENV, ebay, 'ff_real_pending');

    expect(result).toEqual({ pushed: false, proxied: false });
    expect(ebay.calls).toHaveLength(0); // never even attempted — nothing safe to push yet

    const db = createDb(env.DB);
    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_real_pending'));
    expect(event?.originalTracking).toBe('TBA555555555555');
    expect(event?.proxyTracking).toBeNull();

    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, 'ff_real_pending'));
    expect(fulfillment?.pushedToStorefront).toBe(0);
  });

  it('a second real-mode call for the same fulfillment does not create a duplicate pending tracking_events row', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_real_dup',
      fulfillmentId: 'ff_real_dup',
      storefrontId: 'sf_real_dup',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA777777777777',
      carrierFinal: 'AMZL',
    });
    const ebay = new MockEbayOrderSource(false);

    await pushTrackingWithProxy(REAL_ENV, ebay, 'ff_real_dup');
    await pushTrackingWithProxy(REAL_ENV, ebay, 'ff_real_dup');

    const db = createDb(env.DB);
    const events = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_real_dup'));
    expect(events).toHaveLength(1);
  });

  it('with TRACKING_PROXY_PROVIDER=trackcaptain and a real key, automatically claims a number by destination and pushes — no manual queue involved', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_real_auto',
      fulfillmentId: 'ff_real_auto',
      storefrontId: 'sf_real_auto',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA222222222222',
      carrierFinal: 'AMZL',
    });
    const db = createDb(env.DB);
    await db
      .update(orders)
      .set({ shipToJson: JSON.stringify({ name: 'Jordan Buyer', address1: '742 Evergreen Terrace', city: 'Houston', state: 'TX', zip: '77044', country: 'US' }) })
      .where(eq(orders.id, 'ord_real_auto'));

    let capturedBody: unknown;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
        capturedBody = JSON.parse(init?.body as string);
        return jsonResponse({ tracking_number: '9400111899223197428490', carrier: 'USPS' });
      }),
    );
    const ebay = new MockEbayOrderSource(false);

    const result = await pushTrackingWithProxy(REAL_ENV_WITH_TRACKCAPTAIN, ebay, 'ff_real_auto');

    expect(result).toEqual({ pushed: true, proxied: true });
    expect(capturedBody).toEqual({ city: 'Houston', state: 'TX', zip: '77044', country: 'US', delivery_date: undefined });
    const [call] = ebay.calls;
    const [, pushedInput] = call!.args as [string, { trackingNumber: string }];
    expect(pushedInput.trackingNumber).toBe('9400111899223197428490');

    vi.unstubAllGlobals();
  });

  it('falls back to the manual-claim queue when the real TrackCaptain call fails (e.g. insufficient credits, explicit provider override)', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_real_fail',
      fulfillmentId: 'ff_real_fail',
      storefrontId: 'sf_real_fail',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA333333333333',
      carrierFinal: 'AMZL',
    });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ error: 'Insufficient credits.', credit_balance: 0 }, 402)));
    const ebay = new MockEbayOrderSource(false);

    const result = await pushTrackingWithProxy(REAL_ENV_WITH_TRACKCAPTAIN, ebay, 'ff_real_fail');

    expect(result).toEqual({ pushed: false, proxied: false });
    expect(ebay.calls).toHaveLength(0);

    const db = createDb(env.DB);
    const [event] = await db.select().from(trackingEvents).where(eq(trackingEvents.fulfillmentId, 'ff_real_fail'));
    expect(event?.proxyTracking).toBeNull(); // recorded pending, not converted — the extension queue will pick it up

    vi.unstubAllGlobals();
  });

  it('with TrackTaco (the default provider) configured, searches by destination then reveals the first candidate and pushes', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_real_tt_auto',
      fulfillmentId: 'ff_real_tt_auto',
      storefrontId: 'sf_real_tt_auto',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA444444444444',
      carrierFinal: 'AMZL',
    });
    const db = createDb(env.DB);
    await db
      .update(orders)
      .set({ shipToJson: JSON.stringify({ name: 'Jordan Buyer', address1: '742 Evergreen Terrace', city: 'Austin', state: 'TX', zip: '73301', country: 'US' }) })
      .where(eq(orders.id, 'ord_real_tt_auto'));

    const calls: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const body = JSON.parse(init?.body as string);
        calls.push({ url, body });
        if (url.endsWith('/v2/tns/search')) {
          return jsonResponse({ searches: [{ results: [{ tn_id: 'tn_fedex_abc123', carrier: 'fedex' }], next_cursor: null, total: 1 }] });
        }
        return jsonResponse({
          results: [{ tn_id: 'tn_fedex_abc123', outcome: 'revealed', tracking_number: '871512246087', carrier: 'fedex' }],
          credits_remaining: 23,
        });
      }),
    );
    const ebay = new MockEbayOrderSource(false);

    const result = await pushTrackingWithProxy(REAL_ENV_WITH_TRACKTACO, ebay, 'ff_real_tt_auto');

    expect(result).toEqual({ pushed: true, proxied: true });
    expect(calls[0]?.url).toBe('https://v2.tracktaco.com/v2/tns/search');
    expect(calls[0]?.body).toMatchObject({ searches: [{ filter: { dest: { city: 'Austin', state: 'TX', country: 'US' } } }] });
    expect(calls[1]?.url).toBe('https://v2.tracktaco.com/v2/tns/reveal');
    expect(calls[1]?.body).toEqual({ tn_ids: ['tn_fedex_abc123'] });
    const [call] = ebay.calls;
    const [, pushedInput] = call!.args as [string, { trackingNumber: string; carrier: string }];
    expect(pushedInput.trackingNumber).toBe('871512246087');
    expect(pushedInput.carrier).toBe('FedEx');

    vi.unstubAllGlobals();
  });

  it('skips an already-revealed TrackTaco candidate and pushes the next one', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_real_tt_retry',
      fulfillmentId: 'ff_real_tt_retry',
      storefrontId: 'sf_real_tt_retry',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA666666666666',
      carrierFinal: 'AMZL',
    });
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.endsWith('/v2/tns/search')) {
          return jsonResponse({
            searches: [
              {
                results: [
                  { tn_id: 'tn_ups_first', carrier: 'ups' },
                  { tn_id: 'tn_ups_second', carrier: 'ups' },
                ],
                next_cursor: null,
                total: 2,
              },
            ],
          });
        }
        return jsonResponse({
          results: [
            { tn_id: 'tn_ups_first', outcome: 'already_revealed', error: { code: 'tn_already_revealed', message: 'claimed by another customer' } },
            { tn_id: 'tn_ups_second', outcome: 'revealed', tracking_number: '1Z999AA10123456780', carrier: 'ups' },
          ],
          credits_remaining: 22,
        });
      }),
    );
    const ebay = new MockEbayOrderSource(false);

    const result = await pushTrackingWithProxy(REAL_ENV_WITH_TRACKTACO, ebay, 'ff_real_tt_retry');

    expect(result).toEqual({ pushed: true, proxied: true });
    const [call] = ebay.calls;
    const [, pushedInput] = call!.args as [string, { trackingNumber: string }];
    expect(pushedInput.trackingNumber).toBe('1Z999AA10123456780');

    vi.unstubAllGlobals();
  });

  it('cascades to TrackCaptain when TrackTaco fails, with both providers configured and no explicit override — "use whichever gives a suitable number"', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_cascade',
      fulfillmentId: 'ff_cascade',
      storefrontId: 'sf_cascade',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA888888888888',
      carrierFinal: 'AMZL',
    });
    const bothProvidersEnv: Env = { ...REAL_ENV, TRACKTACO_API_KEY: 'tt_live_test-key', TRACKCAPTAIN_API_KEY: 'tc_live_test-key' };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('tracktaco.com')) {
          // TrackTaco fails outright (e.g. out of credits) — cascade should move on, not give up.
          return jsonResponse({ error: { code: 'insufficient_credits', message: 'Your balance is 0.' } }, 402);
        }
        // TrackCaptain (tried second) succeeds.
        return jsonResponse({ tracking_number: '9405511899560987654321', carrier: 'USPS' });
      }),
    );
    const ebay = new MockEbayOrderSource(false);

    const result = await pushTrackingWithProxy(bothProvidersEnv, ebay, 'ff_cascade');

    expect(result).toEqual({ pushed: true, proxied: true });
    const [call] = ebay.calls;
    const [, pushedInput] = call!.args as [string, { trackingNumber: string; carrier: string }];
    expect(pushedInput.trackingNumber).toBe('9405511899560987654321');
    expect(pushedInput.carrier).toBe('USPS');

    vi.unstubAllGlobals();
  });
});

describe('completeManualProxyConversion', () => {
  it('records the human-claimed conversion and pushes it to the marketplace', async () => {
    await seedOrderAndFulfillment({
      orderId: 'ord_complete',
      fulfillmentId: 'ff_complete',
      storefrontId: 'sf_complete',
      platform: 'ebay',
      nonApiMode: false,
      trackingNumber: 'TBA111111111111',
      carrierFinal: 'AMZL',
    });
    // First call (real mode) records the pending conversion, same as the extension queue would surface.
    await pushTrackingWithProxy(REAL_ENV, new MockEbayOrderSource(false), 'ff_complete');

    const result = await completeManualProxyConversion(REAL_ENV, 'ff_complete', '9400111899223197428490', 'USPS');

    expect(result).toEqual({ pushed: true, proxied: true });

    const db = createDb(env.DB);
    const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, 'ff_complete'));
    expect(fulfillment?.pushedToStorefront).toBe(1);

    const [event] = await db
      .select()
      .from(trackingEvents)
      .where(and(eq(trackingEvents.fulfillmentId, 'ff_complete'), isNotNull(trackingEvents.proxyTracking)));
    expect(event?.proxyTracking).toBe('9400111899223197428490');
    expect(event?.proxyCarrier).toBe('USPS');
  });
});
