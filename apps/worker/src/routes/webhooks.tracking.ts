import { Hono } from 'hono';
import { verifyHmacSha256 } from '@fulfillment-tracker/adapters/hmac';
import { createDb, fulfillments, webhookEvents } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import { safeGetWorkflowInstance } from '../lib/workflow.js';
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
  const status = STATUS_MAP[payload.data.track_info.latest_status.status];

  if (status) {
    const [fulfillment] = await db
      .select({ id: fulfillments.id, orderId: fulfillments.orderId })
      .from(fulfillments)
      .where(eq(fulfillments.trackingNumber, payload.data.number))
      .limit(1);

    if (fulfillment) {
      const instance = await safeGetWorkflowInstance(c.env.ORDER_WORKFLOW, fulfillment.orderId);
      const event: TrackingStatusEvent = { fulfillmentId: fulfillment.id, status };
      await instance?.sendEvent({ type: 'tracking-status', payload: event });
    }
  }

  return c.json({ ok: true });
});

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default app;
