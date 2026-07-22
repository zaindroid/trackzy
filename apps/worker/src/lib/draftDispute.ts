import type { Env } from '../env.js';
import { now } from './id.js';

/**
 * Starts a DisputeWorkflow instance best-effort. Shared by orderLogic.ts
 * (Phase 1's 7-day-no-tracking / delivery-exception triggers) and
 * webhooks.tracking.ts (Phase 2's stuck/lost carrier-exception trigger) —
 * both need exactly "start a dispute draft for this fulfillment and don't
 * fail the caller if the binding is absent or the instance id collides."
 */
export async function draftDispute(env: Env, fulfillmentId: string, reason: string): Promise<void> {
  try {
    await env.DISPUTE_WORKFLOW?.create({
      id: `dispute-${fulfillmentId}-${now()}`,
      params: { fulfillmentId, reason },
    });
  } catch {
    // Binding absent (test environment) or instance id collision — dispute
    // drafting is best-effort from here; DisputeWorkflow itself is unit
    // tested directly against the DB.
  }
}
