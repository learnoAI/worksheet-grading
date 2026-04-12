import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import config from '../config/env';
import {
    acquireGradingJobLease,
    markGradingJobFailed,
    requeueGradingJobForRetry,
    touchGradingJobHeartbeat
} from '../services/gradingJobLifecycleService';
import { summarizeError, summarizeGradingResponse, summarizeRequestBodyShape } from '../services/gradingDiagnostics';
import { persistWorksheetForGradingJobId } from '../services/gradingWorksheetPersistenceService';
import { GradingApiResponse } from '../services/gradingTypes';
import { logError } from '../services/errorLogService';
import { aiGradingLogger } from '../services/logger';
import { captureGradingPipelineEvent, capturePosthogException } from '../services/posthogService';
import { GradingJobStatus } from '@prisma/client';

// Gap between consecutive heartbeats beyond which we suspect a GC pause or
// network stall. 2× the configured interval gives a healthy worker enough
// jitter budget while still catching real drift before it manifests as a
// lease-lost failure downstream.
const HEARTBEAT_DRIFT_MULTIPLIER = 2;

// Threshold for flagging worker↔DB wall-clock disagreement. NTP-synced hosts
// should be well under a second; 30s is the point at which lease expiry and
// staleness calculations start producing wrong decisions.
const CLOCK_SKEW_THRESHOLD_MS = 30_000;

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function getGradingResponseFromBody(body: unknown): GradingApiResponse | null {
    if (!isObject(body)) {
        return null;
    }

    const maybeNested = body.gradingResponse;
    const payload = isObject(maybeNested) ? maybeNested : body;

    if (!isObject(payload)) {
        return null;
    }

    // We validate minimally; persistence will check `success` and `error`.
    const success = payload.success;
    if (typeof success !== 'boolean') {
        return null;
    }

    return payload as unknown as GradingApiResponse;
}

/**
 * POST /internal/grading-worker/jobs/:jobId/acquire
 * Atomically transitions QUEUED -> PROCESSING and returns the job payload.
 */
export async function acquireJob(req: Request, res: Response): Promise<Response> {
    const { jobId } = req.params;
    captureGradingPipelineEvent('worker_acquire_requested', jobId, { jobId });

    // Best-effort worker↔DB wall-clock comparison. Run once per acquire since
    // acquires are not frequent; a real NTP-synced host is well under a second.
    // A single failed $queryRaw must never prevent the job from acquiring.
    try {
        const dbNowRows = await prisma.$queryRaw<{ now: Date }[]>`SELECT NOW() AS now`;
        const dbNow = dbNowRows[0]?.now;
        if (dbNow) {
            const workerNow = new Date();
            const skewMs = Math.abs(workerNow.getTime() - dbNow.getTime());
            if (skewMs > CLOCK_SKEW_THRESHOLD_MS) {
                captureGradingPipelineEvent('worker_clock_skew', jobId, {
                    jobId,
                    skewMs,
                    thresholdMs: CLOCK_SKEW_THRESHOLD_MS,
                    workerNowIso: workerNow.toISOString(),
                    dbNowIso: dbNow.toISOString()
                });
            }
        }
    } catch {
        // Skew detection is best-effort; swallow to keep acquires resilient.
    }

    try {
        const leaseId = await acquireGradingJobLease(jobId);
        if (!leaseId) {
            captureGradingPipelineEvent('worker_acquire_skipped', jobId, {
                jobId,
                reason: 'already_processing_or_terminal'
            });
            return res.json({ success: true, acquired: false });
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
                        mimeType: true
                    }
                }
            }
        });

        if (!job) {
            captureGradingPipelineEvent('worker_acquire_job_not_found', jobId, { jobId });
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        captureGradingPipelineEvent('worker_acquire_succeeded', jobId, {
            jobId,
            leaseId,
            imagesCount: job.images.length,
            worksheetNumber: job.worksheetNumber
        });

        return res.json({
            success: true,
            acquired: true,
            leaseId,
            job
        });
    } catch (error) {
        await logError('internal-grading-worker-acquire', error instanceof Error ? error : new Error('Acquire failed'), {
            jobId
        }).catch(() => {
            // best effort
        });

        captureGradingPipelineEvent('worker_acquire_failed', jobId, {
            jobId,
            error: error instanceof Error ? error.message : 'Acquire failed'
        });
        capturePosthogException(error, { distinctId: jobId, stage: 'worker_acquire_failed', extra: { jobId } });

        return res.status(500).json({ success: false, error: 'Failed to acquire job' });
    }
}

/**
 * POST /internal/grading-worker/jobs/:jobId/heartbeat
 */
