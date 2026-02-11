import config from '../config/env';
import { executeGradingJob } from './gradingExecutionService';
import {
    acquireGradingJobLease,
    markGradingJobCompleted,
    markGradingJobFailed,
    touchGradingJobHeartbeat
} from './gradingJobLifecycleService';
import { logError } from './errorLogService';
import { aiGradingLogger } from './logger';

export interface RunGradingJobResult {
    status: 'completed' | 'failed' | 'skipped';
    worksheetId?: string;
    errorMessage?: string;
}

export async function runGradingJob(jobId: string): Promise<RunGradingJobResult> {
    const leaseAcquired = await acquireGradingJobLease(jobId);

    if (!leaseAcquired) {
        return { status: 'skipped' };
    }

    const heartbeatTimer = setInterval(() => {
        void touchGradingJobHeartbeat(jobId).catch(() => {
            // Best effort; stale watchdog handles recovery.
        });
    }, config.grading.heartbeatIntervalMs);

    try {
        const result = await executeGradingJob(jobId, config.pythonApiUrl, {
            onHeartbeat: async () => {
                await touchGradingJobHeartbeat(jobId);
            }
        });

        await markGradingJobCompleted(jobId, result.worksheetId);

        aiGradingLogger.info('Grading job completed', {
            jobId,
            worksheetId: result.worksheetId,
            action: result.action,
            grade: result.grade
        });

        return {
            status: 'completed',
            worksheetId: result.worksheetId
        };
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown grading error';

        try {
            await markGradingJobFailed(jobId, message);
        } catch (markError) {
            const persistenceError = markError instanceof Error ? markError.message : 'Unknown persistence error';
            throw new Error(`Failed to persist grading failure for job ${jobId}: ${persistenceError}`);
        }

        await logError('grading-runner', error instanceof Error ? error : new Error(message), {
            jobId
        }).catch(() => {
            // best effort
        });

        aiGradingLogger.error('Grading job failed', {
            jobId,
            error: message
        }, error instanceof Error ? error : undefined);

        return {
            status: 'failed',
            errorMessage: message
        };
    } finally {
        clearInterval(heartbeatTimer);
    }
}
