/**
 * Grading dispatch loop — the Cron-triggered tick that keeps the grading
 * queue moving. Port of `backend/src/workers/gradingDispatchLoop.ts`.
 *
 * Two responsibilities per tick:
 *
 *   1. **Requeue stale PROCESSING jobs.** If a grading-worker isolate
 *      crashed mid-job, the job sits in PROCESSING with a stale
 *      `lastHeartbeatAt`. We reclaim it by moving back to QUEUED with
 *      all lease fields cleared — the next tick will republish it to
 *      the CF Queue. Matches the Express logic exactly.
 *
 *   2. **Publish QUEUED → CF Queues.** Scan for QUEUED jobs that have
 *      no `enqueuedAt` stamp and push them onto the queue. Respects
 *      exponential-backoff retry for jobs that previously failed to
 *      dispatch. Increments `attemptCount` on failure; clears
 *      `dispatchError` on success.
 *
 * The Cron Worker fires every minute. Express polled every 5 s — the
 * extra latency is acceptable because grading itself takes 10s+ per page
 * (the queue consumer immediately picks up messages anyway; this loop
 * only exists to recover from rare dispatch failures).
 *
 * Failure mode to avoid at all costs: a silently dead dispatch loop
 * stalls every grading job in the system. Every crash emits a
 * `dispatch_loop_crashed` PostHog event so the first failure is
 * alertable, not buried in logs.
 */

import { GradingJobStatus, type PrismaClient } from '@prisma/client';
import { publishToQueue, QueueError } from './adapters/queues';
import {
  capturePosthogEvent,
  capturePosthogException,
} from './adapters/posthog';
import type { WorkerEnv } from './types';

const DEFAULT_STALE_PROCESSING_MS = 20 * 60 * 1000; // 20 min
const DEFAULT_QUEUE_POLL_BATCH_SIZE = 25;
const DEFAULT_DISPATCH_ORPHAN_MS = 30 * 60 * 1000; // 30 min

function parsePositiveInt(value: unknown, fallback: number): number {
  const raw = typeof value === 'string' ? Number.parseInt(value, 10) : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : fallback;
}

function staleProcessingMs(env: WorkerEnv): number {
  return parsePositiveInt(
    (env as { GRADING_STALE_PROCESSING_MS?: string }).GRADING_STALE_PROCESSING_MS,
    DEFAULT_STALE_PROCESSING_MS
  );
}

function queuePollBatchSize(env: WorkerEnv): number {
  return parsePositiveInt(
    (env as { GRADING_QUEUE_POLL_BATCH_SIZE?: string }).GRADING_QUEUE_POLL_BATCH_SIZE,
    DEFAULT_QUEUE_POLL_BATCH_SIZE
  );
}

function dispatchOrphanMs(env: WorkerEnv): number {
  return parsePositiveInt(
    (env as { GRADING_DISPATCH_ORPHAN_MS?: string }).GRADING_DISPATCH_ORPHAN_MS,
    DEFAULT_DISPATCH_ORPHAN_MS
  );
}

/**
 * Exponential backoff with base 2s, doubling per attempt, capped at
 * attempt=6 (≈128s max wait). Prevents a handful of persistent failures
 * from hammering the CF Queues API every tick.
 */
export function computeDispatchBackoffMs(attemptCount: number): number {
  const base = 2000;
  const cappedAttempt = Math.min(Math.max(attemptCount, 0), 6);
  return base * Math.pow(2, cappedAttempt);
}

export function shouldRetryDispatch(
  lastErrorAt: Date | null,
  attemptCount: number
): boolean {
  if (!lastErrorAt) return true;
  const waitMs = computeDispatchBackoffMs(attemptCount);
  return Date.now() - lastErrorAt.getTime() >= waitMs;
}

export interface DispatchResult {
  staleRequeued: number;
  orphanRequeued: number;
  attempted: number;
  dispatched: number;
  failed: number;
  skippedByBackoff: number;
}

/**
 * Run a single dispatch tick. Returns a summary for telemetry. Errors
 * inside the tick are caught per-job; a thrown error at this level means
 * something structural broke (e.g. Prisma is down) and the caller should
 * emit a `dispatch_loop_crashed` event.
 */
