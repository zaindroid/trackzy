import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../env.js';
import type { WorkflowOrderPayload } from './types.js';

// TODO(MILESTONE 6): full order lifecycle (margin -> fulfillment order lookup
// -> place supplier order -> await tracking -> push fulfillment -> await
// delivery), see spec section 7. Placeholder keeps the Worker deployable and
// the Queue consumer/webhook routes type-correct while that lands.
export class OrderWorkflow extends WorkflowEntrypoint<Env, WorkflowOrderPayload> {
  async run(event: WorkflowEvent<WorkflowOrderPayload>, step: WorkflowStep) {
    await step.do('noop', async () => {
      return { orderId: event.payload.orderId };
    });
  }
}
