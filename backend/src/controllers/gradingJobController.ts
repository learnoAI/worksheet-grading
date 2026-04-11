import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { GradingJobStatus } from '@prisma/client';
import config from '../config/env';

const PROCESSING_STALE_MS = config.grading.staleProcessingMs;
const VERY_STALE_JOB_MS = 24 * 60 * 60 * 1000;

const jobSelect = {
    id: true,
    studentId: true,
    studentName: true,
    worksheetNumber: true,
    status: true,
    worksheetId: true,
    errorMessage: true,
    dispatchError: true,
    attemptCount: true,
    enqueuedAt: true,
    startedAt: true,
    lastHeartbeatAt: true,
    lastErrorAt: true,
    createdAt: true,
    completedAt: true,
    submittedOn: true,
    classId: true
};

type RecoverableJob = {
    id: string;
    studentId: string | null;
    classId: string | null;
    worksheetNumber: number;
    submittedOn: Date | null;
    createdAt: Date;
    status: GradingJobStatus;
    enqueuedAt: Date | null;
    startedAt: Date | null;
    lastHeartbeatAt: Date | null;
};

type SelectedGradingJob = RecoverableJob & {
    studentName: string;
    worksheetId: string | null;
    errorMessage: string | null;
    dispatchError: string | null;
    attemptCount: number;
    lastErrorAt: Date | null;
    completedAt: Date | null;
};

function toRecoverableJob(job: SelectedGradingJob): RecoverableJob {
    return {
        id: job.id,
        studentId: job.studentId,
        classId: job.classId,
        worksheetNumber: job.worksheetNumber,
        submittedOn: job.submittedOn,
        createdAt: job.createdAt,
        status: job.status,
        enqueuedAt: job.enqueuedAt,
        startedAt: job.startedAt,
        lastHeartbeatAt: job.lastHeartbeatAt
    };
}

async function findMatchingWorksheet(job: RecoverableJob): Promise<string | null> {
    if (!job.studentId || !job.classId || !job.submittedOn) {
        return null;
    }

    const dayStart = new Date(job.submittedOn);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(job.submittedOn);
    dayEnd.setHours(23, 59, 59, 999);

    const worksheet = await prisma.worksheet.findFirst({
        where: {
            studentId: job.studentId,
            classId: job.classId,
            submittedOn: { gte: dayStart, lte: dayEnd },
            worksheetNumber: job.worksheetNumber
        },
        select: { id: true }
    });

    return worksheet?.id || null;
}

async function recoverStuckJob(job: RecoverableJob): Promise<{
    id: string;
    status: GradingJobStatus;
    worksheetId: string | null;
    recovered: boolean;
}> {
    if (job.status !== GradingJobStatus.QUEUED && job.status !== GradingJobStatus.PROCESSING) {
        return { id: job.id, status: job.status, worksheetId: null, recovered: false };
    }

    const worksheetId = await findMatchingWorksheet(job);
    if (worksheetId) {
        await prisma.gradingJob.update({
            where: { id: job.id },
            data: {
                status: GradingJobStatus.COMPLETED,
                worksheetId,
                completedAt: new Date(),
                dispatchError: null,
                errorMessage: null,
                leaseId: null
            }
        });

        return {
            id: job.id,
            status: GradingJobStatus.COMPLETED,
            worksheetId,
            recovered: true
        };
    }

    if (job.status === GradingJobStatus.PROCESSING) {
        const heartbeatTime = job.lastHeartbeatAt || job.startedAt || job.createdAt;
        const stale = Date.now() - heartbeatTime.getTime() > PROCESSING_STALE_MS;

        if (stale) {
            await prisma.gradingJob.update({
                where: { id: job.id },
                data: {
                    status: GradingJobStatus.QUEUED,
                    enqueuedAt: null,
                    leaseId: null,
                    startedAt: null,
                    lastHeartbeatAt: null,
                    completedAt: null,
                    dispatchError: 'Requeued after stale processing heartbeat',
                    lastErrorAt: new Date()
                }
            });

            return {
                id: job.id,
                status: GradingJobStatus.QUEUED,
                worksheetId: null,
                recovered: true
            };
        }
    }

    if (Date.now() - job.createdAt.getTime() > VERY_STALE_JOB_MS) {
        await prisma.gradingJob.update({
            where: { id: job.id },
            data: {
                status: GradingJobStatus.FAILED,
                errorMessage: 'Job timed out without completion',
                completedAt: new Date(),
                lastErrorAt: new Date(),
                leaseId: null
            }
        });

        return {
            id: job.id,
            status: GradingJobStatus.FAILED,
            worksheetId: null,
            recovered: true
        };
    }

    return { id: job.id, status: job.status, worksheetId: null, recovered: false };
}

