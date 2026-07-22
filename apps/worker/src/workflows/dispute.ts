import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../env.js';
import type { WorkflowDisputePayload } from './types.js';

// TODO(MILESTONE 6): draft the dispute email via Gemini and persist it, see
// spec section 7 step 7. Placeholder keeps the Worker deployable while that lands.
export class DisputeWorkflow extends WorkflowEntrypoint<Env, WorkflowDisputePayload> {
  async run(event: WorkflowEvent<WorkflowDisputePayload>, step: WorkflowStep) {
    await step.do('noop', async () => {
      return { fulfillmentId: event.payload.fulfillmentId };
    });
  }
}
