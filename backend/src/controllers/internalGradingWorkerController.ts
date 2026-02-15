import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import {
    acquireGradingJobLease,
    markGradingJobFailed,
    requeueGradingJobForRetry,
    touchGradingJobHeartbeat
} from '../services/gradingJobLifecycleService';
import { persistWorksheetForGradingJobId } from '../services/gradingWorksheetPersistenceService';
import { GradingApiResponse } from '../services/gradingTypes';
import { logError } from '../services/errorLogService';
import { GradingJobStatus } from '@prisma/client';

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

    try {
        const leaseId = await acquireGradingJobLease(jobId);
        if (!leaseId) {
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
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

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

        return res.status(500).json({ success: false, error: 'Failed to acquire job' });
    }
}

/**
 * POST /internal/grading-worker/jobs/:jobId/heartbeat
 */
export async function heartbeat(req: Request, res: Response): Promise<Response> {
    const { jobId } = req.params;
    const leaseId = isObject(req.body) && typeof req.body.leaseId === 'string' ? req.body.leaseId : '';

    if (!leaseId) {
        return res.status(400).json({ success: false, error: 'leaseId is required' });
    }

    try {
        const updated = await touchGradingJobHeartbeat(jobId, leaseId);
        if (!updated) {
            return res.status(409).json({ success: false, error: 'Lease mismatch' });
        }
        return res.json({ success: true });
    } catch (error) {
        await logError('internal-grading-worker-heartbeat', error instanceof Error ? error : new Error('Heartbeat failed'), {
            jobId
        }).catch(() => {
            // best effort
        });
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
        return res.status(400).json({ success: false, error: 'Invalid grading response payload' });
    }

    try {
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
            return res.status(404).json({ success: false, error: 'Job not found' });
        }

        return res.json({ success: true, worksheetId: persisted.worksheetId, action: persisted.action });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown completion error';
        const code = (error as any)?.code;

        if (code === 'LEASE_MISMATCH') {
            return res.status(409).json({ success: false, error: 'Lease mismatch' });
        }

        await logError('internal-grading-worker-complete', error instanceof Error ? error : new Error(message), {
            jobId
        }).catch(() => {
            // best effort
        });

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
            return res.status(409).json({ success: false, error: 'Lease mismatch' });
        }
        return res.json({ success: true });
    } catch (error) {
        await logError('internal-grading-worker-fail', error instanceof Error ? error : new Error('Fail handler failed'), {
            jobId
        }).catch(() => {
            // best effort
        });

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
            return res.status(409).json({ success: false, error: 'Lease mismatch' });
        }
        return res.json({ success: true });
    } catch (error) {
        await logError('internal-grading-worker-requeue', error instanceof Error ? error : new Error('Requeue failed'), {
            jobId
        }).catch(() => {
            // best effort
        });
        return res.status(500).json({ success: false, error: 'Failed to requeue job' });
    }
}
