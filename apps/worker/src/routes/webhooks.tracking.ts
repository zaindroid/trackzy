import { Hono } from 'hono';
import { verifyHmacSha256 } from '@fulfillment-tracker/adapters/hmac';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import { createDb, fulfillments, trackingEvents, webhookEvents } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { safeGetWorkflowInstance } from '../lib/workflow.js';
import { draftDispute } from '../lib/draftDispute.js';
import { sendBuyerMessage, scheduleFeedbackReminder } from '../messaging.js';
import type { TrackingStatusEvent } from '../workflows/types.js';

interface SeventeenTrackWebhookPayload {
  event: string;
  data: {
    number: string;
    track_info: { latest_status: { status: string } };
  };
}

const STATUS_MAP: Record<string, TrackingStatusEvent['status']> = {
  InTransit: 'in_transit',
  OutForDelivery: 'in_transit',
  AvailableForPickup: 'in_transit',
  Delivered: 'delivered',
  Exception: 'exception',
  DeliveryFailure: 'exception',
  Expired: 'exception',
};

const app = new Hono<{ Bindings: Env }>();

/**
 * POST /webhooks/17track — HMAC-verified (shared-secret scheme; see
 * DEPLOY.md TODO(HUMAN) to confirm 17TRACK's exact signature header against
 * their live docs once a real account is provisioned) and deduplicated by a
 * hash of the raw body, since 17TRACK does not send a stable event id.
 *
 * Delivery monitoring + exceptions triage (spec section 9): deterministic
 * rules (STATUS_MAP) run first; a raw status STATUS_MAP doesn't recognize
 * falls through to Gemini for structured classification — the fourth and
 * final authorized LLM call site in this codebase. Every event (mapped or
 * not) is recorded in `tracking_events`, not just ones that change
 * `fulfillments.trackingStatus`.
 */
app.post('/', async (c) => {
  const rawBody = await c.req.text();
  const signature = c.req.header('X-17Track-Sign');
  const secret = c.env.SEVENTEENTRACK_API_KEY ?? '';

  if (!signature) {
    return c.json({ error: { code: 'BAD_REQUEST', message: 'Missing signature header' } }, 400);
  }
  const valid = await verifyHmacSha256(secret, rawBody, signature);
  if (!valid) {
    return c.json({ error: { code: 'INVALID_SIGNATURE', message: 'HMAC verification failed' } }, 401);
  }

  const dedupKey = await sha256Hex(rawBody);
  const db = createDb(c.env.DB);

  const [existing] = await db
    .select({ id: webhookEvents.id })
    .from(webhookEvents)
    .where(eq(webhookEvents.dedupKey, dedupKey))
    .limit(1);
  if (existing) {
    return c.json({ ok: true, deduped: true });
  }

  await db.insert(webhookEvents).values({
    id: newId(),
    source: '17track',
    dedupKey,
    rawBody,
    headersJson: JSON.stringify(Object.fromEntries(c.req.raw.headers)),
    processed: 1,
    error: null,
    receivedAt: now(),
  });

  const payload = JSON.parse(rawBody) as SeventeenTrackWebhookPayload;
  const rawStatus = payload.data.track_info.latest_status.status;
  // Deterministic map first; a status it doesn't recognize escalates to
  // Gemini for structured classification (spec 9) — the broader 4-value type
  // here (vs. the workflow's 3-value TrackingStatusEvent) is deliberate:
  // 'needs_review' is a real, distinct outcome that must not silently
  // masquerade as one of the other three when sent onward to the workflow.
  const mapped = STATUS_MAP[rawStatus];
  let status: 'in_transit' | 'delivered' | 'exception' | 'needs_review' = mapped ?? 'needs_review';
  let isStuckOrLost = status === 'exception';

  if (!mapped) {
    const gemini = createGeminiExtractor(c.env);
    const classification = await gemini.classifyTrackingException(rawStatus);
    status = classification.category;
    isStuckOrLost = classification.isStuckOrLost;
  }

  const [fulfillment] = await db
    .select({ id: fulfillments.id, orderId: fulfillments.orderId })
    .from(fulfillments)
    .where(eq(fulfillments.trackingNumber, payload.data.number))
    .limit(1);

  if (fulfillment) {
    await db.insert(trackingEvents).values({
      id: newId(),
      fulfillmentId: fulfillment.id,
      originalTracking: payload.data.number,
      proxyTracking: null,
      proxyCarrier: null,
      status,
      rawStatus,
      createdAt: now(),
    });

    if (status !== 'needs_review') {
      const instance = await safeGetWorkflowInstance(c.env.ORDER_WORKFLOW, fulfillment.orderId);
      const event: TrackingStatusEvent = { fulfillmentId: fulfillment.id, status };
      await instance?.sendEvent({ type: 'tracking-status', payload: event });
    }

    if (status === 'delivered') {
      await sendBuyerMessage(c.env, fulfillment.orderId, 'delivered').catch(() => undefined);
      await scheduleFeedbackReminder(c.env, fulfillment.orderId).catch(() => undefined);
    } else if (status === 'exception') {
      await sendBuyerMessage(c.env, fulfillment.orderId, 'stalled').catch(() => undefined);
      if (isStuckOrLost) {
        await draftDispute(c.env, fulfillment.id, `Carrier reported a stuck/lost shipment: "${rawStatus}"`);
      }
    }
  }

  return c.json({ ok: true });
});

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default app;
