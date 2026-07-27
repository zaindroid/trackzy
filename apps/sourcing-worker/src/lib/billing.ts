import { creditAccounts, type Database } from '@sourcing/db';
import { eq } from 'drizzle-orm';
import type { Env } from '../env.js';
import { now } from './id.js';

/** Purchasable offerings. `variantEnv` names the env var holding the LS variant
 * id (filled once products exist in the LS dashboard). Credit packs grant a
 * fixed number of credits; the subscription sets a plan. */
// Only the string-valued env keys (the LS variant ids) are valid here.
type StringEnvKey = { [K in keyof Env]-?: Env[K] extends string | undefined ? K : never }[keyof Env];

export interface Offering {
  id: string;
  label: string;
  price: string;
  variantEnv: StringEnvKey;
  kind: 'credits' | 'subscription';
  credits?: number;
  plan?: string;
}

export const OFFERINGS: Offering[] = [
  { id: 'credits_50', label: '50 credits', price: '$9', variantEnv: 'LS_VARIANT_CREDITS_50', kind: 'credits', credits: 50 },
  { id: 'credits_200', label: '200 credits', price: '$29', variantEnv: 'LS_VARIANT_CREDITS_200', kind: 'credits', credits: 200 },
  { id: 'credits_600', label: '600 credits', price: '$69', variantEnv: 'LS_VARIANT_CREDITS_600', kind: 'credits', credits: 600 },
  { id: 'sub_pro', label: 'Pro subscription', price: '$29/mo', variantEnv: 'LS_VARIANT_SUB_PRO', kind: 'subscription', plan: 'pro' },
];

export function findOffering(id: string): Offering | undefined {
  return OFFERINGS.find((o) => o.id === id);
}

/** True once LS is configured enough to sell (API key + store + at least one variant). */
export function billingConfigured(env: Env): boolean {
  return Boolean(env.LEMONSQUEEZY_API_KEY && env.LEMONSQUEEZY_STORE_ID);
}

/** Applies a Lemon Squeezy subscription state change to the user's account. */
export async function setSubscription(
  db: Database,
  userId: string,
  fields: { plan: string | null; status: string | null; subscriptionId: string | null; renewsAt: number | null },
): Promise<void> {
  await db
    .update(creditAccounts)
    .set({
      plan: fields.plan,
      subscriptionStatus: fields.status,
      subscriptionId: fields.subscriptionId,
      subscriptionRenewsAt: fields.renewsAt,
      updatedAt: now(),
    })
    .where(eq(creditAccounts.userId, userId));
}
