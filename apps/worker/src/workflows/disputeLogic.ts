import type { WorkflowStep } from 'cloudflare:workers';
import { eq } from 'drizzle-orm';
import { createDb, disputes, fulfillments, orders, type Database } from '@fulfillment-tracker/db';
import { createGeminiExtractor } from '@fulfillment-tracker/adapters/gemini';
import type { Env } from '../env.js';
import { newId, now } from '../lib/id.js';
import type { WorkflowDisputePayload } from './types.js';

export interface DisputeWorkflowParams {
  step: WorkflowStep;
  env: Env;
  payload: WorkflowDisputePayload;
}

/**
 * Drafts a dispute email via Gemini and persists it as a `disputes` row for
 * human review in the dashboard (spec section 7 step 7 / section 8). This is
 * one of exactly two call sites for the LLM anywhere in this codebase.
 */
export async function runDisputeWorkflow({ step, env, payload }: DisputeWorkflowParams): Promise<void> {
  await step.do('draft-dispute', async () => draftDisputeStep(createDb(env.DB), env, payload));
}

export async function draftDisputeStep(db: Database, env: Env, payload: WorkflowDisputePayload): Promise<void> {
  const [fulfillment] = await db.select().from(fulfillments).where(eq(fulfillments.id, payload.fulfillmentId));
  if (!fulfillment) throw new Error(`Fulfillment ${payload.fulfillmentId} not found`);
  const [order] = await db.select().from(orders).where(eq(orders.id, fulfillment.orderId));

  const gemini = createGeminiExtractor(env);
  const draft = await gemini.draftDispute({
    reason: payload.reason,
    trackingNumber: fulfillment.trackingNumber ?? '(no tracking number on file)',
    carrier: fulfillment.carrierFinal,
    orderNumber: order?.externalOrderNumber,
  });

  await db.insert(disputes).values({
    id: newId(),
    fulfillmentId: payload.fulfillmentId,
    reason: payload.reason,
    draftSubject: draft.subject,
    draftBody: draft.body,
    status: 'draft',
    createdAt: now(),
    updatedAt: now(),
  });
}
