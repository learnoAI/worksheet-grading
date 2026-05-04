import { GradingJobStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import prisma from '../utils/prisma';

export async function requeueGradingJobForRetry(jobId: string, leaseId: string, reason?: string): Promise<boolean> {
    const now = new Date();
    const result = await prisma.gradingJob.updateMany({
        where: {
            id: jobId,
            status: GradingJobStatus.PROCESSING,
            leaseId
        },
        data: {
            status: GradingJobStatus.QUEUED,
            // Keep enqueuedAt intact: the message is already in Cloudflare Queues and will be retried there.
            // If we cleared enqueuedAt, the DO dispatch loop could republish duplicates.
            dispatchError: reason || null,
            leaseId: null,
            startedAt: null,
            lastHeartbeatAt: null,
            completedAt: null,
            lastErrorAt: now,
            errorMessage: null
        }
    });

    return result.count > 0;
}

export async function acquireGradingJobLease(jobId: string): Promise<string | null> {
    const leaseId = randomUUID();
    const now = new Date();
    const result = await prisma.gradingJob.updateMany({
        where: {
            id: jobId,
            status: GradingJobStatus.QUEUED
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
            attemptCount: {
                increment: 1
            }
        }
    });

    return result.count > 0 ? leaseId : null;
}

export async function touchGradingJobHeartbeat(jobId: string, leaseId: string): Promise<boolean> {
    const result = await prisma.gradingJob.updateMany({
        where: {
            id: jobId,
            status: GradingJobStatus.PROCESSING,
            leaseId
        },
        data: {
            lastHeartbeatAt: new Date()
        }
    });

    return result.count > 0;
}

export async function markGradingJobCompleted(jobId: string, leaseId: string, worksheetId: string): Promise<boolean> {
    const now = new Date();
    const result = await prisma.gradingJob.updateMany({
        where: {
            id: jobId,
            status: GradingJobStatus.PROCESSING,
            leaseId
        },
        data: {
            status: GradingJobStatus.COMPLETED,
            worksheetId,
            completedAt: now,
            lastHeartbeatAt: now,
            leaseId: null,
            errorMessage: null,
            dispatchError: null
        }
    });

    return result.count > 0;
}

export async function markGradingJobFailed(jobId: string, leaseId: string, errorMessage: string): Promise<boolean> {
    const now = new Date();
    const result = await prisma.gradingJob.updateMany({
        where: {
            id: jobId,
            status: GradingJobStatus.PROCESSING,
            leaseId
        },
        data: {
            status: GradingJobStatus.FAILED,
            errorMessage,
            lastErrorAt: now,
            completedAt: now,
            lastHeartbeatAt: now,
            leaseId: null
        }
    });

    return result.count > 0;
}

export async function requeueGradingJob(jobId: string, reason?: string): Promise<void> {
    await prisma.gradingJob.update({
        where: { id: jobId },
        data: {
            status: GradingJobStatus.QUEUED,
            enqueuedAt: null,
            dispatchError: reason || null,
            leaseId: null,
            startedAt: null,
            lastHeartbeatAt: null,
            completedAt: null
        }
    });
}

export async function resetQueuedJobDispatch(jobId: string, reason?: string): Promise<boolean> {
    const now = new Date();
    const result = await prisma.gradingJob.updateMany({
        where: {
            id: jobId,
            status: GradingJobStatus.QUEUED,
            leaseId: null
        },
        data: {
            enqueuedAt: null,
            dispatchError: reason || null,
            lastErrorAt: now,
            startedAt: null,
            lastHeartbeatAt: null,
            completedAt: null,
            errorMessage: null
        }
    });

    return result.count > 0;
}
