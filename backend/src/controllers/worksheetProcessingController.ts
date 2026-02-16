import { Request, Response } from 'express';
import { GradingJobStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { uploadToS3 } from '../services/s3Service';
import config from '../config/env';
import { aiGradingLogger } from '../services/logger';
import { logError } from '../services/errorLogService';
import { captureGradingPipelineEvent } from '../services/posthogService';
import {
    createGradingQueueMessage,
    getGradingQueueClient
} from '../services/queue/gradingQueue';
import { runGradingJob } from '../services/gradingJobRunner';

interface MulterFile extends Express.Multer.File {}

type DispatchState = 'DISPATCHED' | 'PENDING_DISPATCH';

function parseBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
    }

    return false;
}

function sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parsePageNumber(req: Request, index: number): number {
    const pageNumbers = req.body.pageNumbers;

    if (Array.isArray(pageNumbers) && pageNumbers[index] !== undefined) {
        const parsed = Number.parseInt(String(pageNumbers[index]), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : index + 1;
    }

    return index + 1;
}

async function storeJobImages(jobId: string, files: MulterFile[], req: Request): Promise<void> {
    await Promise.all(
        files.map(async (file, index) => {
            const pageNumber = parsePageNumber(req, index);
            // Match the legacy upload key layout to maximize compatibility with existing S3 bucket policies.
            const key = `worksheets/${jobId}/${Date.now()}-page${pageNumber}-${sanitizeFilename(file.originalname)}`;
            const imageUrl = await uploadToS3(file.buffer, key, file.mimetype);

            await prisma.gradingJobImage.create({
                data: {
                    gradingJobId: jobId,
                    storageProvider: config.objectStorage.provider === 'r2' ? 'R2' : 'S3',
                    imageUrl,
                    s3Key: key,
                    pageNumber,
                    mimeType: file.mimetype
                }
            });
        })
    );
}

async function dispatchJob(jobId: string): Promise<{ dispatchState: DispatchState; queuedAt?: string }> {
    captureGradingPipelineEvent('dispatch_attempt', jobId, {
        jobId,
        queueMode: config.grading.queueMode
    });

    if (config.grading.queueMode === 'cloudflare') {
        try {
            const queueClient = getGradingQueueClient();
            const queueMessage = createGradingQueueMessage(jobId);
            await queueClient.publish(queueMessage);
            await prisma.gradingJob.update({
                where: { id: jobId },
                data: {
                    enqueuedAt: new Date(queueMessage.enqueuedAt),
                    dispatchError: null
                }
            });

            captureGradingPipelineEvent('dispatch_succeeded', jobId, {
                jobId,
                queueMode: config.grading.queueMode,
                dispatchState: 'DISPATCHED',
                queuedAt: queueMessage.enqueuedAt
            });

            return {
                dispatchState: 'DISPATCHED',
                queuedAt: queueMessage.enqueuedAt
            };
        } catch (error) {
            const dispatchError = error instanceof Error ? error.message : 'Queue publish failed';

            await prisma.gradingJob.update({
                where: { id: jobId },
                data: {
                    dispatchError,
                    lastErrorAt: new Date()
                }
            });

            await logError('grading-dispatch', error instanceof Error ? error : new Error(dispatchError), {
                jobId
            }).catch(() => {
                // best effort
            });

            captureGradingPipelineEvent('dispatch_failed', jobId, {
                jobId,
                queueMode: config.grading.queueMode,
                dispatchState: 'PENDING_DISPATCH',
                error: dispatchError
            });

            return {
                dispatchState: 'PENDING_DISPATCH'
            };
        }
    }

    const queuedAt = new Date().toISOString();
    await prisma.gradingJob.update({
        where: { id: jobId },
        data: {
            enqueuedAt: new Date(queuedAt),
            dispatchError: null
        }
    });

    captureGradingPipelineEvent('dispatch_succeeded', jobId, {
        jobId,
        queueMode: config.grading.queueMode,
        dispatchState: 'DISPATCHED',
        queuedAt
    });

    setImmediate(() => {
        void runGradingJob(jobId);
    });

    return {
        dispatchState: 'DISPATCHED',
        queuedAt
    };
}

/**
 * Queue grading job and return immediately.
 * @route POST /api/worksheet-processing/process
 */
export const processWorksheets = async (req: Request, res: Response) => {
    const requestTimer = aiGradingLogger.startTimer();

    const {
        token_no: tokenNo,
        worksheet_name: worksheetName,
        classId,
        studentId,
        studentName,
        worksheetNumber,
        submittedOn,
        isRepeated
    } = req.body;
    const submittedById = req.user?.userId;

    const files = (req.files as MulterFile[]) || [];

    aiGradingLogger.info('Grading request received', {
        tokenNo,
        worksheetName,
        worksheetNumber,
        studentId,
        classId,
        submittedOn,
        filesCount: files.length,
        teacherId: submittedById,
        queueMode: config.grading.queueMode
    });

    captureGradingPipelineEvent('request_received', String(submittedById || studentId || tokenNo || 'unknown'), {
        tokenNo: tokenNo ? String(tokenNo) : null,
        worksheetName: worksheetName ? String(worksheetName) : null,
        worksheetNumber: worksheetNumber ? String(worksheetNumber) : null,
        studentId: studentId ? String(studentId) : null,
        classId: classId ? String(classId) : null,
        filesCount: files.length,
        queueMode: config.grading.queueMode
    });

    if (!tokenNo || !worksheetName || files.length === 0) {
        captureGradingPipelineEvent('request_rejected_validation', String(submittedById || studentId || 'unknown'), {
            reason: 'missing_required_fields_token_or_worksheet_or_files',
            filesCount: files.length
        });
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (!classId || !studentId || !worksheetNumber || !submittedById) {
        captureGradingPipelineEvent('request_rejected_validation', String(submittedById || studentId || 'unknown'), {
            reason: 'missing_required_fields_job_metadata',
            hasClassId: Boolean(classId),
            hasStudentId: Boolean(studentId),
            hasWorksheetNumber: Boolean(worksheetNumber),
            hasTeacherId: Boolean(submittedById)
        });
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (
        config.grading.queueMode === 'cloudflare' &&
        !config.grading.pullWorkerEnabled &&
        files.length > config.grading.fastMaxPages
    ) {
        captureGradingPipelineEvent('request_rejected_validation', String(submittedById || studentId), {
            reason: 'too_many_pages_fast_path',
            filesCount: files.length,
            maxPages: config.grading.fastMaxPages
        });
        return res.status(400).json({
            success: false,
            error: `Too many images. Maximum ${config.grading.fastMaxPages} pages are supported in queue mode right now.`
        });
    }

    let jobId: string | null = null;

    try {
        const resolvedStudentName =
            studentName ||
            (await prisma.user.findUnique({ where: { id: studentId }, select: { name: true } }))?.name ||
            'Unknown';

        const job = await prisma.gradingJob.create({
            data: {
                studentId,
                studentName: resolvedStudentName,
                worksheetNumber: Number.parseInt(String(worksheetNumber), 10),
                worksheetName: String(worksheetName),
                tokenNo: String(tokenNo),
                classId,
                teacherId: submittedById,
                status: GradingJobStatus.QUEUED,
                submittedOn: submittedOn ? new Date(submittedOn) : new Date(),
                isRepeated: parseBoolean(isRepeated)
            },
            select: { id: true }
        });

        jobId = job.id;

        captureGradingPipelineEvent('job_created', job.id, {
            jobId: job.id,
            studentId: String(studentId),
            classId: String(classId),
            teacherId: String(submittedById),
            worksheetNumber: String(worksheetNumber),
            worksheetName: String(worksheetName),
            queueMode: config.grading.queueMode
        });

        await storeJobImages(job.id, files, req);

        captureGradingPipelineEvent('images_stored', job.id, {
            jobId: job.id,
            filesCount: files.length,
            totalBytes: files.reduce((acc, file) => acc + file.size, 0),
            storageProvider: config.objectStorage.provider
        });

        const dispatchResult = await dispatchJob(job.id);

        requestTimer.end('Grading job queued', {
            jobId: job.id,
            dispatchState: dispatchResult.dispatchState,
            queuedAt: dispatchResult.queuedAt
        });

        captureGradingPipelineEvent('request_accepted', job.id, {
            jobId: job.id,
            dispatchState: dispatchResult.dispatchState,
            queuedAt: dispatchResult.queuedAt,
            status: 'queued'
        });

        return res.status(202).json({
            success: true,
            jobId: job.id,
            status: 'queued',
            queuedAt: dispatchResult.queuedAt,
            dispatchState: dispatchResult.dispatchState,
            message:
                dispatchResult.dispatchState === 'DISPATCHED'
                    ? 'Job queued'
                    : 'Job created but dispatch pending; it will be retried automatically'
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorDetails = error as { code?: string; statusCode?: number; requestId?: string; name?: string } | undefined;

        if (jobId) {
            await prisma.gradingJob
                .update({
                    where: { id: jobId },
                    data: {
                        status: GradingJobStatus.FAILED,
                        errorMessage,
                        lastErrorAt: new Date(),
                        completedAt: new Date()
                    }
                })
                .catch(() => {
                    // best effort
                });
        }

        await logError('grading-request', error instanceof Error ? error : new Error(errorMessage), {
            jobId,
            studentId,
            classId,
            worksheetNumber,
            errorCode: errorDetails?.code,
            errorStatusCode: errorDetails?.statusCode,
            errorRequestId: errorDetails?.requestId,
            errorName: errorDetails?.name
        }).catch(() => {
            // best effort
        });

        requestTimer.end('Grading request failed', {
            jobId,
            error: errorMessage
        });

        captureGradingPipelineEvent('request_failed', String(jobId || submittedById || studentId || 'unknown'), {
            jobId,
            studentId: studentId ? String(studentId) : null,
            classId: classId ? String(classId) : null,
            worksheetNumber: worksheetNumber ? String(worksheetNumber) : null,
            error: errorMessage,
            errorCode: errorDetails?.code,
            errorStatusCode: errorDetails?.statusCode
        });

        return res.status(500).json({ success: false, error: 'Failed to queue grading job' });
    }
};
