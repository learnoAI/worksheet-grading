import { Hono } from 'hono';
import { GradingJobStatus, type PrismaClient } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import { capturePosthogException } from '../adapters/posthog';
import type { AppBindings, WorkerEnv } from '../types';

/**
 * Grading job routes — port of `backend/src/routes/gradingJobRoutes.ts`
 * (controller: `backend/src/controllers/gradingJobController.ts`).
 *
 * Mounted under `/api/grading-jobs`. Covers:
 *   GET  /teacher/today    — current teacher's jobs for today
 *   GET  /class/:classId   — jobs for a class on a given date (+ recovery)
 *   GET  /:jobId           — single job status (+ recovery)
 *   POST /batch-status     — batch polling endpoint (+ recovery)
 *
 * "Recovery" means: if a job is stuck in QUEUED/PROCESSING past the stale
 * window, try to reconcile it against the worksheets table before
 * returning to the client. This mirrors the Express controller behavior
 * so legacy clients see no response-shape change.
 *
 * Route order: `/teacher/today` is declared before `/:jobId` so the
 * literal path is not swallowed by the param route.
 */

const DEFAULT_STALE_PROCESSING_MS = 20 * 60 * 1000; // 20 min
const VERY_STALE_JOB_MS = 24 * 60 * 60 * 1000;

function staleProcessingMs(env: WorkerEnv | undefined): number {
  const raw =
    typeof (env as { GRADING_STALE_PROCESSING_MS?: string } | undefined)
      ?.GRADING_STALE_PROCESSING_MS === 'string'
      ? Number.parseInt(
          (env as { GRADING_STALE_PROCESSING_MS: string }).GRADING_STALE_PROCESSING_MS,
          10
        )
      : NaN;
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_STALE_PROCESSING_MS;
}

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
  classId: true,
} as const;

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
    lastHeartbeatAt: job.lastHeartbeatAt,
  };
}

async function findMatchingWorksheet(
  prisma: PrismaClient,
  job: RecoverableJob
): Promise<string | null> {
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
      worksheetNumber: job.worksheetNumber,
    },
    select: { id: true },
  });

  return worksheet?.id ?? null;
}

async function recoverStuckJob(
  prisma: PrismaClient,
  job: RecoverableJob,
  staleMs: number
): Promise<{
  id: string;
  status: GradingJobStatus;
  worksheetId: string | null;
  recovered: boolean;
}> {
  if (
    job.status !== GradingJobStatus.QUEUED &&
    job.status !== GradingJobStatus.PROCESSING
  ) {
    return { id: job.id, status: job.status, worksheetId: null, recovered: false };
  }

  const worksheetId = await findMatchingWorksheet(prisma, job);
  if (worksheetId) {
    await prisma.gradingJob.update({
      where: { id: job.id },
      data: {
        status: GradingJobStatus.COMPLETED,
        worksheetId,
        completedAt: new Date(),
        dispatchError: null,
        errorMessage: null,
        leaseId: null,
      },
    });
    return {
      id: job.id,
      status: GradingJobStatus.COMPLETED,
      worksheetId,
      recovered: true,
    };
  }

  if (job.status === GradingJobStatus.PROCESSING) {
    const heartbeatTime = job.lastHeartbeatAt || job.startedAt || job.createdAt;
    const stale = Date.now() - heartbeatTime.getTime() > staleMs;

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
          lastErrorAt: new Date(),
        },
      });
      return {
        id: job.id,
        status: GradingJobStatus.QUEUED,
        worksheetId: null,
        recovered: true,
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
        leaseId: null,
      },
    });
    return {
      id: job.id,
      status: GradingJobStatus.FAILED,
      worksheetId: null,
      recovered: true,
    };
  }

  return { id: job.id, status: job.status, worksheetId: null, recovered: false };
}

async function recoverJobForResponse(
  prisma: PrismaClient,
  job: SelectedGradingJob,
  staleMs: number
): Promise<SelectedGradingJob> {
  // Legacy/partial completions may be missing worksheetId. Reconcile so
  // batch polling returns the same shape as single-job polling.
  if (job.status === GradingJobStatus.COMPLETED && !job.worksheetId) {
    const worksheetId = await findMatchingWorksheet(prisma, toRecoverableJob(job));
    if (worksheetId) {
      await prisma.gradingJob.update({
        where: { id: job.id },
        data: { worksheetId, dispatchError: null, errorMessage: null },
      });
      return { ...job, worksheetId, dispatchError: null, errorMessage: null };
    }
  }

  if (
    job.status !== GradingJobStatus.QUEUED &&
    job.status !== GradingJobStatus.PROCESSING
  ) {
    return job;
  }

  const recovery = await recoverStuckJob(prisma, toRecoverableJob(job), staleMs);
  if (!recovery.recovered) return job;

  return {
    ...job,
    status: recovery.status,
    worksheetId: recovery.worksheetId || job.worksheetId,
  };
}

