import { describe, expect, it, beforeEach } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb, creditAccounts, creditLedger, users } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import { TRIAL_CREDITS, InsufficientCreditsError, addCredits, getBalance, grantTrialIfNew, spendCredits } from './credits.js';

const UID = 'usr_credit';

beforeEach(async () => {
  const db = createDb(env.SOURCING_DB);
  await db.delete(creditLedger);
  await db.delete(creditAccounts);
  await db.insert(users).values({ id: UID, clerkUserId: 'clerk_credit', email: 'c@test.dev', createdAt: 0 }).onConflictDoNothing();
});

describe('credits', () => {
  it('grants the trial once (idempotent)', async () => {
    const db = createDb(env.SOURCING_DB);
    await grantTrialIfNew(db, UID);
    await grantTrialIfNew(db, UID); // second call is a no-op
    expect(await getBalance(db, UID)).toBe(TRIAL_CREDITS);
    const ledger = await db.select().from(creditLedger).where(eq(creditLedger.userId, UID));
    expect(ledger.filter((l) => l.reason === 'trial')).toHaveLength(1);
  });

  it('spends credits and records the ledger with running balance', async () => {
    const db = createDb(env.SOURCING_DB);
    await grantTrialIfNew(db, UID);
    const after = await spendCredits(db, UID, 5, 'research');
    expect(after).toBe(TRIAL_CREDITS - 5);
    expect(await getBalance(db, UID)).toBe(TRIAL_CREDITS - 5);
  });

  it('refuses to spend beyond the balance', async () => {
    const db = createDb(env.SOURCING_DB);
    await grantTrialIfNew(db, UID);
    await expect(spendCredits(db, UID, TRIAL_CREDITS + 1, 'list')).rejects.toBeInstanceOf(InsufficientCreditsError);
    expect(await getBalance(db, UID)).toBe(TRIAL_CREDITS); // unchanged
  });

  it('adds credits (purchase/refund)', async () => {
    const db = createDb(env.SOURCING_DB);
    await grantTrialIfNew(db, UID);
    const after = await addCredits(db, UID, 100, 'purchase', 'order_1');
    expect(after).toBe(TRIAL_CREDITS + 100);
  });
});
