import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import {
    acquireGradingJobLease,
    markGradingJobCompleted,
    markGradingJobFailed,
    requeueGradingJobForRetry,
    touchGradingJobHeartbeat
} from '../services/gradingJobLifecycleService';
import { persistWorksheetForGradingJobId } from '../services/gradingWorksheetPersistenceService';
import { GradingApiResponse } from '../services/gradingTypes';
import { logError } from '../services/errorLogService';

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
        const acquired = await acquireGradingJobLease(jobId);
        if (!acquired) {
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

    try {
        await touchGradingJobHeartbeat(jobId);
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
    const gradingResponse = getGradingResponseFromBody(req.body);

    if (!gradingResponse) {
        return res.status(400).json({ success: false, error: 'Invalid grading response payload' });
    }

    try {
        const persisted = await persistWorksheetForGradingJobId(jobId, gradingResponse);
        await markGradingJobCompleted(jobId, persisted.worksheetId);

        return res.json({
            success: true,
            worksheetId: persisted.worksheetId,
            action: persisted.action
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown completion error';

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
    const errorMessage = isObject(req.body) && typeof req.body.errorMessage === 'string' ? req.body.errorMessage : '';

    if (!errorMessage) {
        return res.status(400).json({ success: false, error: 'errorMessage is required' });
    }

    try {
        await markGradingJobFailed(jobId, errorMessage);
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
    const reason = isObject(req.body) && typeof req.body.reason === 'string' ? req.body.reason : undefined;

    try {
        await requeueGradingJobForRetry(jobId, reason);
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