const gradingJobs = new Hono<AppBindings>();

gradingJobs.use('*', authenticate);

gradingJobs.get('/teacher/today', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    const jobs = await prisma.gradingJob.findMany({
      where: {
        teacherId: user.userId,
        createdAt: { gte: today, lt: tomorrow },
      },
      orderBy: { createdAt: 'desc' },
      select: jobSelect,
    });

    const queued = jobs.filter((j) => j.status === GradingJobStatus.QUEUED).length;
    const processing = jobs.filter((j) => j.status === GradingJobStatus.PROCESSING).length;
    const completed = jobs.filter((j) => j.status === GradingJobStatus.COMPLETED).length;
    const failed = jobs.filter((j) => j.status === GradingJobStatus.FAILED).length;

    return c.json({
      success: true,
      summary: { queued, processing, completed, failed, total: jobs.length },
      jobs,
    });
  } catch (error) {
    console.error('[grading-jobs] getTeacherJobsToday error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'gradingJobs.getTeacherJobsToday',
    });
    return c.json({ message: 'Server error' }, 500);
  }
});

gradingJobs.get('/class/:classId', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('classId');
  const dateParam = c.req.query('date');
  const staleMs = staleProcessingMs(c.env);

  try {
    const queryDate = dateParam ? new Date(dateParam) : new Date();
    queryDate.setHours(0, 0, 0, 0);
    const nextDay = new Date(queryDate);
    nextDay.setDate(nextDay.getDate() + 1);

    const jobs = await prisma.gradingJob.findMany({
      where: { classId, submittedOn: { gte: queryDate, lt: nextDay } },
      orderBy: { createdAt: 'desc' },
      select: jobSelect,
    });

    const updatedJobs = await Promise.all(
      jobs.map((j) => recoverJobForResponse(prisma, j, staleMs))
    );

    const queued = updatedJobs.filter((j) => j.status === GradingJobStatus.QUEUED).length;
    const processing = updatedJobs.filter((j) => j.status === GradingJobStatus.PROCESSING).length;
    const completed = updatedJobs.filter((j) => j.status === GradingJobStatus.COMPLETED).length;
    const failed = updatedJobs.filter((j) => j.status === GradingJobStatus.FAILED).length;

    return c.json({
      success: true,
      summary: { queued, processing, completed, failed, total: updatedJobs.length },
      jobs: updatedJobs,
    });
  } catch (error) {
    console.error('[grading-jobs] getJobsByClass error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'gradingJobs.getJobsByClass',
    });
    return c.json({ message: 'Server error' }, 500);
  }
});

gradingJobs.get('/:jobId', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const jobId = c.req.param('jobId');
  const staleMs = staleProcessingMs(c.env);

  try {
    const job = await prisma.gradingJob.findUnique({
      where: { id: jobId },
      select: jobSelect,
    });
    if (!job) return c.json({ message: 'Job not found' }, 404);

    const recovered = await recoverJobForResponse(prisma, job, staleMs);
    return c.json({ success: true, job: recovered });
  } catch (error) {
    console.error('[grading-jobs] getJobStatus error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'gradingJobs.getJobStatus',
    });
    return c.json({ message: 'Server error' }, 500);
  }
});

gradingJobs.post('/batch-status', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const staleMs = staleProcessingMs(c.env);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ message: 'jobIds array required' }, 400);
  }

  const jobIds = (body as { jobIds?: unknown })?.jobIds;
  if (!jobIds || !Array.isArray(jobIds)) {
    return c.json({ message: 'jobIds array required' }, 400);
  }

  try {
    const jobs = await prisma.gradingJob.findMany({
      where: { id: { in: jobIds as string[] } },
      select: jobSelect,
    });

    const recovered = await Promise.all(
      jobs.map((j) => recoverJobForResponse(prisma, j, staleMs))
    );

    return c.json({ success: true, jobs: recovered });
  } catch (error) {
    console.error('[grading-jobs] getBatchJobStatus error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'gradingJobs.getBatchJobStatus',
    });
    return c.json({ message: 'Server error' }, 500);
  }
});

export default gradingJobs;
