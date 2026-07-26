import { Hono } from 'hono';
import { eq } from 'drizzle-orm';
import { createDb, manualTasks, orders, storefronts } from '@fulfillment-tracker/db';
import type { Env } from '../env.js';
import { now } from '../lib/id.js';

const app = new Hono<{ Bindings: Env }>();

interface EbayDeletionPayload {
  notification?: {
    notificationId?: string;
    data?: {
      username?: string;
      userId?: string;
    };
  };
}

/**
 * eBay's Marketplace Account Deletion/Closure notification requirement —
 * mandatory for every Production keyset (eBay disables the keyset until
 * this is either wired up or exempted; see DEPLOY.md section 8b). We can't
 * honestly claim the exemption here: eBay buyer PII (name + shipping
 * address) genuinely flows into this system, via
 * packages/adapters/src/orderSource/iface.ts's OrderSourceOrder.shipTo,
 * written into manual_tasks.payload_json for the Buy Queue / extension flow
 * (see apps/extension/src/content/checkout.ts). Neither `orders` nor
 * `order_line_items` store buyer PII directly, so manual_tasks is the only
 * place this handler needs to touch.
 *
 * GET is eBay's one-time endpoint-ownership challenge: it calls with
 * ?challenge_code=..., and expects
 * {"challengeResponse": sha256Hex(challengeCode + verificationToken + endpointUrl)}
 * — eBay's documented algorithm, where endpointUrl is this endpoint's exact
 * URL as registered in the eBay Developer Portal (no query string).
 *
 * POST is the real notification, sent whenever an eBay user requests
 * account deletion. We redact that buyer's identity out of every
 * manual_tasks row tied to an eBay storefront and ack with 200 — eBay
 * retries on non-200/timeout, so this must stay fast and not throw.
 *
 * The `notification.data.username` shape below was confirmed against a real
 * "Send Test Notification" payload from the eBay Developer Portal
 * (2026-07): `{"metadata":{"topic":"MARKETPLACE_ACCOUNT_DELETION",...},
 * "notification":{"notificationId":"...","data":{"username":"test_user",
 * "userId":"...","eiasToken":"..."}}}` — matches exactly.
 */
app.get('/', async (c) => {
  const challengeCode = c.req.query('challenge_code');
  const verificationToken = c.env.EBAY_DELETION_VERIFICATION_TOKEN;
  if (!challengeCode || !verificationToken) {
    return c.json(
      { error: { code: 'BAD_REQUEST', message: 'Missing challenge_code or verification token not configured' } },
      400,
    );
  }

  const url = new URL(c.req.url);
  const endpoint = `${url.origin}${url.pathname}`;
  const hash = await sha256Hex(challengeCode + verificationToken + endpoint);
  return c.json({ challengeResponse: hash });
});

app.post('/', async (c) => {
  const payload = await c.req.json<EbayDeletionPayload>().catch(() => null);
  const username = payload?.notification?.data?.username;

  if (username) {
    const db = createDb(c.env.DB);
    const rows = await db
      .select({ taskId: manualTasks.id, payloadJson: manualTasks.payloadJson })
      .from(manualTasks)
      .innerJoin(orders, eq(manualTasks.orderId, orders.id))
      .innerJoin(storefronts, eq(orders.storefrontId, storefronts.id))
      .where(eq(storefronts.platform, 'ebay'));

    for (const row of rows) {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(row.payloadJson);
      } catch {
        continue;
      }
      if (parsed.buyerName !== username) continue;

      parsed.buyerName = '[deleted]';
      delete parsed.shipTo;
      await db
        .update(manualTasks)
        .set({ payloadJson: JSON.stringify(parsed), updatedAt: now() })
        .where(eq(manualTasks.id, row.taskId));
    }
  }

  return c.json({ ok: true });
});

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default app;
