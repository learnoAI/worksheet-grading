import { Request, Response } from 'express';
import prisma from '../utils/prisma';

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

        // Get start and end of today
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
            select: {
                id: true,
                studentName: true,
                worksheetNumber: true,
                status: true,
                worksheetId: true,
                errorMessage: true,
                createdAt: true,
                completedAt: true
            }
        });

        // Calculate summary
        const queued = jobs.filter(j => j.status === 'QUEUED').length;
        const processing = jobs.filter(j => j.status === 'PROCESSING').length;
        const completed = jobs.filter(j => j.status === 'COMPLETED').length;
        const failed = jobs.filter(j => j.status === 'FAILED').length;

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
                // Filter by submittedOn (the date the worksheet is for) not createdAt
                submittedOn: {
                    gte: queryDate,
                    lt: nextDay
                }
            },
            orderBy: { createdAt: 'desc' },
            select: {
                id: true,
                studentId: true,
                studentName: true,
                worksheetNumber: true,
                status: true,
                worksheetId: true,
                errorMessage: true,
                createdAt: true,
                completedAt: true,
                submittedOn: true
            }
        });

        // Calculate summary
        const queued = jobs.filter(j => j.status === 'QUEUED').length;
        const processing = jobs.filter(j => j.status === 'PROCESSING').length;
        const completed = jobs.filter(j => j.status === 'COMPLETED').length;
        const failed = jobs.filter(j => j.status === 'FAILED').length;

        return res.json({
            success: true,
            summary: { queued, processing, completed, failed, total: jobs.length },
            jobs
        });
    } catch (error) {
        console.error('Error getting jobs by class:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};

/**
 * Get single job status
 * @route GET /api/grading-jobs/:jobId
 */
export const getJobStatus = async (req: Request, res: Response) => {
    try {
        const { jobId } = req.params;

        const job = await prisma.gradingJob.findUnique({
            where: { id: jobId },
            select: {
                id: true,
                studentId: true,
                studentName: true,
                worksheetNumber: true,
                status: true,
                worksheetId: true,
                errorMessage: true,
                createdAt: true,
                completedAt: true
            }
        });

        if (!job) {
            return res.status(404).json({ message: 'Job not found' });
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
            select: {
                id: true,
                studentId: true,
                studentName: true,
                worksheetNumber: true,
                status: true,
                worksheetId: true,
                errorMessage: true,
                createdAt: true,
                completedAt: true
            }
        });

        return res.json({ success: true, jobs });
    } catch (error) {
        console.error('Error getting batch job status:', error);
        return res.status(500).json({ message: 'Server error' });
    }
};
