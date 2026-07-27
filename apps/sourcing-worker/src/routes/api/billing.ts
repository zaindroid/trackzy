import { Hono } from 'hono';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import { createDb, creditAccounts, users } from '@sourcing/db';
import { createLemonSqueezyClient } from '@fulfillment-tracker/adapters/lemonSqueezy';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';
import { errorResponse } from '../../lib/errors.js';
import { OFFERINGS, billingConfigured, findOffering } from '../../lib/billing.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

/** Lists what can be bought + whether billing is live yet. */
app.get('/offerings', async (c) => {
  return c.json({
    configured: billingConfigured(c.env),
    offerings: OFFERINGS.map((o) => ({ id: o.id, label: o.label, price: o.price, kind: o.kind, credits: o.credits, plan: o.plan })),
  });
});

const checkoutSchema = z.object({ offeringId: z.string().min(1) });

/** Creates a Lemon Squeezy hosted checkout for the chosen offering and returns
 * its URL. Credit/plan granting happens later via the LS webhook, driven by the
 * `custom` data we attach here. */
app.post('/checkout', async (c) => {
  const parsed = checkoutSchema.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) return errorResponse(c, 'VALIDATION_ERROR', parsed.error.message, 400);

  const offering = findOffering(parsed.data.offeringId);
  if (!offering) return errorResponse(c, 'NOT_FOUND', 'Unknown offering', 404);
  if (!billingConfigured(c.env)) return errorResponse(c, 'BILLING_NOT_CONFIGURED', 'Checkout is not available yet.', 503);

  const variantId = c.env[offering.variantEnv] as string | undefined;
  if (!variantId) return errorResponse(c, 'BILLING_NOT_CONFIGURED', 'This item is not purchasable yet.', 503);

  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const [user] = await db.select().from(users).where(eq(users.id, userId));

  // custom data is echoed back verbatim in the webhook — our grant source of truth.
  const custom: Record<string, string> = { user_id: userId, offering_id: offering.id, kind: offering.kind };
  if (offering.kind === 'credits' && offering.credits) custom.credits = String(offering.credits);
  if (offering.kind === 'subscription' && offering.plan) custom.plan = offering.plan;

  try {
    const { url } = await createLemonSqueezyClient(c.env).createCheckout({
      variantId,
      email: user?.email ?? 'unknown@zearch.app',
      custom,
      redirectUrl: c.req.header('Origin') ? `${c.req.header('Origin')}/billing` : undefined,
    });
    return c.json({ url });
  } catch (err) {
    return errorResponse(c, 'CHECKOUT_FAILED', err instanceof Error ? err.message : 'Could not start checkout', 502);
  }
});

/** Subscription status for the dashboard. */
app.get('/subscription', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, c.get('userId')));
  return c.json({
    plan: acct?.plan ?? null,
    status: acct?.subscriptionStatus ?? null,
    renewsAt: acct?.subscriptionRenewsAt ?? null,
  });
});

export default app;
