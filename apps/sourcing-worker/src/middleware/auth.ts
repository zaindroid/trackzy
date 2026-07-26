import type { Context, Next } from 'hono';
import { createSessionVerifier, fetchClerkUserEmail } from '@fulfillment-tracker/adapters/clerk';
import { isMockMode } from '@fulfillment-tracker/adapters/mockMode';
import { createDb, users, type Database } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env.js';
import { errorResponse } from '../lib/errors.js';
import { newId, now } from '../lib/id.js';

export type AuthedVariables = { userId: string };
export type AuthedContext = Context<{ Bindings: Env; Variables: AuthedVariables }>;

/**
 * Same Clerk verify → resolve-or-provision-user flow as trackzy's
 * authMiddleware (see that file's docstring), pointed at the sourcing DB.
 * Because both products share one Clerk application, a given customer's
 * `clerkUserId` is identical across both — but each provisions its own local
 * `users` row in its own database the first time it sees that customer.
 */
export async function authMiddleware(c: AuthedContext, next: Next) {
  const verifier = createSessionVerifier(c.env);
  const session = await verifier.verifySession(c.req.raw);
  if (!session) {
    return errorResponse(c, 'UNAUTHORIZED', 'Missing or invalid session', 401);
  }

  const db = createDb(c.env.SOURCING_DB);
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
    const [existing] = await db.select().from(users).where(eq(users.clerkUserId, clerkUserId)).limit(1);
    if (!existing) throw new Error(`Failed to provision or find user for Clerk id ${clerkUserId}`);
    return existing;
  }
}
