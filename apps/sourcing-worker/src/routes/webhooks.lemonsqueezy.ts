import { Hono } from 'hono';
import { createDb } from '@sourcing/db';
import type { Env } from '../env.js';
import { addCredits } from '../lib/credits.js';
import { setSubscription } from '../lib/billing.js';

const app = new Hono<{ Bindings: Env }>();

// Lemon Squeezy signs webhooks with HMAC-SHA256 (hex) of the RAW body using the
// webhook signing secret, in the `X-Signature` header.
async function verifySignature(secret: string, rawBody: string, signature: string): Promise<boolean> {
  if (!secret || !signature) return false;
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  // constant-time-ish compare
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

interface LsWebhook {
  meta?: { event_name?: string; custom_data?: Record<string, string> };
  data?: { attributes?: { status?: string; renews_at?: string } };
}

/**
 * Lemon Squeezy webhook. Unauthenticated by Clerk (LS calls it) — verified via
 * the X-Signature HMAC instead. Grants credits on a pack purchase and updates
 * subscription state, driven by the `custom` data we attached at checkout
 * (echoed in meta.custom_data), so we don't depend on variant→product mapping.
 * Acks 200 fast; LS retries on non-200.
 */
app.post('/', async (c) => {
  const raw = await c.req.text();
  const signature = c.req.header('X-Signature') ?? '';
  if (!(await verifySignature(c.env.LEMONSQUEEZY_WEBHOOK_SECRET ?? '', raw, signature))) {
    return c.json({ error: { code: 'BAD_SIGNATURE', message: 'Invalid signature' } }, 401);
  }

  let payload: LsWebhook;
  try {
    payload = JSON.parse(raw) as LsWebhook;
  } catch {
    return c.json({ ok: true }); // ack malformed so LS stops retrying
  }

  const event = payload.meta?.event_name ?? '';
  const custom = payload.meta?.custom_data ?? {};
  const userId = custom.user_id;
  if (!userId) return c.json({ ok: true });

  const db = createDb(c.env.SOURCING_DB);

  try {
    if (event === 'order_created' && custom.kind === 'credits') {
      const credits = Number(custom.credits ?? '0');
      if (credits > 0) await addCredits(db, userId, credits, 'purchase', custom.offering_id);
    } else if (event.startsWith('subscription_')) {
      const status = payload.data?.attributes?.status ?? null;
      const renewsAt = payload.data?.attributes?.renews_at ? Date.parse(payload.data.attributes.renews_at) : null;
      // Active-ish statuses keep the plan; cancelled/expired clear it.
      const active = status === 'active' || status === 'on_trial' || status === 'past_due';
      await setSubscription(db, userId, {
        plan: active ? (custom.plan ?? 'pro') : null,
        status,
        subscriptionId: null,
        renewsAt: Number.isFinite(renewsAt) ? renewsAt : null,
      });
    }
  } catch (err) {
    console.error('[lemonsqueezy] handler error:', err);
    // Still 200 — we don't want infinite retries on our own bug; logs capture it.
  }

  return c.json({ ok: true });
});

export default app;
