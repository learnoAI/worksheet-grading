import { fetchAPI, API_BASE_URL } from './utils';
import { GradingJob, BatchJobStatus, ClassJobsStatus } from './types';

export interface TeacherJobsSummary {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    total: number;
}

export const gradingJobsAPI = {
    // Create single grading job (with file upload)
    createJob: async (formData: FormData): Promise<{ success: boolean; jobId: string; status: string }> => {
        // Get token from cookie
        const token = typeof document !== 'undefined'
            ? document.cookie
                .split('; ')
                .find(row => row.startsWith('token='))
                ?.split('=')[1]
            : undefined;

        const response = await fetch(`${API_BASE_URL}/grading-jobs/create`, {
            method: 'POST',
            body: formData,
            headers: {
                ...(token ? { 'Authorization': `Bearer ${token}` } : {})
            }
        });

        if (!response.ok) {
            const errorData = await response.json();
            throw new Error(errorData.error || 'Failed to create grading job');
        }

        return response.json();
    },

    // Create batch grading jobs
    createBatchJobs: async (data: {
        jobs: Array<{
            tokenNo: string;
            worksheetName: string;
            studentId: string;
            studentName: string;
            worksheetNumber: number;
            isRepeated: boolean;
            isCorrectGrade?: boolean;
            isIncorrectGrade?: boolean;
        }>;
        classId: string;
        submittedOn: string;
    }): Promise<{ success: boolean; batchId: string; jobIds: string[]; totalJobs: number }> => {
        return fetchAPI('/grading-jobs/create-batch', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    // Get job status
    getJobStatus: async (jobId: string): Promise<{ success: boolean; job: GradingJob }> => {
        return fetchAPI(`/grading-jobs/status/${jobId}`);
    },

    // Get batch status
    getBatchStatus: async (batchId: string): Promise<{ success: boolean; batch: BatchJobStatus }> => {
        return fetchAPI(`/grading-jobs/batch/${batchId}`);
    },

    // Get jobs by class and date
    getJobsByClass: async (classId: string, date: string): Promise<{ success: boolean } & ClassJobsStatus> => {
        return fetchAPI(`/grading-jobs/by-class/${classId}?date=${encodeURIComponent(date)}`);
    },

    // Get teacher's jobs summary (across all classes)
    getMyJobsSummary: async (): Promise<{ success: boolean } & TeacherJobsSummary> => {
        return fetchAPI('/grading-jobs/my-summary');
    },

    // Poll job status until completion
    pollJobStatus: async (
        jobId: string,
        onUpdate: (job: GradingJob) => void,
        maxAttempts: number = 120, // 10 minutes at 5 second intervals
        interval: number = 5000
    ): Promise<GradingJob> => {
        return new Promise((resolve, reject) => {
            let attempts = 0;

            const poll = async () => {
                try {
                    attempts++;
                    const response = await gradingJobsAPI.getJobStatus(jobId);
                    const job = response.job;

                    onUpdate(job);

                    // Check if job is finished
                    if (job.status === 'completed' || job.status === 'failed') {
                        resolve(job);
                        return;
                    }

                    // Check if max attempts reached
                    if (attempts >= maxAttempts) {
                        reject(new Error('Polling timeout - job is taking too long'));
                        return;
                    }

                    // Continue polling
                    setTimeout(poll, interval);
                } catch (error) {
                    reject(error);
                }
            };

            poll();
        });
    },

    // Poll batch status until completion
    pollBatchStatus: async (
        batchId: string,
        onUpdate: (batch: BatchJobStatus) => void,
        maxAttempts: number = 120,
        interval: number = 10000 // 10 seconds for batch
    ): Promise<BatchJobStatus> => {
        return new Promise((resolve, reject) => {
            let attempts = 0;

            const poll = async () => {
                try {
                    attempts++;
                    const response = await gradingJobsAPI.getBatchStatus(batchId);
                    const batch = response.batch;

                    onUpdate(batch);

                    // Check if all jobs are finished
                    const allFinished = batch.pending === 0 && batch.processing === 0;
                    if (allFinished) {
                        resolve(batch);
                        return;
                    }

                    // Check if max attempts reached
                    if (attempts >= maxAttempts) {
                        reject(new Error('Polling timeout - batch is taking too long'));
                        return;
                    }

                    // Continue polling
                    setTimeout(poll, interval);
                } catch (error) {
                    reject(error);
                }
            };

            poll();
        });
    }
};
