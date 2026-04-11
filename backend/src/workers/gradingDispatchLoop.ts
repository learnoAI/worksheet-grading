import { GradingJobStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import config from '../config/env';
import { aiGradingLogger } from '../services/logger';
import { captureGradingPipelineEvent } from '../services/posthogService';
import {
    createGradingQueueMessage,
    getGradingQueueClient
} from '../services/queue/gradingQueue';

function computeDispatchBackoffMs(attemptCount: number): number {
    const base = 2000;
    const cappedAttempt = Math.min(Math.max(attemptCount, 0), 6);
    return base * Math.pow(2, cappedAttempt);
}

function shouldRetryDispatch(lastErrorAt: Date | null, attemptCount: number): boolean {
    if (!lastErrorAt) {
        return true;
    }

    const waitMs = computeDispatchBackoffMs(attemptCount);
    return Date.now() - lastErrorAt.getTime() >= waitMs;
}

async function dispatchPendingJobs(): Promise<void> {
    const queueClient = getGradingQueueClient();
    const staleCutoff = new Date(Date.now() - config.grading.staleProcessingMs);

    const staleRequeued = await prisma.gradingJob.updateMany({
        where: {
            status: GradingJobStatus.PROCESSING,
            OR: [
                { lastHeartbeatAt: { lt: staleCutoff } },
                {
                    lastHeartbeatAt: null,
                    startedAt: { lt: staleCutoff }
                },
                {
                    lastHeartbeatAt: null,
                    startedAt: null,
                    updatedAt: { lt: staleCutoff }
                }
            ]
        },
        data: {
            status: GradingJobStatus.QUEUED,
            enqueuedAt: null,
            leaseId: null,
            startedAt: null,
            lastHeartbeatAt: null,
            completedAt: null,
            dispatchError: 'Requeued by dispatch loop after stale heartbeat',
            lastErrorAt: new Date()
        }
    });

    if (staleRequeued.count > 0) {
        captureGradingPipelineEvent('dispatch_loop_stale_processing_requeued', 'dispatch-loop', {
            count: staleRequeued.count,
            staleProcessingMs: config.grading.staleProcessingMs
        });
    }

    const pendingJobs = await prisma.gradingJob.findMany({
        where: {
            status: GradingJobStatus.QUEUED,
            enqueuedAt: null
        },
        orderBy: { createdAt: 'asc' },
        take: config.grading.queuePollBatchSize,
        select: {
            id: true,
            attemptCount: true,
            lastErrorAt: true
        }
    });

    for (const job of pendingJobs) {
        if (!shouldRetryDispatch(job.lastErrorAt, job.attemptCount)) {
            continue;
        }

        captureGradingPipelineEvent('dispatch_loop_retry_attempt', job.id, {
            jobId: job.id,
            attemptCount: job.attemptCount
        });

        const queueMessage = createGradingQueueMessage(job.id);

        try {
            await queueClient.publish(queueMessage);
            await prisma.gradingJob.update({
                where: { id: job.id },
                data: {
                    enqueuedAt: new Date(queueMessage.enqueuedAt),
                    dispatchError: null
                }
            });

            captureGradingPipelineEvent('dispatch_loop_retry_succeeded', job.id, {
                jobId: job.id,
                queuedAt: queueMessage.enqueuedAt
            });
        } catch (error) {
            const dispatchError = error instanceof Error ? error.message : 'Failed to publish queue message';

            aiGradingLogger.warn('Dispatch retry failed', {
                jobId: job.id,
                error: dispatchError
            });

            await prisma.gradingJob.update({
                where: { id: job.id },
                data: {
                    dispatchError,
                    lastErrorAt: new Date(),
                    attemptCount: {
                        increment: 1
                    }
                }
            });

            captureGradingPipelineEvent('dispatch_loop_retry_failed', job.id, {
                jobId: job.id,
                error: dispatchError
            });
        }
    }
}

export function startGradingDispatchLoop(): void {
    if (config.grading.queueMode !== 'cloudflare') {
        return;
    }

    let running = false;

    const tick = async () => {
        if (running) {
            return;
        }

        running = true;
        try {
            await dispatchPendingJobs();
        } catch (error) {
            aiGradingLogger.error(
                'Dispatch loop iteration failed',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                error instanceof Error ? error : undefined
            );
            // A silently-dead dispatch loop is the single worst failure mode in
            // this queue system — every queued job stalls. Emit an explicit
            // event so the first crash is alertable, not just a buried log line.
            captureGradingPipelineEvent('dispatch_loop_crashed', 'dispatch-loop', {
                errorName: error instanceof Error ? error.name : 'UnknownError',
                errorMessage: error instanceof Error ? error.message : String(error)
            });
        } finally {
            running = false;
        }
    };

    void tick();
    setInterval(() => {
        void tick();
    }, config.grading.dispatchLoopIntervalMs);
}

if (require.main === module) {
    startGradingDispatchLoop();
}
