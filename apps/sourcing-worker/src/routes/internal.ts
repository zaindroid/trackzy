import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb, users } from '@sourcing/db';
import type { Env } from '../env.js';
import { CREDIT_COSTS, chargeFulfillment } from '../lib/credits.js';

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

export default app;
