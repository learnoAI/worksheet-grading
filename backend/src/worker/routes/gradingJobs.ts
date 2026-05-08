import { Hono } from 'hono';
import { GradingJobStatus, UserRole, type PrismaClient } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import {
  capturePosthogException,
  captureControllerError,
} from '../adapters/posthog';
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

/**
 * Floor for the admin dashboard date picker. Older rows have inconsistent
 * leaseId / attemptCount / lastHeartbeatAt and would skew percentile and
 * average calculations. Mirrors the Express constant in
 * `backend/src/controllers/gradingJobController.ts:9`.
 */
const ADMIN_DASHBOARD_MIN_DATE = '2026-05-06';

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
  workflowInstanceId: true,
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
  workflowInstanceId: string | null;
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
    workflowInstanceId: job.workflowInstanceId,
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
    // Workflow-driven jobs: defer to the workflow's own watchdog. The
    // workflow can run for ~50 min worst-case (3-tier fallback + persist
    // retries) and does NOT heartbeat between steps — null-ing its lease
    // here would race the workflow's persist step and surface as a 409
    // lease-mismatch on /complete or /fail. Skip stale recovery for any
    // job that has a workflowInstanceId; the workflow either persists
    // (success/failure) or ends in `errored` state (visible in the CF
    // dashboard, recoverable via /reset-dispatch). Legacy queue-driven
    // jobs (workflowInstanceId null, still possible during the cutover
    // drain window) keep the original heartbeat-based recovery.
    const heartbeatTime = job.lastHeartbeatAt || job.startedAt || job.createdAt;
    const stale = Date.now() - heartbeatTime.getTime() > staleMs;

    if (stale && !job.workflowInstanceId) {
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

// ─────────────────────────────────────────────────────────────────────────────
// Admin dashboard helpers — port of the pure functions in
// `backend/src/controllers/gradingJobController.ts:76-163` (codex branch).
// Keep verbatim so the wire payload matches Express byte-for-byte; the
// superadmin grading-jobs UI does not handle missing or renamed fields.
// ─────────────────────────────────────────────────────────────────────────────

type AdminDashboardJob = {
  id: string;
  studentName: string;
  worksheetNumber: number;
  status: GradingJobStatus;
  errorMessage: string | null;
  dispatchError: string | null;
  attemptCount: number;
  enqueuedAt: Date | null;
  startedAt: Date | null;
  lastHeartbeatAt: Date | null;
  lastErrorAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
  class: { name: string; school: { name: string } };
};

type AdminDashboardCurrentJob = {
  id: string;
  worksheetNumber: number;
  studentName: string;
  status: GradingJobStatus;
  attemptCount: number;
  createdAt: Date;
  enqueuedAt: Date | null;
  startedAt: Date | null;
  lastHeartbeatAt: Date | null;
  class: { name: string; school: { name: string } };
};

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function formatDateOnly(date: Date): string {
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;
}

function parseDateOnly(value: unknown, fallback: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return fallback;
  }
  return value;
}

function getUtcDayStart(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function addUtcDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function clampDateRange(
  startDateRaw: unknown,
  endDateRaw: unknown
): { startDate: string; endDate: string; start: Date; endExclusive: Date } {
  const today = formatDateOnly(new Date());
  let startDate = parseDateOnly(startDateRaw, today);
  let endDate = parseDateOnly(endDateRaw, startDate);

  if (startDate < ADMIN_DASHBOARD_MIN_DATE) startDate = ADMIN_DASHBOARD_MIN_DATE;
  if (endDate < ADMIN_DASHBOARD_MIN_DATE) endDate = ADMIN_DASHBOARD_MIN_DATE;
  if (endDate < startDate) endDate = startDate;

  const start = getUtcDayStart(startDate);
  const endExclusive = addUtcDays(getUtcDayStart(endDate), 1);

  return { startDate, endDate, start, endExclusive };
}

function secondsBetween(start: Date | null, end: Date | null): number | null {
  if (!start || !end) return null;
  const seconds = Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000));
  return Number.isFinite(seconds) ? seconds : null;
}

