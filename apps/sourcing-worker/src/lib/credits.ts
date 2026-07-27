import { creditAccounts, creditLedger, type Database } from '@sourcing/db';
import { and, eq, gte, sql } from 'drizzle-orm';
import { newId, now } from './id.js';

// Signup trial grant — generous enough to complete the whole loop (unlock a few
// winners, list them, and fulfill the first orders) so the user sees real profit
// land before paying. See DECISIONS / monetization memo.
export const TRIAL_CREDITS = 25;

// What each billable action costs, in credits. Discovery is cheap (the hook);
// value-realizing actions cost more. Tunable without touching call sites.
export const CREDIT_COSTS = {
  research: 1, // one deep research run
  unlock: 1, // reveal a winner's full sourcing detail
  list: 1, // publish a listing to eBay
  fulfill: 1, // auto-fulfill one order (the recurring money-maker)
} as const;

export type CreditReason = keyof typeof CREDIT_COSTS | 'trial' | 'purchase' | 'refund' | 'adjustment';

export class InsufficientCreditsError extends Error {
  constructor(
    public readonly needed: number,
    public readonly balance: number,
  ) {
    super(`Insufficient credits: need ${needed}, have ${balance}`);
    this.name = 'InsufficientCreditsError';
  }
}

async function ensureAccount(db: Database, userId: string) {
  const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId));
  if (acct) return acct;
  const ts = now();
  await db.insert(creditAccounts).values({ userId, balance: 0, createdAt: ts, updatedAt: ts }).onConflictDoNothing();
  const [created] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId));
  return created!;
}

export async function getBalance(db: Database, userId: string): Promise<number> {
  const [acct] = await db.select().from(creditAccounts).where(eq(creditAccounts.userId, userId));
  return acct?.balance ?? 0;
}

/** Grants the one-time trial credits, idempotently (no-op if already granted). */
export async function grantTrialIfNew(db: Database, userId: string): Promise<void> {
  const acct = await ensureAccount(db, userId);
  if (acct.trialGrantedAt) return;
  const ts = now();
  const balance = acct.balance + TRIAL_CREDITS;
  await db.update(creditAccounts).set({ balance, trialGrantedAt: ts, updatedAt: ts }).where(eq(creditAccounts.userId, userId));
  await db.insert(creditLedger).values({ id: newId(), userId, delta: TRIAL_CREDITS, balanceAfter: balance, reason: 'trial', refId: null, createdAt: ts });
}

/** Adds credits (purchase, refund, manual adjustment). Returns new balance. */
export async function addCredits(db: Database, userId: string, amount: number, reason: CreditReason, refId?: string): Promise<number> {
  const acct = await ensureAccount(db, userId);
  const ts = now();
  const balance = acct.balance + amount;
  await db.update(creditAccounts).set({ balance, updatedAt: ts }).where(eq(creditAccounts.userId, userId));
  await db.insert(creditLedger).values({ id: newId(), userId, delta: amount, balanceAfter: balance, reason, refId: refId ?? null, createdAt: ts });
  return balance;
}

/**
 * Spends credits for an action, refusing (throwing InsufficientCreditsError) if
 * the balance can't cover it. Single-writer per user in practice, so the
 * read-check-write is safe enough for D1 here.
 */
/**
 * Charges for a fulfilled order — idempotent per order (refId), and ALLOWS the
 * balance to go negative. Fulfillment happens post-sale (the buyer already
 * paid), so we must never block or fail it on credits; instead we accrue the
 * charge as debt the seller tops up. Returns the new balance, or null if this
 * order was already charged.
 */
export async function chargeFulfillment(db: Database, userId: string, cost: number, orderRefId: string): Promise<number | null> {
  await ensureAccount(db, userId);
  // Idempotency: skip if we've already charged this order.
  const [seen] = await db
    .select({ id: creditLedger.id })
    .from(creditLedger)
    .where(and(eq(creditLedger.userId, userId), eq(creditLedger.reason, 'fulfill'), eq(creditLedger.refId, orderRefId)))
    .limit(1);
  if (seen) return null;

  const ts = now();
  const [row] = await db
    .update(creditAccounts)
    .set({ balance: sql`${creditAccounts.balance} - ${cost}`, updatedAt: ts })
    .where(eq(creditAccounts.userId, userId))
    .returning({ balance: creditAccounts.balance });
  const balance = row?.balance ?? -cost;
  await db.insert(creditLedger).values({ id: newId(), userId, delta: -cost, balanceAfter: balance, reason: 'fulfill', refId: orderRefId, createdAt: ts });
  return balance;
}

export async function spendCredits(db: Database, userId: string, cost: number, reason: CreditReason, refId?: string): Promise<number> {
  await ensureAccount(db, userId);
  const ts = now();
  // ATOMIC: decrement only if the balance still covers it (guards against
  // concurrent double-spend — a plain read-then-write could oversell). The
  // conditional UPDATE ... RETURNING is a single SQLite statement.
  const [row] = await db
    .update(creditAccounts)
    .set({ balance: sql`${creditAccounts.balance} - ${cost}`, updatedAt: ts })
    .where(and(eq(creditAccounts.userId, userId), gte(creditAccounts.balance, cost)))
    .returning({ balance: creditAccounts.balance });
  if (!row) throw new InsufficientCreditsError(cost, await getBalance(db, userId));
  await db.insert(creditLedger).values({ id: newId(), userId, delta: -cost, balanceAfter: row.balance, reason, refId: refId ?? null, createdAt: ts });
  return row.balance;
}
