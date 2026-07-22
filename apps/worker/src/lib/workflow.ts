/**
 * Fetches a running Workflow instance, tolerating both "no such instance"
 * (thrown by the binding) and a wholly absent binding (the case in the
 * vitest-pool-workers test environment — see wrangler.test.toml).
 */
export async function safeGetWorkflowInstance<T>(
  workflow: Workflow<T> | undefined,
  id: string,
): Promise<WorkflowInstance | null> {
  if (!workflow) return null;
  try {
    return await workflow.get(id);
  } catch {
    return null;
  }
}