export async function heartbeat(req: Request, res: Response): Promise<Response> {
    const { jobId } = req.params;
    const leaseId = isObject(req.body) && typeof req.body.leaseId === 'string' ? req.body.leaseId : '';
    const phase = isObject(req.body) && typeof req.body.phase === 'string' ? req.body.phase : 'interval';

    if (!leaseId) {
        return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    // Read the previous heartbeat time before touching so we can detect drift
    // caused by GC pauses or network stalls. Missing the pre-read is not
    // critical — we'll just skip drift detection for that beat.
    let previousHeartbeatAt: Date | null = null;
    try {
        const existing = await prisma.gradingJob.findUnique({
            where: { id: jobId },
            select: { lastHeartbeatAt: true }
        });
        previousHeartbeatAt = existing?.lastHeartbeatAt ?? null;
    } catch {
        // best effort — drift detection must never block heartbeats
    }

    try {
        const updated = await touchGradingJobHeartbeat(jobId, leaseId);
        if (!updated) {
            captureGradingPipelineEvent('worker_heartbeat_lease_mismatch', jobId, {
                jobId,
                leaseId,
                phase
            });
            return res.status(409).json({ success: false, error: 'Lease mismatch' });
        }

        // Compare the gap between this beat and the previous one against the
        // configured expectation. Only meaningful after the first beat and for
        // the non-initial phase — the initial beat has nothing to compare to.
        if (previousHeartbeatAt && phase !== 'initial') {
            const gapMs = Date.now() - previousHeartbeatAt.getTime();
            const expectedIntervalMs = config.grading.heartbeatIntervalMs;
            if (gapMs > expectedIntervalMs * HEARTBEAT_DRIFT_MULTIPLIER) {
                captureGradingPipelineEvent('worker_heartbeat_drift', jobId, {
                    jobId,
                    leaseId,
                    gapMs,
                    expectedIntervalMs,
                    driftMultiplier: HEARTBEAT_DRIFT_MULTIPLIER
                });
            }
        }

        if (phase === 'initial') {
            captureGradingPipelineEvent('worker_heartbeat_initial', jobId, {
                jobId,
                leaseId
            });
        }
        return res.json({ success: true });
    } catch (error) {
        await logError('internal-grading-worker-heartbeat', error instanceof Error ? error : new Error('Heartbeat failed'), {
            jobId
        }).catch(() => {
            // best effort
        });

        captureGradingPipelineEvent('worker_heartbeat_failed', jobId, {
            jobId,
            leaseId,
            phase,
            error: error instanceof Error ? error.message : 'Heartbeat failed'
        });
        capturePosthogException(error, { distinctId: jobId, stage: 'worker_heartbeat_failed', extra: { jobId, leaseId, phase } });
        return res.status(500).json({ success: false, error: 'Failed to update heartbeat' });
    }
}

/**
 * POST /internal/grading-worker/jobs/:jobId/complete
 * Body: { gradingResponse: GradingApiResponse } (or the response directly)
 */
export async function complete(req: Request, res: Response): Promise<Response> {
    const { jobId } = req.params;
    const leaseId = isObject(req.body) && typeof req.body.leaseId === 'string' ? req.body.leaseId : '';
    const gradingResponse = getGradingResponseFromBody(req.body);

    if (!leaseId) {
        return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    if (!gradingResponse) {
        const requestBodySummary = summarizeRequestBodyShape(req.body);
        aiGradingLogger.warn('Invalid grading worker completion payload', {
            jobId,
            leaseIdProvided: Boolean(leaseId),
            requestBodySummary
        });
        captureGradingPipelineEvent('worker_complete_invalid_payload', jobId, {
            jobId,
            leaseIdProvided: Boolean(leaseId),
            requestBodySummary
        });
        return res.status(400).json({ success: false, error: 'Invalid grading response payload' });
    }

    try {
        captureGradingPipelineEvent('worker_complete_requested', jobId, {
            jobId,
            leaseId
        });

        const persisted = await prisma.$transaction(async (tx) => {
            const rows = await tx.$queryRaw<Array<{ id: string; status: string; leaseId: string | null; worksheetId: string | null }>>`
                SELECT "id", "status", "leaseId", "worksheetId"
                FROM "GradingJob"
                WHERE "id" = ${jobId}
                FOR UPDATE
            `;

            const current = rows[0];
            if (!current) {
                return null;
            }

            if (current.status === GradingJobStatus.COMPLETED) {
                return {
                    worksheetId: current.worksheetId,
                    action: 'ALREADY_COMPLETED' as const
                };
            }

            if (current.status !== GradingJobStatus.PROCESSING || current.leaseId !== leaseId) {
                throw Object.assign(new Error('Lease mismatch'), { code: 'LEASE_MISMATCH' });
            }

            const persistedWorksheet = await persistWorksheetForGradingJobId(jobId, gradingResponse, tx);

            const now = new Date();
            const updated = await tx.gradingJob.updateMany({
                where: {
                    id: jobId,
                    status: GradingJobStatus.PROCESSING,
                    leaseId
                },
                data: {
                    status: GradingJobStatus.COMPLETED,
                    worksheetId: persistedWorksheet.worksheetId,
                    completedAt: now,
                    lastHeartbeatAt: now,
                    leaseId: null,
                    errorMessage: null,
                    dispatchError: null
                }
            });

            if (updated.count === 0) {
                throw Object.assign(new Error('Lease mismatch'), { code: 'LEASE_MISMATCH' });
            }

            return {
                worksheetId: persistedWorksheet.worksheetId,
                action: persistedWorksheet.action
            };
        });

        if (!persisted) {
            captureGradingPipelineEvent('worker_complete_job_not_found', jobId, {
                jobId,
                leaseId
            });
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        captureGradingPipelineEvent('worker_complete_succeeded', jobId, {
            jobId,
            leaseId,
            worksheetId: persisted.worksheetId,
            action: persisted.action
        });

        return res.json({ success: true, worksheetId: persisted.worksheetId, action: persisted.action });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown completion error';
        const code = (error as any)?.code;
        const errorSummary = summarizeError(error);
        const gradingResponseSummary = summarizeGradingResponse(gradingResponse);

        if (code === 'LEASE_MISMATCH') {
            captureGradingPipelineEvent('worker_complete_lease_mismatch', jobId, {
                jobId,
                leaseId
            });
            return res.status(409).json({ success: false, error: 'Lease mismatch' });
        }

        await logError('internal-grading-worker-complete', error instanceof Error ? error : new Error(message), {
            jobId,
            leaseId,
            errorSummary,
            gradingResponseSummary
        }).catch(() => {
            // best effort
        });

        aiGradingLogger.error(
            'Grading worker completion failed',
            {
                jobId,
                leaseId,
                errorSummary,
                gradingResponseSummary
            },
            error instanceof Error ? error : new Error(message)
        );

        captureGradingPipelineEvent('worker_complete_failed', jobId, {
            jobId,
            leaseId,
            error: message,
            errorSummary,
            gradingResponseSummary
        });
        capturePosthogException(error, { distinctId: jobId, stage: 'worker_complete_failed', extra: { jobId, leaseId } });

        // Important: do NOT mark the job FAILED here.
        // This endpoint is called from an at-least-once queue consumer; persistence failures can be transient.
        // The Cloudflare worker should retry (and/or requeue the job) on 5xx responses.
        return res.status(500).json({ success: false, error: message });
    }
}

/**
 * POST /internal/grading-worker/jobs/:jobId/fail
 * Body: { errorMessage: string }
 */
export async function fail(req: Request, res: Response): Promise<Response> {
    const { jobId } = req.params;
    const leaseId = isObject(req.body) && typeof req.body.leaseId === 'string' ? req.body.leaseId : '';
    const errorMessage = isObject(req.body) && typeof req.body.errorMessage === 'string' ? req.body.errorMessage : '';

    if (!leaseId) {
        return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    if (!errorMessage) {
        return res.status(400).json({ success: false, error: 'errorMessage is required' });
    }

    try {
        const failed = await markGradingJobFailed(jobId, leaseId, errorMessage);
        if (!failed) {
            captureGradingPipelineEvent('worker_fail_lease_mismatch', jobId, {
                jobId,
                leaseId
            });
            return res.status(409).json({ success: false, error: 'Lease mismatch' });
        }

        captureGradingPipelineEvent('worker_fail_succeeded', jobId, {
            jobId,
            leaseId,
            errorMessage
        });
        return res.json({ success: true });
    } catch (error) {
        await logError('internal-grading-worker-fail', error instanceof Error ? error : new Error('Fail handler failed'), {
            jobId
        }).catch(() => {
            // best effort
        });

        captureGradingPipelineEvent('worker_fail_failed', jobId, {
            jobId,
            leaseId,
            error: error instanceof Error ? error.message : 'Fail handler failed'
        });
        capturePosthogException(error, { distinctId: jobId, stage: 'worker_fail_failed', extra: { jobId, leaseId } });

        return res.status(500).json({ success: false, error: 'Failed to mark job failed' });
    }
}

/**
 * POST /internal/grading-worker/jobs/:jobId/requeue
 * Body: { reason?: string }
 *
 * Releases a PROCESSING lease back to QUEUED for retry (does not clear enqueuedAt).
 */
export async function requeue(req: Request, res: Response): Promise<Response> {
    const { jobId } = req.params;
    const leaseId = isObject(req.body) && typeof req.body.leaseId === 'string' ? req.body.leaseId : '';
    const reason = isObject(req.body) && typeof req.body.reason === 'string' ? req.body.reason : undefined;

    if (!leaseId) {
        return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    try {
        const updated = await requeueGradingJobForRetry(jobId, leaseId, reason);
        if (!updated) {
            captureGradingPipelineEvent('worker_requeue_lease_mismatch', jobId, {
                jobId,
                leaseId
            });
            return res.status(409).json({ success: false, error: 'Lease mismatch' });
        }

        captureGradingPipelineEvent('worker_requeue_succeeded', jobId, {
            jobId,
            leaseId,
            reason
        });
        return res.json({ success: true });
    } catch (error) {
        await logError('internal-grading-worker-requeue', error instanceof Error ? error : new Error('Requeue failed'), {
            jobId
        }).catch(() => {
            // best effort
        });

        captureGradingPipelineEvent('worker_requeue_failed', jobId, {
            jobId,
            leaseId,
            error: error instanceof Error ? error.message : 'Requeue failed'
        });
        capturePosthogException(error, { distinctId: jobId, stage: 'worker_requeue_failed', extra: { jobId, leaseId } });
        return res.status(500).json({ success: false, error: 'Failed to requeue job' });
    }
}
