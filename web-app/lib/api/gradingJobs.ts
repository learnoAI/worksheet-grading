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

export const gradingJobsAPI = {
    // Get teacher's jobs summary for today
    getTeacherJobsToday: async (): Promise<TeacherJobsResponse> => {
        return fetchAPI('/grading-jobs/teacher/today');
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
        maxAttempts: number = 60,
        intervalMs: number = 3000
    ): Promise<GradingJob> => {
        return new Promise((resolve, reject) => {
            let attempts = 0;

            const poll = async () => {
                try {
                    attempts++;
                    const response = await gradingJobsAPI.getJobStatus(jobId);
                    const job = response.job;

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
                    if (attempts < 3) {
                        setTimeout(poll, intervalMs);
                    } else {
                        reject(error);
                    }
                }
            };

            poll();
        });
    }
};