async function recoverJobForResponse(job: SelectedGradingJob): Promise<SelectedGradingJob> {
    // Some legacy/partial deployments may mark the job completed without persisting worksheetId.
    // Recover it opportunistically so clients using batch polling see the same data as single-job polling.
    if (job.status === GradingJobStatus.COMPLETED && !job.worksheetId) {
        const worksheetId = await findMatchingWorksheet(toRecoverableJob(job));

        if (worksheetId) {
            await prisma.gradingJob.update({
                where: { id: job.id },
                data: {
                    worksheetId,
                    dispatchError: null,
                    errorMessage: null
                }
            });

            return {
                ...job,
                worksheetId,
                dispatchError: null,
                errorMessage: null
            };
        }
    }

    if (job.status !== GradingJobStatus.QUEUED && job.status !== GradingJobStatus.PROCESSING) {
        return job;
    }

    const recovery = await recoverStuckJob(toRecoverableJob(job));
    if (!recovery.recovered) {
        return job;
    }

    return {
        ...job,
        status: recovery.status,
        worksheetId: recovery.worksheetId || job.worksheetId
    };
}

/**
 * Get grading jobs for a teacher (today's jobs)
 * @route GET /api/grading-jobs/teacher/today
 */
export const getTeacherJobsToday = async (req: Request, res: Response) => {
    try {
        const teacherId = req.user?.userId;
        if (!teacherId) {
            return res.status(401).json({ message: 'Unauthorized' });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const tomorrow = new Date(today);
        tomorrow.setDate(tomorrow.getDate() + 1);

        const jobs = await prisma.gradingJob.findMany({
            where: {
                teacherId,
                createdAt: {
                    gte: today,
                    lt: tomorrow
                }
            },
            orderBy: { createdAt: 'desc' },
            select: jobSelect
        });

        const queued = jobs.filter((j) => j.status === GradingJobStatus.QUEUED).length;
        const processing = jobs.filter((j) => j.status === GradingJobStatus.PROCESSING).length;
        const completed = jobs.filter((j) => j.status === GradingJobStatus.COMPLETED).length;
        const failed = jobs.filter((j) => j.status === GradingJobStatus.FAILED).length;

        return res.json({
            success: true,
            summary: { queued, processing, completed, failed, total: jobs.length },
            jobs
        });
    } catch (error) {
        console.error('Error getting teacher jobs:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * Get grading jobs by class and date
 * Includes automatic recovery of stuck jobs
 * @route GET /api/grading-jobs/class/:classId
 */
export const getJobsByClass = async (req: Request, res: Response) => {
    try {
        const { classId } = req.params;
        const { date } = req.query;

        const queryDate = date ? new Date(date as string) : new Date();
        queryDate.setHours(0, 0, 0, 0);
        const nextDay = new Date(queryDate);
        nextDay.setDate(nextDay.getDate() + 1);

        const jobs = await prisma.gradingJob.findMany({
            where: {
                classId,
                submittedOn: {
                    gte: queryDate,
                    lt: nextDay
                }
            },
            orderBy: { createdAt: 'desc' },
            select: jobSelect
        });

        const updatedJobs = await Promise.all(jobs.map(recoverJobForResponse));

        const queued = updatedJobs.filter((j) => j.status === GradingJobStatus.QUEUED).length;
        const processing = updatedJobs.filter((j) => j.status === GradingJobStatus.PROCESSING).length;
        const completed = updatedJobs.filter((j) => j.status === GradingJobStatus.COMPLETED).length;
        const failed = updatedJobs.filter((j) => j.status === GradingJobStatus.FAILED).length;

        return res.json({
            success: true,
            summary: { queued, processing, completed, failed, total: updatedJobs.length },
            jobs: updatedJobs
        });
    } catch (error) {
        console.error('Error getting jobs by class:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * Get single job status
 * Includes automatic recovery of stuck jobs
 * @route GET /api/grading-jobs/:jobId
 */
export const getJobStatus = async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

        const job = await prisma.gradingJob.findUnique({
            where: { id: jobId },
            select: jobSelect
        });

        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
        }

        const recoveredJob = await recoverJobForResponse(job);
        if (recoveredJob !== job) {
            return res.json({ success: true, job: recoveredJob });
        }

        return res.json({ success: true, job });
    } catch (error) {
        console.error('Error getting job status:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * Get multiple job statuses (for polling)
 * @route POST /api/grading-jobs/batch-status
 */
export const getBatchJobStatus = async (req: Request, res: Response) => {
    try {
        const { jobIds } = req.body;

        if (!jobIds || !Array.isArray(jobIds)) {
            return res.status(400).json({ message: 'jobIds array required' });
        }

        const jobs = await prisma.gradingJob.findMany({
            where: { id: { in: jobIds } },
            select: jobSelect
        });

        const recoveredJobs = await Promise.all(jobs.map(recoverJobForResponse));

        return res.json({ success: true, jobs: recoveredJobs });
    } catch (error) {
        console.error('Error getting batch job status:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};
