import config from '../config/env';
import { aiGradingLogger } from '../services/logger';
import {
    getGradingQueueClient,
    parseGradingQueueMessage,
    PulledQueueMessage
} from '../services/queue/gradingQueue';
import { runGradingJob } from '../services/gradingJobRunner';
import { captureGradingPipelineEvent, capturePosthogException } from '../services/posthogService';

// Message-level thresholds for new telemetry events.
// A 60s lag means the queue is absorbing more work than the consumer drains
// and is the earliest signal of backpressure before SLO breach.
const LAG_DETECTED_THRESHOLD_MS = 60_000;
// Cloudflare Queues attempts counter (1-based). We flag a message as poison
// the first time attempts exceeds this threshold so dashboards can split
// "flaky once" from "will never succeed".
const POISON_MESSAGE_ATTEMPTS_THRESHOLD = 3;

async function runWithConcurrency<T>(
    items: T[],
    limit: number,
    worker: (item: T) => Promise<void>
): Promise<void> {
    const concurrency = Math.max(1, Math.min(limit, items.length));
    let index = 0;

    const runners = Array.from({ length: concurrency }, async () => {
        while (true) {
            const currentIndex = index;
            index += 1;

            if (currentIndex >= items.length) {
                return;
            }

            await worker(items[currentIndex]);
        }
    });

    await Promise.all(runners);
}

async function processMessage(message: PulledQueueMessage): Promise<boolean> {
    let parsed;

    try {
        parsed = parseGradingQueueMessage(message.body);
    } catch (error) {
        aiGradingLogger.warn('Dropping invalid queue message', {
            messageId: message.id,
            error: error instanceof Error ? error.message : 'Invalid message'
        });
        captureGradingPipelineEvent('pull_worker_invalid_message_dropped', String(message.id), {
            messageId: message.id,
            error: error instanceof Error ? error.message : 'Invalid message'
        });
        return true;
    }

    captureGradingPipelineEvent('pull_worker_message_processing_started', parsed.jobId, {
        jobId: parsed.jobId,
        messageId: message.id,
        attempts: message.attempts
    });

    // Lag = time between the producer enqueuing and the consumer picking up.
    // A spike here precedes every SLO breach we've ever had, so catch it early.
    const enqueuedAtMs = Date.parse(parsed.enqueuedAt);
    if (Number.isFinite(enqueuedAtMs)) {
        const lagMs = Date.now() - enqueuedAtMs;
        if (lagMs >= LAG_DETECTED_THRESHOLD_MS) {
            captureGradingPipelineEvent('pull_worker_lag_detected', parsed.jobId, {
                jobId: parsed.jobId,
                messageId: message.id,
                lagMs,
                thresholdMs: LAG_DETECTED_THRESHOLD_MS
            });
        }
    }

    // Poison = same message retried past the DLQ threshold. Emit once per
    // crossing so alerting isn't flooded while the queue still holds the msg.
    if (message.attempts >= POISON_MESSAGE_ATTEMPTS_THRESHOLD) {
        captureGradingPipelineEvent('pull_worker_poison_message', parsed.jobId, {
            jobId: parsed.jobId,
            messageId: message.id,
            attempts: message.attempts,
            thresholdAttempts: POISON_MESSAGE_ATTEMPTS_THRESHOLD
        });
    }

    const result = await runGradingJob(parsed.jobId);

    if (result.status === 'skipped') {
        aiGradingLogger.debug('Skipped queue message; job not in QUEUED state', {
            jobId: parsed.jobId,
            messageId: message.id
        });
        captureGradingPipelineEvent('pull_worker_message_skipped', parsed.jobId, {
            jobId: parsed.jobId,
            messageId: message.id
        });
    }

    if (result.status === 'completed') {
        captureGradingPipelineEvent('pull_worker_message_completed', parsed.jobId, {
            jobId: parsed.jobId,
            messageId: message.id,
            worksheetId: result.worksheetId
        });
    }

    if (result.status === 'failed') {
        captureGradingPipelineEvent('pull_worker_message_failed', parsed.jobId, {
            jobId: parsed.jobId,
            messageId: message.id,
            error: result.errorMessage
        });
    }

    return true;
}

async function consumeOnce(): Promise<void> {
    const queueClient = getGradingQueueClient();
    const messages = await queueClient.pull(config.grading.queuePollBatchSize);

    if (!messages.length) {
        return;
    }

    const ackTokens: string[] = [];

    await runWithConcurrency(messages, config.grading.workerConcurrency, async (message) => {
        try {
            const shouldAck = await processMessage(message);
            if (shouldAck) {
                ackTokens.push(message.ackToken);
            }
        } catch (error) {
            aiGradingLogger.error(
                'Queue message processing failed',
                {
                    messageId: message.id,
                    error: error instanceof Error ? error.message : 'Unknown error'
                },
                error instanceof Error ? error : undefined
            );
        }
    });

    if (ackTokens.length > 0) {
        await queueClient.ack(ackTokens);
    }
}

export async function startGradingWorker(): Promise<void> {
    if (config.grading.queueMode !== 'cloudflare') {
        aiGradingLogger.info('Grading pull worker is disabled because queue mode is not cloudflare');
        await new Promise(() => {
            // Keep process alive to avoid restart loops in environments that always run worker dynos.
        });
        return;
    }

    if (!config.grading.pullWorkerEnabled) {
        aiGradingLogger.info('Grading pull worker is disabled (GRADING_PULL_WORKER_ENABLED=false)');
        await new Promise(() => {
            // Keep process alive to avoid restart loops in environments that always run worker dynos.
        });
        return;
    }

    aiGradingLogger.info('Grading worker started', {
        queueMode: config.grading.queueMode,
        pullWorkerEnabled: config.grading.pullWorkerEnabled,
        workerConcurrency: config.grading.workerConcurrency,
        pollBatchSize: config.grading.queuePollBatchSize,
        pollIntervalMs: config.grading.queuePollIntervalMs
    });

    while (true) {
        try {
            await consumeOnce();
        } catch (error) {
            aiGradingLogger.error(
                'Worker consume loop failed',
                { error: error instanceof Error ? error.message : 'Unknown error' },
                error instanceof Error ? error : undefined
            );
            capturePosthogException(error, { distinctId: 'pull-worker', stage: 'pull_worker_consume_loop_crashed' });
        }

        await new Promise((resolve) => setTimeout(resolve, config.grading.queuePollIntervalMs));
    }
}

if (require.main === module) {
    void startGradingWorker().catch((error) => {
        const message = error instanceof Error ? error.message : 'Unknown worker error';
        console.error('Grading worker crashed:', message);
        process.exit(1);
    });
}
