import type { Context, Next } from 'hono';
import { createSessionVerifier, fetchClerkUserEmail } from '@fulfillment-tracker/adapters/clerk';
import { isMockMode } from '@fulfillment-tracker/adapters/mockMode';
import { createDb, users, type Database } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env.js';
import { errorResponse } from '../lib/errors.js';
import { newId, now } from '../lib/id.js';

export type AuthedVariables = { userId: string };
export type AuthedContext = Context<{ Bindings: Env; Variables: AuthedVariables }>;

/**
 * Verifies the Clerk session and resolves it to our internal `users.id`,
 * stashed on the request context. A real (non-mock) session that verifies
 * cryptographically but has no matching `users` row yet is auto-provisioned
 * here rather than rejected — this is what makes "customer signs up via
 * Clerk, then immediately uses the dashboard" work end-to-end with no
 * separate onboarding endpoint or webhook to keep in sync (see
 * DECISIONS.md). Gated on !isMockMode deliberately: in mock mode *any*
 * bearer string verifies as "valid" by design, so auto-provisioning there
 * would silently create a user for literally any typo'd token instead of
 * rejecting it — a meaningfully different, and still-tested, failure mode.
 */
export async function authMiddleware(c: AuthedContext, next: Next) {
  const verifier = createSessionVerifier(c.env);
  const session = await verifier.verifySession(c.req.raw);
  if (!session) {
    return errorResponse(c, 'UNAUTHORIZED', 'Missing or invalid session', 401);
  }

  const db = createDb(c.env.DB);
  let [user] = await db.select().from(users).where(eq(users.clerkUserId, session.clerkUserId)).limit(1);

  if (!user && !isMockMode(c.env.MOCK_MODE, c.env.CLERK_SECRET_KEY)) {
    user = await provisionUser(db, c.env, session.clerkUserId);
  }

  if (!user) {
    return errorResponse(c, 'UNAUTHORIZED', 'No account exists for this session', 401);
  }

  c.set('userId', user.id);
  await next();
}

export async function provisionUser(db: Database, env: Env, clerkUserId: string): Promise<typeof users.$inferSelect> {
  const email = (await fetchClerkUserEmail(env, clerkUserId)) ?? `${clerkUserId}@unknown.clerk.user`;
  try {
    const id = newId();
    await db.insert(users).values({ id, clerkUserId, email, createdAt: now() });
    const [created] = await db.select().from(users).where(eq(users.id, id));
    return created!;
  } catch {
    // Lost a race with a concurrent request provisioning the same brand-new
    // user (the dashboard fires several parallel API calls on first load) —
    // `users.clerk_user_id` is unique, so the loser here just re-reads what
    // the winner already inserted instead of erroring.
    const [existing] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
    if (!existing) throw new Error(`Failed to provision or find user for Clerk id ${clerkUserId}`);
    return existing;
  }
}
