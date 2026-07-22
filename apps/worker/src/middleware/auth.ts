import type { Context, Next } from 'hono';
import { createSessionVerifier } from '@fulfillment-tracker/adapters/clerk';
import { createDb, users } from '@fulfillment-tracker/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env.js';
import { errorResponse } from '../lib/errors.js';

export type AuthedVariables = { userId: string };
export type AuthedContext = Context<{ Bindings: Env; Variables: AuthedVariables }>;

/** Verifies the Clerk session and resolves it to our internal `users.id`, stashed on the request context. */
export async function authMiddleware(c: AuthedContext, next: Next) {
  const verifier = createSessionVerifier(c.env);
  const session = await verifier.verifySession(c.req.raw);
  if (!session) {
    return errorResponse(c, 'UNAUTHORIZED', 'Missing or invalid session', 401);
  }

  const db = createDb(c.env.DB);
  const [user] = await db.select().from(users).where(eq(users.clerkUserId, session.clerkUserId)).limit(1);
  if (!user) {
    return errorResponse(c, 'UNAUTHORIZED', 'No account exists for this session', 401);
  }

  c.set('userId', user.id);
  await next();
}
