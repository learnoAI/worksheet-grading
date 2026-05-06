import { fetchAPI } from './utils';

export interface GradingJobSummary {
    queued: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
}

export interface GradingJob {
    id: string;
    studentId?: string;
    studentName: string;
    worksheetNumber: number;
    classId?: string;
    status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    worksheetId?: string;
    errorMessage?: string;
    dispatchError?: string;
    attemptCount?: number;
    enqueuedAt?: string;
    startedAt?: string;
    lastHeartbeatAt?: string;
    lastErrorAt?: string;
    createdAt: string;
    completedAt?: string;
}

export interface TeacherJobsResponse {
    success: boolean;
    summary: GradingJobSummary;
    jobs: GradingJob[];
}

export interface AdminGradingDashboardResponse {
    success: boolean;
    minDate: string;
    dateRange: {
        startDate: string;
        endDate: string;
    };
    current: {
        generatedAt: string;
        queued: number;
        processing: number;
        inProgress: number;
        activeProcessing: number;
        staleProcessing: number;
        noHeartbeat: number;
        avgProcessingSeconds: number | null;
        oldestProcessingSeconds: number | null;
        byClass: Array<{
            className: string;
            schoolName: string;
            queued: number;
            processing: number;
            total: number;
        }>;
    };
    historical: {
        summary: {
            total: number;
            queued: number;
            processing: number;
            completed: number;
            failed: number;
            successRate: number | null;
            failureRate: number | null;
            avgJobSeconds: number | null;
            p75JobSeconds: number | null;
            p90JobSeconds: number | null;
            p95JobSeconds: number | null;
            p99JobSeconds: number | null;
            avgSuccessSeconds: number | null;
            avgFailureSeconds: number | null;
            avgAttempts: number | null;
        };
        byDay: Array<{
            date: string;
            total: number;
            queued: number;
            processing: number;
            completed: number;
            failed: number;
            successRate: number | null;
            avgJobSeconds: number | null;
        }>;
        failureReasons: Array<{
            reason: string;
            count: number;
            latestAt: string | null;
            examples: Array<{
                id: string;
                worksheetNumber: number;
                studentName: string;
                className: string;
                schoolName: string;
                attemptCount: number;
            }>;
        }>;
        recentFailures: Array<{
            id: string;
            worksheetNumber: number;
            studentName: string;
            className: string;
            schoolName: string;
            reason: string;
            errorMessage: string | null;
            dispatchError: string | null;
            attemptCount: number;
            createdAt: string;
            startedAt: string | null;
            completedAt: string | null;
            lastErrorAt: string | null;
            durationSeconds: number | null;
        }>;
    };
}

export const gradingJobsAPI = {
    // Get teacher's jobs summary for today
    getTeacherJobsToday: async (): Promise<TeacherJobsResponse> => {
        return fetchAPI('/grading-jobs/teacher/today');
    },

    getAdminDashboard: async (startDate: string, endDate: string): Promise<AdminGradingDashboardResponse> => {
        const params = new URLSearchParams({ startDate, endDate });
        return fetchAPI(`/grading-jobs/admin/dashboard?${params.toString()}`);
    },

    // Get jobs by class and date (for checking active jobs on page load)
    getJobsByClassAndDate: async (classId: string, date: string): Promise<TeacherJobsResponse> => {
        return fetchAPI(`/grading-jobs/class/${classId}?date=${encodeURIComponent(date)}`);
    },

    // Get single job status
    getJobStatus: async (jobId: string): Promise<{ success: boolean; job: GradingJob }> => {
        return fetchAPI(`/grading-jobs/${jobId}`);
    },

    // Get multiple job statuses
    getBatchJobStatus: async (jobIds: string[]): Promise<{ success: boolean; jobs: GradingJob[] }> => {
        return fetchAPI('/grading-jobs/batch-status', {
            method: 'POST',
            body: JSON.stringify({ jobIds })
        });
    },

    // Poll job status until completion
    pollJobStatus: async (
        jobId: string,
        onUpdate: (job: GradingJob) => void,
        // AI grading can take several minutes under load (queue backlog + model runtime).
        // Keep polling long enough that "AI Grade All" doesn't time out prematurely.
        maxAttempts: number = 600,
        intervalMs: number = 3000,
        maxConsecutiveErrors: number = 30
    ): Promise<GradingJob> => {
        return new Promise((resolve, reject) => {
            let attempts = 0;
            let consecutiveErrors = 0;

            const poll = async () => {
                try {
                    attempts++;
                    const response = await gradingJobsAPI.getJobStatus(jobId);
                    const job = response.job;
                    consecutiveErrors = 0;

                    onUpdate(job);

                    if (job.status === 'COMPLETED' || job.status === 'FAILED') {
                        resolve(job);
                        return;
                    }

                    if (attempts >= maxAttempts) {
                        reject(new Error('Polling timeout'));
                        return;
                    }

                    setTimeout(poll, intervalMs);
                } catch (error) {
                    consecutiveErrors++;

                    const message = error instanceof Error ? error.message : String(error);
                    const isJobNotFound = message.toLowerCase().includes('job not found');

                    if (isJobNotFound && consecutiveErrors >= 3) {
                        reject(error);
                        return;
                    }

                    if (consecutiveErrors >= maxConsecutiveErrors) {
                        reject(
                            new Error(
                                `Polling interrupted after ${maxConsecutiveErrors} consecutive errors: ${message}`
                            )
                        );
                        return;
                    }

                    if (attempts >= maxAttempts) {
                        reject(new Error('Polling timeout'));
                        return;
                    }

                    setTimeout(poll, intervalMs);
                }
            };

            poll();
        });
    }
};
