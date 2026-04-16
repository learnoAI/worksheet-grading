/**
 * Grading job lifecycle helpers.
 *
 * Prisma-injected port of `backend/src/services/gradingJobLifecycleService.ts`.
 * Every function performs a single `updateMany` that is *conditional on the
 * lease id* — meaning only the worker currently holding the lease can
 * transition the job. Returns a boolean so callers can surface
 * `lease mismatch` errors to the caller (usually the grading CF Worker).
 *
 * `crypto.randomUUID()` is available in both Node 15.7+ and Cloudflare
 * Workers, so this stays identical to the Express version byte-for-byte
 * aside from the prisma parameter.
 */

import { GradingJobStatus, type PrismaClient } from '@prisma/client';

/**
 * Move a PROCESSING → QUEUED so the queue consumer can retry. `leaseId`
 * guard prevents a stale retry from overwriting a job that has since been
 * picked up by a different worker.
 *
 * We deliberately do NOT clear `enqueuedAt` — the message is still in
 * Cloudflare Queues and will be retried from there. Clearing it would
 * cause the dispatch loop to republish a duplicate.
 */
export async function requeueGradingJobForRetry(
  prisma: PrismaClient,
  jobId: string,
  leaseId: string,
  reason?: string
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.gradingJob.updateMany({
    where: {
      id: jobId,
      status: GradingJobStatus.PROCESSING,
      leaseId,
    },
    data: {
      status: GradingJobStatus.QUEUED,
      dispatchError: reason || null,
      leaseId: null,
      startedAt: null,
      lastHeartbeatAt: null,
      completedAt: null,
      lastErrorAt: now,
      errorMessage: null,
    },
  });
  return result.count > 0;
}

/**
 * Atomic QUEUED → PROCESSING transition that stamps a new leaseId and
 * increments `attemptCount`. Returns the new leaseId on success, `null`
 * when the job was not in QUEUED (e.g. already being processed by another
 * worker or in a terminal state).
 */
export async function acquireGradingJobLease(
  prisma: PrismaClient,
  jobId: string
): Promise<string | null> {
  const leaseId = crypto.randomUUID();
  const now = new Date();
  const result = await prisma.gradingJob.updateMany({
    where: {
      id: jobId,
      status: GradingJobStatus.QUEUED,
    },
    data: {
      status: GradingJobStatus.PROCESSING,
      leaseId,
      startedAt: now,
      lastHeartbeatAt: now,
      lastErrorAt: null,
      errorMessage: null,
      dispatchError: null,
      completedAt: null,
      attemptCount: { increment: 1 },
    },
  });
  return result.count > 0 ? leaseId : null;
}

/**
 * Update `lastHeartbeatAt` while holding the given lease. Lets the
 * grading worker signal "I'm still making progress" for long-running jobs.
 * Returns `false` when the lease no longer matches (caller must treat
 * this as lost ownership).
 */
export async function touchGradingJobHeartbeat(
  prisma: PrismaClient,
  jobId: string,
  leaseId: string
): Promise<boolean> {
  const result = await prisma.gradingJob.updateMany({
    where: {
      id: jobId,
      status: GradingJobStatus.PROCESSING,
      leaseId,
    },
    data: { lastHeartbeatAt: new Date() },
  });
  return result.count > 0;
}

/**
 * PROCESSING → COMPLETED. Clears the leaseId and records the associated
 * worksheet. Conditional on lease match so a stale complete from a worker
 * that already lost its lease does not poison the row.
 */
export async function markGradingJobCompleted(
  prisma: PrismaClient,
  jobId: string,
  leaseId: string,
  worksheetId: string
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.gradingJob.updateMany({
    where: {
      id: jobId,
      status: GradingJobStatus.PROCESSING,
      leaseId,
    },
    data: {
      status: GradingJobStatus.COMPLETED,
      worksheetId,
      completedAt: now,
      lastHeartbeatAt: now,
      leaseId: null,
      errorMessage: null,
      dispatchError: null,
    },
  });
  return result.count > 0;
}

/**
 * PROCESSING → FAILED. Also lease-conditional.
 */
export async function markGradingJobFailed(
  prisma: PrismaClient,
  jobId: string,
  leaseId: string,
  errorMessage: string
): Promise<boolean> {
  const now = new Date();
  const result = await prisma.gradingJob.updateMany({
    where: {
      id: jobId,
      status: GradingJobStatus.PROCESSING,
      leaseId,
    },
    data: {
      status: GradingJobStatus.FAILED,
      errorMessage,
      lastErrorAt: now,
      completedAt: now,
      lastHeartbeatAt: now,
      leaseId: null,
    },
  });
  return result.count > 0;
}
