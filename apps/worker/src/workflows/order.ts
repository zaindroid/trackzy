import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from 'cloudflare:workers';
import type { Env } from '../env.js';
import type { WorkflowOrderPayload } from './types.js';
import { runOrderWorkflow } from './orderLogic.js';

/** Durable order lifecycle orchestration — see spec section 7. Logic lives in orderLogic.ts so it's unit-testable. */
export class OrderWorkflow extends WorkflowEntrypoint<Env, WorkflowOrderPayload> {
  async run(event: WorkflowEvent<WorkflowOrderPayload>, step: WorkflowStep) {
    await runOrderWorkflow({ step, env: this.env, orderId: event.payload.orderId });
  }
}