function getTerminalDurationSeconds(
  job: Pick<AdminDashboardJob, 'createdAt' | 'startedAt' | 'completedAt' | 'lastErrorAt' | 'status'>
): number | null {
  const end =
    job.completedAt || (job.status === GradingJobStatus.FAILED ? job.lastErrorAt : null);
  return secondsBetween(job.startedAt || job.createdAt, end);
}

function average(values: Array<number | null | undefined>): number | null {
  const valid = values.filter(
    (value): value is number => typeof value === 'number' && Number.isFinite(value)
  );
  if (valid.length === 0) return null;
  return Math.round(valid.reduce((sum, value) => sum + value, 0) / valid.length);
}

function percentile(
  values: Array<number | null | undefined>,
  percentileValue: number
): number | null {
  const valid = values
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
    .sort((a, b) => a - b);
  if (valid.length === 0) return null;
  const index = Math.ceil((percentileValue / 100) * valid.length) - 1;
  return valid[Math.min(Math.max(index, 0), valid.length - 1)];
}

function getFailureReason(
  job: Pick<AdminDashboardJob, 'errorMessage' | 'dispatchError'>
): string {
  return job.errorMessage?.trim() || job.dispatchError?.trim() || 'No reason recorded';
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

// Superadmin grading-jobs dashboard. Mounted ABOVE `/:jobId` so the
// literal segment is not swallowed by the param route. Port of
// `getAdminGradingJobsDashboard` at
// `backend/src/controllers/gradingJobController.ts:476-764` (codex
// branch). Pure aggregator over two `findMany` calls; emits the wire
// shape consumed by `web-app/app/dashboard/superadmin/grading-jobs/`.
gradingJobs.get('/admin/dashboard', authorize([UserRole.SUPERADMIN]), async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const PROCESSING_STALE_MS = staleProcessingMs(c.env);

  try {
    const { startDate, endDate, start, endExclusive } = clampDateRange(
      c.req.query('startDate'),
      c.req.query('endDate')
    );
    const now = new Date();

    const [historicalJobs, currentJobs] = await Promise.all([
      prisma.gradingJob.findMany({
        where: { createdAt: { gte: start, lt: endExclusive } },
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          studentName: true,
          worksheetNumber: true,
          status: true,
          errorMessage: true,
          dispatchError: true,
          attemptCount: true,
          enqueuedAt: true,
          startedAt: true,
          lastHeartbeatAt: true,
          lastErrorAt: true,
          createdAt: true,
          completedAt: true,
          class: {
            select: {
              name: true,
              school: { select: { name: true } },
            },
          },
        },
      }) as Promise<AdminDashboardJob[]>,
      // NOTE: current snapshot has NO date filter — UI labels it "Current
      // Classes" not "Classes in range". A QUEUED/PROCESSING job from
      // outside the picker date range is intentionally still surfaced.
      prisma.gradingJob.findMany({
        where: {
          status: { in: [GradingJobStatus.QUEUED, GradingJobStatus.PROCESSING] },
        },
        orderBy: [
          { status: 'asc' },
          { startedAt: 'asc' },
          { createdAt: 'asc' },
        ],
        select: {
          id: true,
          worksheetNumber: true,
          studentName: true,
          status: true,
          attemptCount: true,
          createdAt: true,
          enqueuedAt: true,
          startedAt: true,
          lastHeartbeatAt: true,
          class: {
            select: {
              name: true,
              school: { select: { name: true } },
            },
          },
        },
      }) as Promise<AdminDashboardCurrentJob[]>,
    ]);

    const terminalJobs = historicalJobs.filter(
      (job) =>
        job.status === GradingJobStatus.COMPLETED ||
        job.status === GradingJobStatus.FAILED
    );
    const completedJobs = historicalJobs.filter(
      (job) => job.status === GradingJobStatus.COMPLETED
    );
    const failedJobs = historicalJobs.filter(
      (job) => job.status === GradingJobStatus.FAILED
    );
    const queuedJobs = historicalJobs.filter(
      (job) => job.status === GradingJobStatus.QUEUED
    );
    const processingJobs = historicalJobs.filter(
      (job) => job.status === GradingJobStatus.PROCESSING
    );
    const terminalDurations = terminalJobs.map(getTerminalDurationSeconds);
    const completedDurations = completedJobs.map(getTerminalDurationSeconds);
    const failedDurations = failedJobs.map(getTerminalDurationSeconds);

    const summary = {
      total: historicalJobs.length,
      queued: queuedJobs.length,
      processing: processingJobs.length,
      completed: completedJobs.length,
      failed: failedJobs.length,
      successRate:
        terminalJobs.length > 0
          ? Math.round((completedJobs.length / terminalJobs.length) * 10000) / 100
          : null,
      failureRate:
        terminalJobs.length > 0
          ? Math.round((failedJobs.length / terminalJobs.length) * 10000) / 100
          : null,
      avgJobSeconds: average(terminalDurations),
      p75JobSeconds: percentile(terminalDurations, 75),
      p90JobSeconds: percentile(terminalDurations, 90),
      p95JobSeconds: percentile(terminalDurations, 95),
      p99JobSeconds: percentile(terminalDurations, 99),
      avgSuccessSeconds: average(completedDurations),
      avgFailureSeconds: average(failedDurations),
      avgAttempts:
        historicalJobs.length > 0
          ? Math.round(
              (historicalJobs.reduce((sum, job) => sum + job.attemptCount, 0) /
                historicalJobs.length) *
                100
            ) / 100
          : null,
    };

    const byDay = new Map<
      string,
      {
        date: string;
        total: number;
        queued: number;
        processing: number;
        completed: number;
        failed: number;
        durations: number[];
      }
    >();

    for (const job of historicalJobs) {
      const date = formatDateOnly(job.createdAt);
      const row = byDay.get(date) || {
        date,
        total: 0,
        queued: 0,
        processing: 0,
        completed: 0,
        failed: 0,
        durations: [],
      };

      row.total += 1;
      if (job.status === GradingJobStatus.QUEUED) row.queued += 1;
      if (job.status === GradingJobStatus.PROCESSING) row.processing += 1;
      if (job.status === GradingJobStatus.COMPLETED) row.completed += 1;
      if (job.status === GradingJobStatus.FAILED) row.failed += 1;

      const duration = getTerminalDurationSeconds(job);
      if (duration !== null) row.durations.push(duration);
      byDay.set(date, row);
    }

    const byDayRows = Array.from(byDay.values())
      .map((row) => {
        const terminal = row.completed + row.failed;
        return {
          date: row.date,
          total: row.total,
          queued: row.queued,
          processing: row.processing,
          completed: row.completed,
          failed: row.failed,
          successRate:
            terminal > 0
              ? Math.round((row.completed / terminal) * 10000) / 100
              : null,
          avgJobSeconds: average(row.durations),
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    const failureReasonMap = new Map<
      string,
      {
        reason: string;
        count: number;
        latestAt: Date | null;
        examples: Array<{
          id: string;
          worksheetNumber: number;
          studentName: string;
          className: string;
          schoolName: string;
          attemptCount: number;
        }>;
      }
    >();

    for (const job of failedJobs) {
      const reason = getFailureReason(job);
      const row = failureReasonMap.get(reason) || {
        reason,
        count: 0,
        latestAt: null,
        examples: [],
      };
      row.count += 1;
      const latestCandidate = job.completedAt || job.lastErrorAt || job.createdAt;
      if (!row.latestAt || latestCandidate > row.latestAt) {
        row.latestAt = latestCandidate;
      }
      if (row.examples.length < 3) {
        row.examples.push({
          id: job.id,
          worksheetNumber: job.worksheetNumber,
          studentName: job.studentName,
          className: job.class.name,
          schoolName: job.class.school.name,
          attemptCount: job.attemptCount,
        });
      }
      failureReasonMap.set(reason, row);
    }

    const failureReasons = Array.from(failureReasonMap.values())
      .map((row) => ({ ...row, latestAt: row.latestAt?.toISOString() || null }))
      .sort(
        (a, b) =>
          b.count - a.count ||
          (b.latestAt || '').localeCompare(a.latestAt || '')
      );

    const recentFailures = failedJobs.slice(0, 100).map((job) => ({
      id: job.id,
      worksheetNumber: job.worksheetNumber,
      studentName: job.studentName,
      className: job.class.name,
      schoolName: job.class.school.name,
      reason: getFailureReason(job),
      errorMessage: job.errorMessage,
      dispatchError: job.dispatchError,
      attemptCount: job.attemptCount,
      createdAt: job.createdAt.toISOString(),
      startedAt: job.startedAt?.toISOString() || null,
      completedAt: job.completedAt?.toISOString() || null,
      lastErrorAt: job.lastErrorAt?.toISOString() || null,
      durationSeconds: getTerminalDurationSeconds(job),
    }));

    const processingCurrentJobs = currentJobs.filter(
      (job) => job.status === GradingJobStatus.PROCESSING
    );
    const queuedCurrentJobs = currentJobs.filter(
      (job) => job.status === GradingJobStatus.QUEUED
    );
    const staleCutoffMs = now.getTime() - PROCESSING_STALE_MS;
    // Hard-coded 2-min "fresh" window — Express does the same at L695.
    const freshHeartbeatCutoffMs = now.getTime() - 2 * 60 * 1000;

    const activeProcessing = processingCurrentJobs.filter((job) => {
      const heartbeat = job.lastHeartbeatAt || job.startedAt || job.createdAt;
      return heartbeat.getTime() >= freshHeartbeatCutoffMs;
    });
    const staleProcessing = processingCurrentJobs.filter((job) => {
      const heartbeat = job.lastHeartbeatAt || job.startedAt || job.createdAt;
      return heartbeat.getTime() < staleCutoffMs;
    });
    const processingAges = processingCurrentJobs.map((job) =>
      secondsBetween(job.startedAt || job.createdAt, now)
    );

    const currentByClassMap = new Map<
      string,
      {
        className: string;
        schoolName: string;
        queued: number;
        processing: number;
        total: number;
      }
    >();

    for (const job of currentJobs) {
      // Composite key: two classes with the same name in different
      // schools must NOT collide. Mirrors Express L716.
      const key = `${job.class.school.name}::${job.class.name}`;
      const row = currentByClassMap.get(key) || {
        className: job.class.name,
        schoolName: job.class.school.name,
        queued: 0,
        processing: 0,
        total: 0,
      };
      row.total += 1;
      if (job.status === GradingJobStatus.QUEUED) row.queued += 1;
      if (job.status === GradingJobStatus.PROCESSING) row.processing += 1;
      currentByClassMap.set(key, row);
    }

    const current = {
      generatedAt: now.toISOString(),
      queued: queuedCurrentJobs.length,
      processing: processingCurrentJobs.length,
      // `inProgress` is an alias for `processing`, kept for UI back-compat.
      inProgress: processingCurrentJobs.length,
      activeProcessing: activeProcessing.length,
      staleProcessing: staleProcessing.length,
      noHeartbeat: processingCurrentJobs.filter((job) => !job.lastHeartbeatAt)
        .length,
      avgProcessingSeconds: average(processingAges),
      oldestProcessingSeconds:
        processingAges
          .filter((value): value is number => value !== null)
          .sort((a, b) => b - a)[0] ?? null,
      byClass: Array.from(currentByClassMap.values())
        .sort(
          (a, b) =>
            b.total - a.total || a.className.localeCompare(b.className)
        )
        .slice(0, 12),
    };

    return c.json({
      success: true,
      minDate: ADMIN_DASHBOARD_MIN_DATE,
      dateRange: { startDate, endDate },
      current,
      historical: {
        summary,
        byDay: byDayRows,
        failureReasons,
        recentFailures,
      },
    });
  } catch (error) {
    // captureControllerError dual-writes $exception AND
    // grading_pipeline.controller_error so dashboards keyed on either
    // event keep working — mirrors Express's helper of the same name.
    await captureControllerError(
      c.env ?? {},
      'gradingJobs.getAdminGradingJobsDashboard',
      error,
      {
        distinctId: user.userId,
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        userId: user.userId,
      }
    );
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
