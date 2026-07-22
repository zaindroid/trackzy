import type { Env } from './env.js';

/**
 * Starts one OrderWorkflow instance per order. The instance id is the order
 * id itself, so a duplicate webhook delivery (which would enqueue the same
 * orderId twice) can never spawn two workflow instances for the same order —
 * `create()` with a pre-existing id is a no-op error we simply swallow.
 */
export async function handleQueue(
  batch: MessageBatch<{ orderId: string }>,
  env: Env,
): Promise<void> {
  for (const message of batch.messages) {
    if (!env.ORDER_WORKFLOW) {
      message.ack();
      continue;
    }
    try {
      await env.ORDER_WORKFLOW.create({ id: message.body.orderId, params: { orderId: message.body.orderId } });
    } catch (err) {
      if (!isAlreadyExistsError(err)) {
        message.retry();
        continue;
      }
    }
    message.ack();
  }
}

function isAlreadyExistsError(err: unknown): boolean {
  return err instanceof Error && /already exists|duplicate/i.test(err.message);
}
