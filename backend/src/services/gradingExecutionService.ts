import { GradingJob } from '@prisma/client';
import fetch from 'node-fetch';
import FormData from 'form-data';
import prisma from '../utils/prisma';
import { downloadFromS3 } from './s3Service';
import { scheduleGrading } from './gradingLimiter';
import { aiGradingLogger } from './logger';
import { GradingApiResponse } from './gradingTypes';
import { persistWorksheetForGradingJob } from './gradingWorksheetPersistenceService';
import { captureGradingPipelineEvent } from './posthogService';
import { updateMasteryForWorksheet } from './masteryService';

interface ExecuteGradingJobResult {
    worksheetId: string;
    action: 'CREATED' | 'UPDATED';
    grade: number | null;
}

interface ExecuteGradingJobOptions {
    onHeartbeat?: () => Promise<void>;
}

interface PythonApiFile {
    filename: string;
    contentType: string;
    buffer: Buffer;
}

interface GradingJobWithImages extends GradingJob {
    images: {
        id: string;
        s3Key: string;
        storageProvider: 'S3' | 'R2';
        pageNumber: number;
        mimeType: string;
    }[];
}

function getImageFilename(pageNumber: number, mimeType: string): string {
    if (mimeType === 'image/png') {
        return `page-${pageNumber}.png`;
    }

    if (mimeType === 'image/webp') {
        return `page-${pageNumber}.webp`;
    }

    return `page-${pageNumber}.jpg`;
}

async function callPythonApi(
    url: string,
    tokenNo: string,
    worksheetName: string,
    files: PythonApiFile[],
    jobId: string,
    onHeartbeat?: () => Promise<void>
): Promise<GradingApiResponse> {
    const maxRetries = 3;
    const baseDelayMs = 1000;
    let lastError: Error | null = null;

    aiGradingLogger.info('Python API call started', {
        jobId,
        token_no: tokenNo,
        worksheet_name: worksheetName,
        maxRetries
    });

    captureGradingPipelineEvent('python_call_started', jobId, {
        jobId,
        tokenNo,
        worksheetName,
        filesCount: files.length,
        maxRetries
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (onHeartbeat) {
                await onHeartbeat();
            }

            const formData = new FormData();
            for (const file of files) {
                formData.append('files', file.buffer, {
                    filename: file.filename,
                    contentType: file.contentType
                });
            }

            const response = await scheduleGrading(() =>
                fetch(`${url}/process-worksheets?token_no=${encodeURIComponent(tokenNo)}&worksheet_name=${encodeURIComponent(worksheetName)}`, {
                    method: 'POST',
                    body: formData,
                    headers: formData.getHeaders()
                })
            );

            const data = (await response.json()) as GradingApiResponse;

            if (response.status >= 500 || response.status === 429) {
                throw new Error(`Server error: ${response.status}`);
            }

            if (!response.ok || !data.success) {
                throw new Error(data.error || `API error: ${response.status}`);
            }

            aiGradingLogger.info('Python API call completed', {
                jobId,
                token_no: tokenNo,
                worksheet_name: worksheetName,
                attempt,
                grade: data.grade
            });

            captureGradingPipelineEvent('python_call_succeeded', jobId, {
                jobId,
                tokenNo,
                worksheetName,
                attempt,
                grade: data.grade,
                gradePercentage: data.grade_percentage
            });

            return data;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const msg = lastError.message;
            if (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) {
                captureGradingPipelineEvent('python_call_non_retryable_failed', jobId, {
                    jobId,
                    tokenNo,
                    worksheetName,
                    attempt,
                    error: msg
                });
                throw lastError;
            }

            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                const jitter = delay * (0.7 + Math.random() * 0.6);
                captureGradingPipelineEvent('python_call_retry_scheduled', jobId, {
                    jobId,
                    tokenNo,
                    worksheetName,
                    attempt,
                    error: msg,
                    retryDelayMs: Math.round(jitter)
                });
                await new Promise((resolve) => setTimeout(resolve, jitter));
            }
        }
    }

    captureGradingPipelineEvent('python_call_retry_exhausted', jobId, {
        jobId,
        tokenNo,
        worksheetName,
        maxRetries,
        error: lastError?.message || 'Unknown error'
    });

    throw lastError;
}

async function loadJobWithImages(jobId: string): Promise<GradingJobWithImages> {
    const job = await prisma.gradingJob.findUnique({
        where: { id: jobId },
        include: {
            images: {
                orderBy: { pageNumber: 'asc' },
                select: {
                    id: true,
                    s3Key: true,
                    storageProvider: true,
                    pageNumber: true,
                    mimeType: true
                }
            }
        }
    });

    if (!job) {
        throw new Error(`Grading job not found: ${jobId}`);
    }

    if (!job.tokenNo || !job.worksheetName) {
        throw new Error(`Grading job ${jobId} is missing token or worksheet name`);
    }

    if (!job.images.length) {
        throw new Error(`Grading job ${jobId} has no images`);
    }

    return job as GradingJobWithImages;
}

export async function executeGradingJob(
    jobId: string,
    pythonApiUrl: string,
    options: ExecuteGradingJobOptions = {}
): Promise<ExecuteGradingJobResult> {
    const job = await loadJobWithImages(jobId);

    captureGradingPipelineEvent('execution_started', jobId, {
        jobId,
        pythonApiUrl,
        imagesCount: job.images.length
    });

    const files: PythonApiFile[] = [];
    for (const image of job.images) {
        const buffer = await downloadFromS3(image.s3Key, image.storageProvider === 'R2' ? 'r2' : 's3');
        files.push({
            filename: getImageFilename(image.pageNumber, image.mimeType),
            contentType: image.mimeType,
            buffer
        });
    }

    const pythonResponse = await callPythonApi(
        pythonApiUrl,
        job.tokenNo as string,
        job.worksheetName as string,
        files,
        jobId,
        options.onHeartbeat
    );
    const persisted = await persistWorksheetForGradingJob(job, pythonResponse, prisma, { jobId });

    try {
        await updateMasteryForWorksheet({
            worksheetId: persisted.worksheetId,
            studentId: job.studentId,
            worksheetNumber: job.worksheetNumber,
            grade: pythonResponse.grade ?? 0,
            outOf: pythonResponse.total_possible ?? 40,
            submittedOn: job.submittedOn
        });
    } catch (err) {
        console.error('[mastery] update failed (non-fatal):', err);
    }

    captureGradingPipelineEvent('execution_persisted', jobId, {
        jobId,
        worksheetId: persisted.worksheetId,
        action: persisted.action,
        grade: persisted.grade
    });

    return persisted;
}
