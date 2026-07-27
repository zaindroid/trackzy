import { externalAccountLinks, type Database } from '@sourcing/db';
import { and, eq } from 'drizzle-orm';
import { isMockMode } from '@fulfillment-tracker/adapters/mockMode';
import type { Env } from '../env.js';
import { newId, now } from './id.js';

export type BindProvider = 'ebay' | 'aliexpress' | 'cj';

export class AccountAlreadyLinkedError extends Error {
  constructor(public readonly provider: BindProvider) {
    super(`This ${provider} account is already linked to another Zearch account.`);
    this.name = 'AccountAlreadyLinkedError';
  }
}

/**
 * Enforces "one external account = one platform account, forever" (anti-abuse
 * so trial credits can't be farmed by cycling dummy signups). Call at connect
 * time with the external account's IMMUTABLE id (eBay userId, AliExpress
 * account/havana_id, CJ account). If it's already bound to a DIFFERENT user →
 * throws. If bound to the same user → no-op. The link PERSISTS after disconnect,
 * so it can't be recycled. Skipped in mock/sandbox mode so internal testing
 * (everyone shares one sandbox account) isn't blocked.
 */
export async function bindExternalAccount(env: Env, db: Database, userId: string, provider: BindProvider, externalId: string | null | undefined): Promise<void> {
  if (!externalId) return; // nothing to bind (identity capture failed) — don't block the connect
  if (isMockMode(env.MOCK_MODE, env.CLERK_SECRET_KEY)) return;
  // Skip while a provider is pointed at its SANDBOX — during testing everyone
  // shares one sandbox account, so enforcing the one-account rule would wrongly
  // block. Activates automatically once real production credentials are in use.
  if (provider === 'ebay' && (env.EBAY_API_BASE_URL ?? '').includes('sandbox')) return;

  const [existing] = await db
    .select()
    .from(externalAccountLinks)
    .where(and(eq(externalAccountLinks.provider, provider), eq(externalAccountLinks.externalId, externalId)));

  if (existing) {
    if (existing.userId !== userId) throw new AccountAlreadyLinkedError(provider);
    return; // already bound to this same user
  }
  await db
    .insert(externalAccountLinks)
    .values({ id: newId(), provider, externalId, userId, firstLinkedAt: now() })
    .onConflictDoNothing();
}
