import config from '../config/env';
import { aiGradingLogger } from '../services/logger';
import {
    getGradingQueueClient,
    parseGradingQueueMessage,
    PulledQueueMessage
} from '../services/queue/gradingQueue';
import { runGradingJob } from '../services/gradingJobRunner';

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
        return true;
    }

    const result = await runGradingJob(parsed.jobId);

    if (result.status === 'skipped') {
        aiGradingLogger.debug('Skipped queue message; job not in QUEUED state', {
            jobId: parsed.jobId,
            messageId: message.id
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
        aiGradingLogger.info('Grading worker is disabled because queue mode is not cloudflare');
        await new Promise(() => {
            // Keep process alive to avoid restart loops in environments that always run worker dynos.
        });
        return;
    }

    aiGradingLogger.info('Grading worker started', {
        queueMode: config.grading.queueMode,
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
