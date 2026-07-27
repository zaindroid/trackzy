import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb, users } from '@sourcing/db';
import type { Env } from '../env.js';
import { CREDIT_COSTS, chargeFulfillment } from '../lib/credits.js';
import { monitorDue } from '../lib/priceMonitor.js';

const app = new Hono<{ Bindings: Env }>();

function tokenOk(header: string | undefined, expected: string | undefined): boolean {
  if (!expected) return false;
  const provided = header?.replace(/^Bearer\s+/i, '') ?? '';
  if (provided.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}

const chargeSchema = z.object({ clerkUserId: z.string().min(1), orderId: z.string().min(1) });

/**
 * Service-to-service endpoint the trackzy worker calls when it auto-fulfills an
 * order, to meter a fulfillment credit against the platform balance (which lives
 * in this DB). Guarded by the shared INTERNAL_SERVICE_TOKEN (not Clerk). The
 * charge is idempotent per order and allows a negative balance — fulfillment is
 * post-sale, so it must never be blocked; the seller tops up any debt.
 */
app.post('/fulfillment-charge', async (c) => {
  if (!tokenOk(c.req.header('Authorization'), c.env.INTERNAL_SERVICE_TOKEN)) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid service token' } }, 401);
  }
  const parsed = chargeSchema.safeParse(await c.req.json().catch(() => null));
  if (!parsed.success) return c.json({ error: { code: 'VALIDATION_ERROR', message: parsed.error.message } }, 400);

  const db = createDb(c.env.SOURCING_DB);
  // Same Clerk id maps this trackzy user to their platform (sourcing) account.
  const [user] = await db.select().from(users).where(eq(users.clerkUserId, parsed.data.clerkUserId));
  if (!user) return c.json({ ok: true, charged: false, reason: 'no platform account' });

  const balance = await chargeFulfillment(db, user.id, CREDIT_COSTS.fulfill, parsed.data.orderId);
  return c.json({ ok: true, charged: balance !== null, balance });
});

/**
 * Service-to-service endpoint that sweeps DUE monitored listings (re-fetch
 * supplier cost/stock, smart-reprice, and on a stock-out pause + propose a
 * replacement supplier for one-click approval — never auto-switching). No
 * Cloudflare cron trigger exists for this worker (account is at the 5-cron
 * limit — see wrangler.sourcing.toml), so trackzy pings this on one of its own
 * existing cron ticks (apps/worker/src/scheduled.ts). `monitorDue` only
 * processes listings whose recheck interval has actually elapsed, so being
 * called every ~10 minutes is cheap and self-pacing — most calls are a no-op.
 */
app.post('/monitor-sweep', async (c) => {
  if (!tokenOk(c.req.header('Authorization'), c.env.INTERNAL_SERVICE_TOKEN)) {
    return c.json({ error: { code: 'UNAUTHORIZED', message: 'Invalid service token' } }, 401);
  }
  const db = createDb(c.env.SOURCING_DB);
  const result = await monitorDue(c.env, db);
  return c.json({ ok: true, ...result });
});

export default app;
