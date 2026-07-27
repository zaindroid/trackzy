import { Hono } from 'hono';
import { desc, eq } from 'drizzle-orm';
import { createDb, creditAccounts, creditLedger } from '@sourcing/db';
import { CREDIT_COSTS } from '../../lib/credits.js';
import type { Env } from '../../env.js';
import type { AuthedVariables } from '../../middleware/auth.js';

const app = new Hono<{ Bindings: Env; Variables: AuthedVariables }>();

/** The user's credit balance + recent history, for the dashboard. */
app.get('/', async (c) => {
  const db = createDb(c.env.SOURCING_DB);
  const userId = c.get('userId');
  const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId));
  const ledger = await db
    .select()
    .from(creditLedger)
    .where(eq(creditLedger.userId, userId))
    .orderBy(desc(creditLedger.createdAt))
    .limit(50);
  return c.json({
    balance: acct?.balance ?? 0,
    costs: CREDIT_COSTS,
    ledger: ledger.map((l) => ({ id: l.id, delta: l.delta, balanceAfter: l.balanceAfter, reason: l.reason, createdAt: l.createdAt })),
  });
});

export default app;
