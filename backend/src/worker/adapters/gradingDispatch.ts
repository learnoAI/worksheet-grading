/**
 * Grading workflow dispatch adapter.
 *
 * Replaces the previous `publishToQueue(env, 'CF_QUEUE_ID', ...)` path.
 * Backend dispatch sites call `dispatchGradingWorkflow(env, jobId, ...)`
 * to create one Cloudflare Workflow instance per grading job. The
 * workflow class lives in the grading-consumer worker (cross-script
 * binding); see `cloudflare/grading-consumer/src/gradingWorkflow.ts`.
 *
 * Idempotency: the workflow instance id IS the grading job id. A
 * duplicate `create()` (e.g. /finalize retried by the client, or a
 * worker retry past a partial DB write) collides on instance id. The CF
 * runtime throws an "instance already exists" error in that case, which
 * this adapter swallows — the existing instance keeps running and the
 * caller treats dispatch as successful.
 */

import type { GradingWorkflowBinding, WorkerEnv } from '../types';

export class GradingWorkflowDispatchError extends Error {
  constructor(message: string, readonly cause?: unknown) {
    super(message);
    this.name = 'GradingWorkflowDispatchError';
  }
}

function isInstanceAlreadyExistsError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const msg = error.message.toLowerCase();
  return (
    msg.includes('already exists') ||
    msg.includes('duplicate') ||
    msg.includes('instance with the id') ||
    // CF Workflows surfaces this as a typed code on the thrown Error.
    (error as Error & { code?: string }).code === 'instance_already_exists'
  );
}

export async function dispatchGradingWorkflow(
  env: WorkerEnv,
  jobId: string,
  enqueuedAt: string
): Promise<{ instanceId: string; existed: boolean }> {
  const binding = env.GRADING_WORKFLOW as GradingWorkflowBinding | undefined;
  if (!binding || typeof binding.create !== 'function') {
    throw new GradingWorkflowDispatchError(
      'GRADING_WORKFLOW binding is not configured. Add the [[workflows]] block to wrangler.toml.'
    );
  }

  try {
    const instance = await binding.create({
      id: jobId,
      params: { jobId, enqueuedAt },
    });
    return { instanceId: instance.id, existed: false };
  } catch (error) {
    if (isInstanceAlreadyExistsError(error)) {
      // Another caller (or this caller's earlier attempt) already created
      // the workflow for this job. Treat as success — the existing
      // instance keeps executing.
      return { instanceId: jobId, existed: true };
    }
    throw new GradingWorkflowDispatchError(
      `Failed to create grading workflow for job ${jobId}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      error
    );
  }
}
