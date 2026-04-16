import { Hono } from 'hono';
import { z } from 'zod';
import { GradingJobStatus, type Prisma } from '@prisma/client';
import { requireGradingWorkerToken } from '../middleware/workerTokens';
import { validateJson } from '../validation';
import {
  acquireGradingJobLease,
  touchGradingJobHeartbeat,
  markGradingJobFailed,
  requeueGradingJobForRetry,
} from '../adapters/gradingLifecycle';
import { persistWorksheetForGradingJobId } from '../adapters/gradingPersistence';
import { updateMasteryForWorksheet } from '../adapters/mastery';
import {
  summarizeError,
  summarizeGradingResponse,
  summarizeRequestBodyShape,
  type GradingApiResponse,
} from '../adapters/gradingDiagnostics';
import {
  capturePosthogEvent,
  capturePosthogException,
} from '../adapters/posthog';
import type { AppBindings } from '../types';

/**
 * Internal grading-worker routes — port of
 * `backend/src/controllers/internalGradingWorkerController.ts`.
 *
 * Mounted under `/internal/grading-worker`. Authenticated with the
 * shared-secret `X-Grading-Worker-Token` header. Endpoints:
 *   POST /jobs/:jobId/acquire    — QUEUED → PROCESSING, returns leaseId + job payload
 *   POST /jobs/:jobId/heartbeat  — extend lease on long-running grading
 *   POST /jobs/:jobId/complete   — PROCESSING → COMPLETED, persist worksheet + mastery
 *   POST /jobs/:jobId/fail       — PROCESSING → FAILED
 *   POST /jobs/:jobId/requeue    — PROCESSING → QUEUED (for retry)
 *
 * The grading Cloudflare Worker calls these endpoints over its
 * at-least-once queue-consumer loop. Lease semantics guard against a
 * second worker picking up a job the first one still holds: every
 * write is `WHERE leaseId = :leaseId`, so a stale caller silently
 * no-ops and the queue consumer should treat the mismatch as "I lost
 * ownership, stop processing this message".
 */

// ── Config constants (match Express) ────────────────────────────────────

// 2× the configured heartbeat interval is the drift budget before we
// flag a worker→DB clock mismatch. NTP-synced hosts stay under 1 s;
// 30 s is the point where lease math starts producing wrong answers.
const HEARTBEAT_DRIFT_MULTIPLIER = 2;
const CLOCK_SKEW_THRESHOLD_MS = 30_000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 60_000;

function heartbeatIntervalMs(env: AppBindings['Bindings']): number {
  const raw = Number.parseInt(
    (env as { GRADING_HEARTBEAT_INTERVAL_MS?: string })?.GRADING_HEARTBEAT_INTERVAL_MS ?? '',
    10
  );
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_HEARTBEAT_INTERVAL_MS;
}

// ── Schemas ─────────────────────────────────────────────────────────────

const heartbeatSchema = z.object({
  leaseId: z.string().min(1, { message: 'leaseId is required' }),
  phase: z.string().optional(),
});

