import { GradingJobStatus } from '@prisma/client';
import prisma from '../utils/prisma';

export async function acquireGradingJobLease(jobId: string): Promise<boolean> {
    const now = new Date();
    const result = await prisma.gradingJob.updateMany({
        where: {
            id: jobId,
            status: GradingJobStatus.QUEUED
        },
        data: {
            status: GradingJobStatus.PROCESSING,
            startedAt: now,
            lastHeartbeatAt: now,
            lastErrorAt: null,
            errorMessage: null,
            dispatchError: null,
            completedAt: null,
            attemptCount: {
                increment: 1
            }
        }
    });

    return result.count > 0;
}

export async function touchGradingJobHeartbeat(jobId: string): Promise<void> {
    await prisma.gradingJob.updateMany({
        where: {
            id: jobId,
            status: GradingJobStatus.PROCESSING
        },
        data: {
            lastHeartbeatAt: new Date()
        }
    });
}

export async function markGradingJobCompleted(jobId: string, worksheetId: string): Promise<void> {
    const now = new Date();
    await prisma.gradingJob.update({
        where: { id: jobId },
        data: {
            status: GradingJobStatus.COMPLETED,
            worksheetId,
            completedAt: now,
            lastHeartbeatAt: now,
            errorMessage: null,
            dispatchError: null
        }
    });
}

export async function markGradingJobFailed(jobId: string, errorMessage: string): Promise<void> {
    const now = new Date();
    await prisma.gradingJob.update({
        where: { id: jobId },
        data: {
            status: GradingJobStatus.FAILED,
            errorMessage,
            lastErrorAt: now,
            completedAt: now,
            lastHeartbeatAt: now
        }
    });
}

export async function requeueGradingJob(jobId: string, reason?: string): Promise<void> {
    await prisma.gradingJob.update({
        where: { id: jobId },
        data: {
            status: GradingJobStatus.QUEUED,
            enqueuedAt: null,
            dispatchError: reason || null,
            startedAt: null,
            lastHeartbeatAt: null,
            completedAt: null
        }
    });
}
