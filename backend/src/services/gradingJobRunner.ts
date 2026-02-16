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
import { captureGradingPipelineEvent } from './posthogService';

export interface RunGradingJobResult {
    status: 'completed' | 'failed' | 'skipped';
    worksheetId?: string;
    errorMessage?: string;
}

export async function runGradingJob(jobId: string): Promise<RunGradingJobResult> {
    const leaseId = await acquireGradingJobLease(jobId);

    if (!leaseId) {
        captureGradingPipelineEvent('runner_skipped_lease_not_acquired', jobId, { jobId });
        return { status: 'skipped' };
    }

    captureGradingPipelineEvent('runner_started', jobId, {
        jobId,
        leaseId,
        queueMode: config.grading.queueMode
    });

    const heartbeatTimer = setInterval(() => {
        void touchGradingJobHeartbeat(jobId, leaseId).catch(() => {
            // Best effort; stale watchdog handles recovery.
        });
    }, config.grading.heartbeatIntervalMs);

    try {
        const result = await executeGradingJob(jobId, config.pythonApiUrl, {
            onHeartbeat: async () => {
                await touchGradingJobHeartbeat(jobId, leaseId);
            }
        });

        const completed = await markGradingJobCompleted(jobId, leaseId, result.worksheetId);
        if (!completed) {
            // Another worker owns the lease (or the job was requeued/recovered). Do not overwrite.
            captureGradingPipelineEvent('runner_skipped_lease_lost_before_complete', jobId, {
                jobId,
                leaseId
            });
            return { status: 'skipped' };
        }

        aiGradingLogger.info('Grading job completed', {
            jobId,
            worksheetId: result.worksheetId,
            action: result.action,
            grade: result.grade
        });

        captureGradingPipelineEvent('runner_completed', jobId, {
            jobId,
            leaseId,
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
            const failed = await markGradingJobFailed(jobId, leaseId, message);
            if (!failed) {
                // Lease lost; do not overwrite job state.
                captureGradingPipelineEvent('runner_skipped_lease_lost_before_fail', jobId, {
                    jobId,
                    leaseId,
                    error: message
                });
                return { status: 'skipped' };
            }
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

        captureGradingPipelineEvent('runner_failed', jobId, {
            jobId,
            leaseId,
            error: message
        });

        return {
            status: 'failed',
            errorMessage: message
        };
    } finally {
        clearInterval(heartbeatTimer);
    }
}
