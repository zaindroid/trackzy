import { createDb, fulfillments, orders, storefronts, trackingEvents, type Database } from '@fulfillment-tracker/db';
import { and, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import { shouldRouteThroughTrackingProxy, type Carrier } from '@fulfillment-tracker/core';
import {
  createTrackingProxyClient,
  RealTrackTacoClient,
  RealTrackCaptainClient,
  type ConvertTrackingResult,
  type TrackingProxyClient,
  type TrackingProxyDestination,
} from '@fulfillment-tracker/adapters/trackingProxy';
import { NonApiModeError } from '@fulfillment-tracker/adapters/ebay';
import type { OrderSource, OrderSourceShipTo } from '@fulfillment-tracker/adapters/orderSource';
import type { Env } from './env.js';
import { newId, now } from './lib/id.js';
import { createOrderSourceForStorefront } from './lib/orderSourceForStorefront.js';
import { sendBuyerMessage } from './messaging.js';

export interface PushTrackingResult {
  pushed: boolean;
  proxied: boolean;
}

interface PushContext {
  orderId: string;
  trackingNumber: string;
  carrierFinal: Carrier | null;
  externalOrderId: string;
  storefront: typeof storefronts.$inferSelect;
  shipTo: OrderSourceShipTo | null;
}

async function fetchPushContext(db: Database, fulfillmentId: string): Promise<PushContext | null> {
  const [row] = await db
    .select({
      orderId: fulfillments.orderId,
      trackingNumber: fulfillments.trackingNumber,
      carrierFinal: fulfillments.carrierFinal,
      externalOrderId: orders.externalOrderId,
      shipToJson: orders.shipToJson,
      storefront: storefronts,
    })
    .from(fulfillments)
    .innerJoin(orders, eq(fulfillments.orderId, orders.id))
    .innerJoin(storefronts, eq(orders.storefrontId, storefronts.id))
    .where(eq(fulfillments.id, fulfillmentId));

  if (!row || !row.trackingNumber) return null;
  return {
    orderId: row.orderId,
    trackingNumber: row.trackingNumber,
    carrierFinal: row.carrierFinal as Carrier | null,
    externalOrderId: row.externalOrderId,
    storefront: row.storefront,
    shipTo: row.shipToJson ? (JSON.parse(row.shipToJson) as OrderSourceShipTo) : null,
  };
}

function toProxyDestination(shipTo: OrderSourceShipTo | null): TrackingProxyDestination | undefined {
  if (!shipTo) return undefined;
  // originCountry mirrors country deliberately — a domestic-looking
  // shipment (buyer's country -> same country) regardless of which
  // supplier (Amazon/AliExpress/Temu/...) actually fulfilled the order.
  // See TrackingProxyDestination.originCountry's doc comment.
  return { city: shipTo.city, state: shipTo.state, zip: shipTo.zip, country: shipTo.country, originCountry: shipTo.country };
}

function isRealKey(key: string | undefined): boolean {
  return Boolean(key) && !key!.startsWith('PLACEHOLDER__');
}

/**
 * Live providers to cascade through, in preference order, when
 * TRACKING_PROXY_PROVIDER isn't explicitly pinned to one. Deliberately
 * excludes bluecare_express/aquiline — both dead, see DECISIONS.md — an
 * automatic cascade should never waste an attempt (and a confusing log
 * line) on a provider known not to work; explicitly setting
 * TRACKING_PROXY_PROVIDER to one of them still works, for anyone who wants
 * to override this on purpose.
 */
const LIVE_PROVIDER_CASCADE = ['tracktaco', 'trackcaptain'] as const;

/**
 * Tries every configured live provider in order and returns the first
 * successful conversion — "use all these services, whichever gives a
 * suitable number" per the user's own framing, rather than committing to
 * one. A provider with no real key configured is skipped silently (not an
 * error); a provider that's configured but fails (no credits, no match,
 * network error) logs and falls through to the next one. Returns null only
 * once every candidate provider has been tried and none produced a result
 * — the caller falls back to the manual-claim queue in that case.
 */
async function attemptAutomatedProxyConversion(
  env: Env,
  fulfillmentId: string,
  originalTracking: string,
  originalCarrier: string,
  destination: TrackingProxyDestination | undefined,
): Promise<ConvertTrackingResult | null> {
  const explicitProvider = env.TRACKING_PROXY_PROVIDER;
  const providers = explicitProvider ? [explicitProvider] : LIVE_PROVIDER_CASCADE;

  for (const provider of providers) {
    const client = realClientForProvider(provider, env);
    if (!client) continue; // no real key configured for this provider — skip without attempting
    try {
      return await client.convertTracking(originalTracking, originalCarrier, destination);
    } catch (err) {
      console.error(`[trackingUploader] ${provider} proxy conversion failed for fulfillment ${fulfillmentId}, trying next provider:`, err);
    }
  }
  return null;
}

/** Returns a real (non-mock) client for the provider only if its key is actually configured; null otherwise. */
function realClientForProvider(provider: string, env: Env): TrackingProxyClient | null {
  if (provider === 'tracktaco' && isRealKey(env.TRACKTACO_API_KEY)) return new RealTrackTacoClient(env);
  if (provider === 'trackcaptain' && isRealKey(env.TRACKCAPTAIN_API_KEY)) return new RealTrackCaptainClient(env);
  // bluecare_express/aquiline are only reachable via an explicit TRACKING_PROXY_PROVIDER
  // override (never part of the automatic cascade) — createTrackingProxyClient still
  // resolves them correctly when explicitly selected, dead as they are.
  if ((provider === 'bluecare_express' && isRealKey(env.BLUECARE_EXPRESS_API_KEY)) || (provider === 'aquiline' && isRealKey(env.AQUILINE_API_KEY))) {
    return createTrackingProxyClient({ ...env, MOCK_MODE: 'false' });
  }
  return null;
}

/**
 * Tracking Uploader Middleware (spec section 7): the single place every
 * marketplace tracking push goes through, so the tracking-proxy rule can
 * never be silently bypassed by a caller pushing tracking directly through
 * `OrderSource.pushTracking`. Always records a `tracking_events` row
 * (proxied or not) before attempting the push, so the audit trail exists
 * even if the push itself fails.
 *
 * Proxy conversion: in mock mode (dev/test), synchronous and deterministic
 * via the existing mock proxy clients. In real production, cascades through
 * every configured live provider (`attemptAutomatedProxyConversion` —
 * TrackTaco, then TrackCaptain, both confirmed live 2026-07; Bluecare
 * Express and Aquiline are dead, blocked by eBay — see DECISIONS.md) with
 * the buyer's ship-to destination, using whichever one succeeds first
 * rather than committing to a single provider. If every configured
 * provider fails (insufficient credits, no match for that destination,
 * network error) — or none has a real key set — this falls back to
 * recording the fulfillment as pending and surfacing it in the Chrome
 * extension's pending-tracking-proxy-conversions queue, where a human can
 * claim a number by hand and submit it through
 * `completeManualProxyConversion` below. The automated path is the common
 * case; the manual queue is the safety net, not the primary flow.
 */
export async function pushTrackingWithProxy(
  env: Env,
  orderSource: OrderSource,
  fulfillmentId: string,
  lineItemIds?: string[],
): Promise<PushTrackingResult> {
  const db = createDb(env.DB);
  const ctx = await fetchPushContext(db, fulfillmentId);
  if (!ctx) {
    throw new Error(`Fulfillment ${fulfillmentId} has no tracking number to push`);
  }

  let trackingToPush = ctx.trackingNumber;
  let carrierToPush: string = ctx.carrierFinal ?? 'UNKNOWN';
  let proxied = false;

  if (shouldRouteThroughTrackingProxy(ctx.carrierFinal, ctx.storefront.platform)) {
    const existing = await getLatestProxyConversion(db, fulfillmentId);
    if (existing) {
      trackingToPush = existing.proxyTracking;
      carrierToPush = existing.proxyCarrier;
      proxied = true;
    } else if (env.MOCK_MODE === 'true') {
      // Global mock mode only — NOT createTrackingProxyClient's own
      // per-adapter isMockMode() gate (which also treats a merely-unset
      // provider key as "use the mock"), since that check running in real
      // production with a forgotten key would silently generate fake
      // tracking numbers and push them to real eBay orders. MOCK_MODE='true'
      // is the one signal that's actually authoritative for "we're in
      // dev/test," so it's checked directly instead.
      const proxyClient = createTrackingProxyClient(env);
      const conversion = await proxyClient.convertTracking(ctx.trackingNumber, carrierToPush, toProxyDestination(ctx.shipTo));
      trackingToPush = conversion.proxyTracking;
      carrierToPush = conversion.proxyCarrier;
      proxied = true;
      await recordTrackingEvent(db, fulfillmentId, ctx.trackingNumber, conversion.proxyTracking, conversion.proxyCarrier);
    } else {
      const conversion = await attemptAutomatedProxyConversion(
        env,
        fulfillmentId,
        ctx.trackingNumber,
        carrierToPush,
        toProxyDestination(ctx.shipTo),
      );
      if (conversion) {
        trackingToPush = conversion.proxyTracking;
        carrierToPush = conversion.proxyCarrier;
        proxied = true;
        await recordTrackingEvent(db, fulfillmentId, ctx.trackingNumber, conversion.proxyTracking, conversion.proxyCarrier);
      } else {
        await ensurePendingProxyConversionRecorded(db, fulfillmentId, ctx.trackingNumber);
        return { pushed: false, proxied: false };
      }
    }
  } else {
    await recordTrackingEvent(db, fulfillmentId, ctx.trackingNumber, null, null);
  }

  return attemptMarketplacePush(db, env, orderSource, fulfillmentId, ctx, trackingToPush, carrierToPush, proxied, lineItemIds);
}

/**
 * Called once a human has manually claimed a converted tracking number
 * (extension's pending-tracking-proxy-conversions queue — see
 * routes/api/extension.ts) for a fulfillment that was previously stuck
 * awaiting proxy conversion. Records the conversion and immediately
 * attempts the marketplace push now that a valid, eBay-recognized number
 * exists.
 */
export async function completeManualProxyConversion(
  env: Env,
  fulfillmentId: string,
  proxyTracking: string,
  proxyCarrier: string,
): Promise<PushTrackingResult> {
  const db = createDb(env.DB);
  const ctx = await fetchPushContext(db, fulfillmentId);
  if (!ctx) {
    throw new Error(`Fulfillment ${fulfillmentId} has no tracking number to push`);
  }

  await recordTrackingEvent(db, fulfillmentId, ctx.trackingNumber, proxyTracking, proxyCarrier);

  const orderSource = await createOrderSourceForStorefront(env, db, ctx.storefront);
  if (!orderSource) {
    // No OAuth configured for this storefront — the conversion is recorded
    // (so pending-tracking-uploads picks it up if the storefront is
    // non-API-mode later), but there's no OrderSource to push through yet.
    return { pushed: false, proxied: true };
  }

  return attemptMarketplacePush(db, env, orderSource, fulfillmentId, ctx, proxyTracking, proxyCarrier, true);
}

async function attemptMarketplacePush(
  db: Database,
  env: Env,
  orderSource: OrderSource,
  fulfillmentId: string,
  ctx: PushContext,
  trackingToPush: string,
  carrierToPush: string,
  proxied: boolean,
  lineItemIds?: string[],
): Promise<PushTrackingResult> {
  try {
    await orderSource.pushTracking(ctx.externalOrderId, {
      trackingNumber: trackingToPush,
      carrier: carrierToPush,
      lineItemIds,
    });
    await db.update(fulfillments).set({ pushedToStorefront: 1, updatedAt: now() }).where(eq(fulfillments.id, fulfillmentId));
    await sendBuyerMessage(env, ctx.orderId, 'shipped').catch(() => undefined); // best-effort — never fail the push over a messaging hiccup
    return { pushed: true, proxied };
  } catch (err) {
    if (err instanceof NonApiModeError) {
      // Not pushed via the API — fulfillments.pushedToStorefront stays 0.
      // The Chrome Extension completes this out-of-band once a human
      // uploads `trackingToPush` through eBay's own DOM (spec 5a), via
      // POST /api/extension/pending-tracking-uploads/:id/complete.
      return { pushed: false, proxied };
    }
    throw err;
  }
}

async function getLatestProxyConversion(
  db: Database,
  fulfillmentId: string,
): Promise<{ proxyTracking: string; proxyCarrier: string } | null> {
  const [row] = await db
    .select({ proxyTracking: trackingEvents.proxyTracking, proxyCarrier: trackingEvents.proxyCarrier })
    .from(trackingEvents)
    .where(and(eq(trackingEvents.fulfillmentId, fulfillmentId), isNotNull(trackingEvents.proxyTracking)))
    .orderBy(desc(trackingEvents.createdAt))
    .limit(1);
  if (!row?.proxyTracking || !row.proxyCarrier) return null;
  return { proxyTracking: row.proxyTracking, proxyCarrier: row.proxyCarrier };
}

async function ensurePendingProxyConversionRecorded(db: Database, fulfillmentId: string, originalTracking: string): Promise<void> {
  const [existingPending] = await db
    .select({ id: trackingEvents.id })
    .from(trackingEvents)
    .where(and(eq(trackingEvents.fulfillmentId, fulfillmentId), isNull(trackingEvents.proxyTracking)))
    .limit(1);
  if (existingPending) return; // already recorded, awaiting a human claim
  await recordTrackingEvent(db, fulfillmentId, originalTracking, null, null);
}

async function recordTrackingEvent(
  db: Database,
  fulfillmentId: string,
  originalTracking: string,
  proxyTracking: string | null,
  proxyCarrier: string | null,
): Promise<void> {
  await db.insert(trackingEvents).values({
    id: newId(),
    fulfillmentId,
    originalTracking,
    proxyTracking,
    proxyCarrier,
    status: 'pending',
    rawStatus: null,
    createdAt: now(),
  });
}