const completeSchema = z
  .object({
    leaseId: z.string().min(1, { message: 'leaseId is required' }),
    gradingResponse: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const failSchema = z.object({
  leaseId: z.string().min(1, { message: 'leaseId is required' }),
  errorMessage: z.string().min(1, { message: 'errorMessage is required' }),
});

const requeueSchema = z.object({
  leaseId: z.string().min(1, { message: 'leaseId is required' }),
  reason: z.string().optional(),
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * The `complete` endpoint accepts two shapes for backwards compatibility:
 *   { leaseId, gradingResponse: { success: true, ... } }   ← canonical
 *   { leaseId, success: true, ... }                         ← legacy
 *
 * Extract the grading response (the thing with `success: boolean`) from
 * whichever shape came in. Returns `null` if neither shape is present.
 */
function getGradingResponseFromBody(body: unknown): GradingApiResponse | null {
  if (!isObject(body)) return null;
  const nested = body.gradingResponse;
  const payload = isObject(nested) ? nested : body;
  if (!isObject(payload)) return null;
  if (typeof payload.success !== 'boolean') return null;
  return payload as unknown as GradingApiResponse;
}

// ── Router ──────────────────────────────────────────────────────────────

const internalGradingWorker = new Hono<AppBindings>();

internalGradingWorker.use('*', requireGradingWorkerToken);

/**
 * `POST /jobs/:jobId/acquire`
 *
 * Atomic QUEUED → PROCESSING with lease generation. Also compares the
 * worker's clock against the database's NOW() once per acquire —
 * important for catching NTP drift before it manifests as lease expiry
 * bugs. Skew detection is best-effort: a failed `$queryRaw` never blocks
 * the acquire.
 */
internalGradingWorker.post('/jobs/:jobId/acquire', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

  const jobId = c.req.param('jobId');
  const env = c.env ?? {};
  await capturePosthogEvent(env, 'worker_acquire_requested', jobId, { jobId });

  // Clock-skew check (best-effort)
  try {
    const workerNow = new Date();
    const dbNowRows = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT NOW() AS now`;
    const dbNow = dbNowRows[0]?.now;
    if (dbNow) {
      const skewMs = Math.abs(workerNow.getTime() - dbNow.getTime());
      if (skewMs > CLOCK_SKEW_THRESHOLD_MS) {
        await capturePosthogEvent(env, 'worker_clock_skew', jobId, {
          jobId,
          skewMs,
          thresholdMs: CLOCK_SKEW_THRESHOLD_MS,
          workerNowIso: workerNow.toISOString(),
          dbNowIso: dbNow.toISOString(),
        });
      }
    }
  } catch {
    // swallow — skew detection must never block acquires
  }

  try {
    const leaseId = await acquireGradingJobLease(prisma, jobId);
    if (!leaseId) {
      await capturePosthogEvent(env, 'worker_acquire_skipped', jobId, {
        jobId,
        reason: 'already_processing_or_terminal',
      });
      return c.json({ success: true, acquired: false }, 200);
    }

    const job = await prisma.gradingJob.findUnique({
      where: { id: jobId },
      select: {
        id: true,
        status: true,
        tokenNo: true,
        worksheetName: true,
        worksheetNumber: true,
        submittedOn: true,
        isRepeated: true,
        studentId: true,
        classId: true,
        teacherId: true,
        images: {
          orderBy: { pageNumber: 'asc' },
          select: {
            s3Key: true,
            storageProvider: true,
            pageNumber: true,
            mimeType: true,
          },
        },
      },
    });

    if (!job) {
      await capturePosthogEvent(env, 'worker_acquire_job_not_found', jobId, { jobId });
      return c.json({ success: false, error: 'Job not found' }, 404);
    }

    await capturePosthogEvent(env, 'worker_acquire_succeeded', jobId, {
      jobId,
      leaseId,
      imagesCount: job.images.length,
      worksheetNumber: job.worksheetNumber,
    });

    return c.json({ success: true, acquired: true, leaseId, job }, 200);
  } catch (error) {
    console.error('[worker-acquire]', error, { jobId });
    await capturePosthogEvent(env, 'worker_acquire_failed', jobId, {
      jobId,
      error: error instanceof Error ? error.message : 'Acquire failed',
    });
    await capturePosthogException(env, error, {
      distinctId: jobId,
      stage: 'worker_acquire_failed',
      extra: { jobId },
    });
    return c.json({ success: false, error: 'Failed to acquire job' }, 500);
  }
});

/**
 * `POST /jobs/:jobId/heartbeat`
 *
 * Extend the lease on a still-processing job. Returns 409 on lease
 * mismatch so the caller stops processing its message. Compares the
 * gap since the previous beat to detect GC pauses / network stalls;
 * only meaningful for non-initial beats.
 */
internalGradingWorker.post(
  '/jobs/:jobId/heartbeat',
  validateJson(heartbeatSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

    const jobId = c.req.param('jobId');
    const { leaseId, phase = 'interval' } = c.req.valid('json');
    const env = c.env ?? {};

    let previousHeartbeatAt: Date | null = null;
    try {
      const existing = await prisma.gradingJob.findUnique({
        where: { id: jobId },
        select: { lastHeartbeatAt: true },
      });
      previousHeartbeatAt = existing?.lastHeartbeatAt ?? null;
    } catch {
      // best effort — drift detection must never block heartbeats
    }

    try {
      const updated = await touchGradingJobHeartbeat(prisma, jobId, leaseId);
      if (!updated) {
        await capturePosthogEvent(env, 'worker_heartbeat_lease_mismatch', jobId, {
          jobId,
          leaseId,
          phase,
        });
        return c.json({ success: false, error: 'Lease mismatch' }, 409);
      }

      if (previousHeartbeatAt && phase !== 'initial') {
        const gapMs = Date.now() - previousHeartbeatAt.getTime();
        const expectedIntervalMs = heartbeatIntervalMs(env);
        if (gapMs > expectedIntervalMs * HEARTBEAT_DRIFT_MULTIPLIER) {
          await capturePosthogEvent(env, 'worker_heartbeat_drift', jobId, {
            jobId,
            leaseId,
            gapMs,
            expectedIntervalMs,
            driftMultiplier: HEARTBEAT_DRIFT_MULTIPLIER,
          });
        }
      }

      if (phase === 'initial') {
        await capturePosthogEvent(env, 'worker_heartbeat_initial', jobId, {
          jobId,
          leaseId,
        });
      }
      return c.json({ success: true }, 200);
    } catch (error) {
      console.error('[worker-heartbeat]', error, { jobId });
      await capturePosthogEvent(env, 'worker_heartbeat_failed', jobId, {
        jobId,
        leaseId,
        phase,
        error: error instanceof Error ? error.message : 'Heartbeat failed',
      });
      await capturePosthogException(env, error, {
        distinctId: jobId,
        stage: 'worker_heartbeat_failed',
        extra: { jobId, leaseId, phase },
      });
      return c.json({ success: false, error: 'Failed to update heartbeat' }, 500);
    }
  }
);

/**
 * `POST /jobs/:jobId/complete`
 *
 * Atomic PROCESSING → COMPLETED wrapped in a `$transaction` with a row
 * lock (`FOR UPDATE`) to serialize against concurrent completers and
 * requeuers. Steps:
 *   1. Lock the job row for the transaction.
 *   2. If already COMPLETED, short-circuit and return the existing
 *      worksheetId (idempotent retry path).
 *   3. Validate the caller's leaseId matches.
 *   4. Persist the worksheet via `persistWorksheetForGradingJobId`.
 *   5. Flip job status to COMPLETED under the same lease condition.
 *
 * Mastery update fires *after* the transaction succeeds. Failures there
 * are logged but never fail the overall complete — mastery is best-effort.
 */
internalGradingWorker.post(
  '/jobs/:jobId/complete',
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

    const jobId = c.req.param('jobId');
    const env = c.env ?? {};

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ success: false, error: 'Request body must be JSON' }, 400);
    }

    const leaseId =
      isObject(body) && typeof body.leaseId === 'string' ? body.leaseId : '';
    const gradingResponse = getGradingResponseFromBody(body);

    if (!leaseId) {
      return c.json({ success: false, error: 'leaseId is required' }, 400);
    }

    if (!gradingResponse) {
      const requestBodySummary = summarizeRequestBodyShape(body);
      console.warn('[worker-complete] invalid payload', {
        jobId,
        leaseIdProvided: Boolean(leaseId),
        requestBodySummary,
      });
      await capturePosthogEvent(env, 'worker_complete_invalid_payload', jobId, {
        jobId,
        leaseIdProvided: Boolean(leaseId),
        requestBodySummary,
      });
      return c.json({ success: false, error: 'Invalid grading response payload' }, 400);
    }

    try {
      await capturePosthogEvent(env, 'worker_complete_requested', jobId, {
        jobId,
        leaseId,
      });

      const persisted = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{ id: string; status: string; leaseId: string | null; worksheetId: string | null }>
        >`
          SELECT "id", "status", "leaseId", "worksheetId"
          FROM "GradingJob"
          WHERE "id" = ${jobId}
          FOR UPDATE
        `;

        const current = rows[0];
        if (!current) return null;

        if (current.status === GradingJobStatus.COMPLETED) {
          return {
            worksheetId: current.worksheetId,
            action: 'ALREADY_COMPLETED' as const,
          };
        }

        if (
          current.status !== GradingJobStatus.PROCESSING ||
          current.leaseId !== leaseId
        ) {
          throw Object.assign(new Error('Lease mismatch'), {
            code: 'LEASE_MISMATCH',
          });
        }

        const persistedWorksheet = await persistWorksheetForGradingJobId(
          tx as unknown as Prisma.TransactionClient,
          env,
          jobId,
          gradingResponse
        );

        const now = new Date();
        const updated = await tx.gradingJob.updateMany({
          where: {
            id: jobId,
            status: GradingJobStatus.PROCESSING,
            leaseId,
          },
          data: {
            status: GradingJobStatus.COMPLETED,
            worksheetId: persistedWorksheet.worksheetId,
            completedAt: now,
            lastHeartbeatAt: now,
            leaseId: null,
            errorMessage: null,
            dispatchError: null,
          },
        });

        if (updated.count === 0) {
          throw Object.assign(new Error('Lease mismatch'), { code: 'LEASE_MISMATCH' });
        }

        return {
          worksheetId: persistedWorksheet.worksheetId,
          action: persistedWorksheet.action as 'CREATED' | 'UPDATED' | 'ALREADY_COMPLETED',
        };
      });

      if (!persisted) {
        await capturePosthogEvent(env, 'worker_complete_job_not_found', jobId, {
          jobId,
          leaseId,
        });
        return c.json({ success: false, error: 'Job not found' }, 404);
      }

      // Best-effort mastery update after the job is durably completed.
      try {
        const job = await prisma.gradingJob.findUnique({
          where: { id: jobId },
          select: { studentId: true, worksheetNumber: true, submittedOn: true },
        });
        if (job && persisted.worksheetId) {
          await updateMasteryForWorksheet(prisma, {
            worksheetId: persisted.worksheetId,
            studentId: job.studentId,
            worksheetNumber: job.worksheetNumber,
            grade: gradingResponse.grade ?? 0,
            outOf: gradingResponse.total_possible ?? 40,
            submittedOn: job.submittedOn ?? new Date(),
          });
        }
      } catch (err) {
        console.error('[mastery] update failed (non-fatal):', err);
      }

      await capturePosthogEvent(env, 'worker_complete_succeeded', jobId, {
        jobId,
        leaseId,
        worksheetId: persisted.worksheetId,
        action: persisted.action,
      });

      return c.json(
        {
          success: true,
          worksheetId: persisted.worksheetId,
          action: persisted.action,
        },
        200
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown completion error';
      const code =
        error instanceof Error
          ? (error as Error & { code?: string }).code
          : undefined;
      const errorSummary = summarizeError(error);
      const gradingResponseSummary = summarizeGradingResponse(gradingResponse);

      if (code === 'LEASE_MISMATCH') {
        await capturePosthogEvent(env, 'worker_complete_lease_mismatch', jobId, {
          jobId,
          leaseId,
        });
        return c.json({ success: false, error: 'Lease mismatch' }, 409);
      }

      console.error('[worker-complete]', error, {
        jobId,
        leaseId,
        errorSummary,
        gradingResponseSummary,
      });
      await capturePosthogEvent(env, 'worker_complete_failed', jobId, {
        jobId,
        leaseId,
        error: message,
        errorSummary,
        gradingResponseSummary,
      });
      await capturePosthogException(env, error, {
        distinctId: jobId,
        stage: 'worker_complete_failed',
        extra: { jobId, leaseId },
      });

      // IMPORTANT: do NOT mark FAILED here. The CF grading worker treats
      // 5xx as "retry me" — marking the job FAILED locally would strand
      // the next retry. The lifecycle service owns FAILED transitions.
      return c.json({ success: false, error: message }, 500);
    }
  }
);

/**
 * `POST /jobs/:jobId/fail` — PROCESSING → FAILED with error message.
 */
internalGradingWorker.post(
  '/jobs/:jobId/fail',
  validateJson(failSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

    const jobId = c.req.param('jobId');
    const { leaseId, errorMessage } = c.req.valid('json');
    const env = c.env ?? {};

    try {
      const failed = await markGradingJobFailed(prisma, jobId, leaseId, errorMessage);
      if (!failed) {
        await capturePosthogEvent(env, 'worker_fail_lease_mismatch', jobId, {
          jobId,
          leaseId,
        });
        return c.json({ success: false, error: 'Lease mismatch' }, 409);
      }

      await capturePosthogEvent(env, 'worker_fail_succeeded', jobId, {
        jobId,
        leaseId,
        errorMessage,
      });
      return c.json({ success: true }, 200);
    } catch (error) {
      console.error('[worker-fail]', error, { jobId });
      await capturePosthogEvent(env, 'worker_fail_failed', jobId, {
        jobId,
        leaseId,
        error: error instanceof Error ? error.message : 'Fail handler failed',
      });
      await capturePosthogException(env, error, {
        distinctId: jobId,
        stage: 'worker_fail_failed',
        extra: { jobId, leaseId },
      });
      return c.json({ success: false, error: 'Failed to mark job failed' }, 500);
    }
  }
);

/**
 * `POST /jobs/:jobId/requeue` — PROCESSING → QUEUED.
 * Releases the lease back to QUEUED for retry (does not clear enqueuedAt,
 * since the CF Queues message is still live).
 */
internalGradingWorker.post(
  '/jobs/:jobId/requeue',
  validateJson(requeueSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

    const jobId = c.req.param('jobId');
    const { leaseId, reason } = c.req.valid('json');
    const env = c.env ?? {};

    try {
      const updated = await requeueGradingJobForRetry(prisma, jobId, leaseId, reason);
      if (!updated) {
        await capturePosthogEvent(env, 'worker_requeue_lease_mismatch', jobId, {
          jobId,
          leaseId,
        });
        return c.json({ success: false, error: 'Lease mismatch' }, 409);
      }

      await capturePosthogEvent(env, 'worker_requeue_succeeded', jobId, {
        jobId,
        leaseId,
        reason,
      });
      return c.json({ success: true }, 200);
    } catch (error) {
      console.error('[worker-requeue]', error, { jobId });
      await capturePosthogEvent(env, 'worker_requeue_failed', jobId, {
        jobId,
        leaseId,
        error: error instanceof Error ? error.message : 'Requeue failed',
      });
      await capturePosthogException(env, error, {
        distinctId: jobId,
        stage: 'worker_requeue_failed',
        extra: { jobId, leaseId },
      });
      return c.json({ success: false, error: 'Failed to requeue job' }, 500);
    }
  }
);

export default internalGradingWorker;