export async function dispatchPendingJobs(
  prisma: PrismaClient,
  env: WorkerEnv
): Promise<DispatchResult> {
  const result: DispatchResult = {
    staleRequeued: 0,
    orphanRequeued: 0,
    attempted: 0,
    dispatched: 0,
    failed: 0,
    skippedByBackoff: 0,
  };

  // 1. Reclaim stale PROCESSING jobs
  const staleMs = staleProcessingMs(env);
  const staleCutoff = new Date(Date.now() - staleMs);
  const staleRequeued = await prisma.gradingJob.updateMany({
    where: {
      status: GradingJobStatus.PROCESSING,
      OR: [
        { lastHeartbeatAt: { lt: staleCutoff } },
        { lastHeartbeatAt: null, startedAt: { lt: staleCutoff } },
        {
          lastHeartbeatAt: null,
          startedAt: null,
          updatedAt: { lt: staleCutoff },
        },
      ],
    },
    data: {
      status: GradingJobStatus.QUEUED,
      enqueuedAt: null,
      leaseId: null,
      startedAt: null,
      lastHeartbeatAt: null,
      completedAt: null,
      // A stale-requeue is a clean retry, not an error retry — clear the
      // dispatch-error fields so `shouldRetryDispatch` won't apply
      // exponential backoff on the next tick (which would skip the very
      // job we just rescued). The "real error → backoff" path below still
      // stamps lastErrorAt + increments attemptCount as before.
      dispatchError: null,
      lastErrorAt: null,
      attemptCount: 0,
    },
  });
  result.staleRequeued = staleRequeued.count;

  if (result.staleRequeued > 0) {
    await capturePosthogEvent(
      env,
      'dispatch_loop_stale_processing_requeued',
      'dispatch-loop',
      { count: result.staleRequeued, staleProcessingMs: staleMs }
    );
  }

  // 2. Recover orphaned QUEUED jobs.
  //
  // When a CF Queue message is silently dropped (DLQ exhaustion, worker
  // cold-start failure, OOM before the cleanup path runs), the GradingJob
  // row stays QUEUED with `enqueuedAt` set and the publish loop below —
  // which only matches `enqueuedAt: null` — skips it forever. Without this
  // sweep, the only recovery is the 24h VERY_STALE_JOB_MS backstop in
  // `recoverStuckJob`, which fires lazily on poll.
  //
  // Inverse of the stale-PROCESSING block above: that block clears
  // `lastErrorAt`/`attemptCount` because a stale-requeue is a clean retry.
  // Here we *stamp* `lastErrorAt` and a `dispatchError` because this IS an
  // error condition — a queue message went missing — and surfacing it via
  // the normal dispatch-error fields means it shows up in monitoring and
  // the `attemptCount` accumulates if the CF Queue keeps swallowing it.
  //
  // The `updatedAt` filter excludes jobs the worker recently `/requeue`'d:
  // those are intentionally kept enqueued so CF Queue's own retry can
  // redeliver, and republishing here would double-deliver. Anything silent
  // for `orphanCutoff` is past every plausible CF retry cycle.
  const orphanMs = dispatchOrphanMs(env);
  const orphanCutoff = new Date(Date.now() - orphanMs);
  const orphanedRequeued = await prisma.gradingJob.updateMany({
    where: {
      status: GradingJobStatus.QUEUED,
      leaseId: null,
      startedAt: null,
      enqueuedAt: { lt: orphanCutoff },
      updatedAt: { lt: orphanCutoff },
    },
    data: {
      enqueuedAt: null,
      dispatchError: 'Requeued by dispatch loop: queued message orphaned',
      lastErrorAt: new Date(),
    },
  });
  result.orphanRequeued = orphanedRequeued.count;

  if (result.orphanRequeued > 0) {
    await capturePosthogEvent(
      env,
      'dispatch_loop_orphaned_queued_requeued',
      'dispatch-loop',
      { count: result.orphanRequeued, dispatchOrphanMs: orphanMs }
    );
  }

  // 3. Publish QUEUED → CF Queues (oldest first, respecting backoff)
  const pendingJobs = await prisma.gradingJob.findMany({
    where: {
      status: GradingJobStatus.QUEUED,
      enqueuedAt: null,
    },
    orderBy: { createdAt: 'asc' },
    take: queuePollBatchSize(env),
    select: {
      id: true,
      attemptCount: true,
      lastErrorAt: true,
    },
  });

  for (const job of pendingJobs) {
    if (!shouldRetryDispatch(job.lastErrorAt, job.attemptCount)) {
      result.skippedByBackoff++;
      continue;
    }

    result.attempted++;
    await capturePosthogEvent(env, 'dispatch_loop_retry_attempt', job.id, {
      jobId: job.id,
      attemptCount: job.attemptCount,
    });

    const queuedAt = new Date().toISOString();
    try {
      // Field name is `v`, not `version` — matches the Express
      // GradingQueueMessageV1 schema (`services/queue/gradingQueue.ts`) and
      // what the grading-consumer Worker reads (`parseQueueMessage` in
      // `cloudflare/grading-consumer/src/index.ts:71`). Renaming this would
      // break the consumer's `Unsupported message version: undefined` check.
      await publishToQueue(env, 'CF_QUEUE_ID', {
        v: 1,
        jobId: job.id,
        enqueuedAt: queuedAt,
      });
      await prisma.gradingJob.update({
        where: { id: job.id },
        data: {
          enqueuedAt: new Date(queuedAt),
          dispatchError: null,
        },
      });
      result.dispatched++;
      await capturePosthogEvent(env, 'dispatch_loop_retry_succeeded', job.id, {
        jobId: job.id,
        queuedAt,
      });
    } catch (error) {
      const dispatchError =
        error instanceof QueueError
          ? `${error.code}: ${error.message}`
          : error instanceof Error
          ? error.message
          : 'Failed to publish queue message';

      console.warn('[dispatch-loop] retry failed', {
        jobId: job.id,
        error: dispatchError,
      });

      await prisma.gradingJob
        .update({
          where: { id: job.id },
          data: {
            dispatchError,
            lastErrorAt: new Date(),
            attemptCount: { increment: 1 },
          },
        })
        .catch(() => {
          /* best effort */
        });

      result.failed++;
      await capturePosthogEvent(env, 'dispatch_loop_retry_failed', job.id, {
        jobId: job.id,
        error: dispatchError,
      });
      await capturePosthogException(env, error, {
        distinctId: job.id,
        stage: 'dispatch_loop_retry_failed',
        extra: { jobId: job.id },
      });
    }
  }

  return result;
}
