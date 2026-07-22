import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../env.js';
import type { WorkflowDisputePayload } from './types.js';
import { runDisputeWorkflow } from './disputeLogic.js';

/** Drafts a carrier-dispute email via Gemini — see spec section 7 step 7. */
export class DisputeWorkflow extends WorkflowEntrypoint<Env, WorkflowDisputePayload> {
  async run(event: WorkflowEvent<WorkflowDisputePayload>, step: WorkflowStep) {
    await runDisputeWorkflow({ step, env: this.env, payload: event.payload });
  }
}
