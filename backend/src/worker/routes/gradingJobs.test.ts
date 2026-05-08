import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import gradingJobs from './gradingJobs';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown, env: Record<string, unknown> = {}) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/grading-jobs', gradingJobs);
  return { app, env: { JWT_SECRET: SECRET, ...env } };
}

async function validToken(userId = 'teacher-1', role = 'TEACHER') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId, role, exp }, SECRET, 'HS256');
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` };
}

function makeJob(overrides: Partial<Record<string, unknown>> = {}) {
  // Defaults shaped like the `jobSelect` projection.
  return {
    id: 'job-1',
    studentId: 'student-1',
    studentName: 'Alice',
    worksheetNumber: 1,
    status: 'QUEUED',
    worksheetId: null,
    errorMessage: null,
    dispatchError: null,
    attemptCount: 0,
    enqueuedAt: new Date('2026-04-20T10:00:00Z'),
    startedAt: null,
    lastHeartbeatAt: null,
    lastErrorAt: null,
    createdAt: new Date('2026-04-20T10:00:00Z'),
    completedAt: null,
    submittedOn: new Date('2026-04-20T10:00:00Z'),
    classId: 'class-1',
    ...overrides,
  };
}

describe('GET /api/grading-jobs/teacher/today', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const { app, env } = mountApp({ gradingJob: { findMany: vi.fn() } });
    const res = await app.request('/api/grading-jobs/teacher/today', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns jobs + summary filtered to the authenticated teacher', async () => {
    const findMany = vi.fn().mockResolvedValue([
      makeJob({ id: 'j1', status: 'QUEUED' }),
      makeJob({ id: 'j2', status: 'COMPLETED', worksheetId: 'w-1' }),
      makeJob({ id: 'j3', status: 'FAILED' }),
      makeJob({ id: 'j4', status: 'PROCESSING' }),
      makeJob({ id: 'j5', status: 'COMPLETED', worksheetId: 'w-2' }),
    ]);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken('teacher-42');

    const res = await app.request(
      '/api/grading-jobs/teacher/today',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      summary: Record<string, number>;
      jobs: Array<{ id: string }>;
    };
    expect(body.success).toBe(true);
    expect(body.summary).toEqual({
      queued: 1,
      processing: 1,
      completed: 2,
      failed: 1,
      total: 5,
    });
    expect(body.jobs.map((j) => j.id)).toEqual(['j1', 'j2', 'j3', 'j4', 'j5']);

    const call = findMany.mock.calls[0][0];
    expect(call.where.teacherId).toBe('teacher-42');
    expect(call.where.createdAt.gte).toBeInstanceOf(Date);
    expect(call.where.createdAt.lt).toBeInstanceOf(Date);
    expect(call.orderBy).toEqual({ createdAt: 'desc' });
  });

  it('returns 500 when prisma throws', async () => {
    const findMany = vi.fn().mockRejectedValue(new Error('boom'));
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/teacher/today',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ message: 'Server error' });
  });

  it('returns 500 when prisma client is not on context', async () => {
    const app = new Hono<AppBindings>();
    app.route('/api/grading-jobs', gradingJobs);
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/teacher/today',
      { headers: authHeaders(token) },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(500);
  });
});

describe('GET /api/grading-jobs/class/:classId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const { app, env } = mountApp({ gradingJob: { findMany: vi.fn() } });
    const res = await app.request('/api/grading-jobs/class/c1', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns jobs for the class filtered by the date query', async () => {
    const findMany = vi.fn().mockResolvedValue([
      makeJob({ id: 'j1', status: 'COMPLETED', worksheetId: 'w-1' }),
    ]);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/class/class-99?date=2026-04-15',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: Array<{ id: string }>; summary: { total: number } };
    expect(body.jobs[0].id).toBe('j1');
    expect(body.summary.total).toBe(1);

    const call = findMany.mock.calls[0][0];
    expect(call.where.classId).toBe('class-99');
    expect(call.where.submittedOn.gte).toBeInstanceOf(Date);
    expect(call.where.submittedOn.lt).toBeInstanceOf(Date);
  });

  it('recovers a stale PROCESSING job by requeueing it', async () => {
    const staleCreated = new Date(Date.now() - 3 * 60 * 60 * 1000);
    const staleHeartbeat = new Date(Date.now() - 30 * 60 * 1000);
    const findMany = vi.fn().mockResolvedValue([
      makeJob({
        id: 'stuck',
        status: 'PROCESSING',
        createdAt: staleCreated,
        lastHeartbeatAt: staleHeartbeat,
      }),
    ]);
    const findFirst = vi.fn().mockResolvedValue(null); // no matching worksheet
    const update = vi.fn().mockResolvedValue({});

    const { app, env } = mountApp({
      gradingJob: { findMany, update },
      worksheet: { findFirst },
    });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/class/c1',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { jobs: Array<{ id: string; status: string }> };
    expect(body.jobs[0].status).toBe('QUEUED');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'stuck' },
        data: expect.objectContaining({ status: 'QUEUED' }),
      })
    );
  });

  it('recovers a QUEUED job that has a matching worksheet', async () => {
    const findMany = vi.fn().mockResolvedValue([
      makeJob({ id: 'partial', status: 'QUEUED' }),
    ]);
    const findFirst = vi.fn().mockResolvedValue({ id: 'ws-42' });
    const update = vi.fn().mockResolvedValue({});
    const { app, env } = mountApp({
      gradingJob: { findMany, update },
      worksheet: { findFirst },
    });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/class/c1',
      { headers: authHeaders(token) },
      env
    );
    const body = (await res.json()) as { jobs: Array<{ status: string; worksheetId: string }> };
    expect(body.jobs[0].status).toBe('COMPLETED');
    expect(body.jobs[0].worksheetId).toBe('ws-42');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'partial' },
        data: expect.objectContaining({ status: 'COMPLETED', worksheetId: 'ws-42' }),
      })
    );
  });

  it('honors GRADING_STALE_PROCESSING_MS override', async () => {
    // With a 1s override, a 10s-old heartbeat is past stale threshold.
    const findMany = vi.fn().mockResolvedValue([
      makeJob({
        id: 's',
        status: 'PROCESSING',
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        lastHeartbeatAt: new Date(Date.now() - 10 * 1000),
      }),
    ]);
    const findFirst = vi.fn().mockResolvedValue(null);
    const update = vi.fn().mockResolvedValue({});
    const { app, env } = mountApp(
      { gradingJob: { findMany, update }, worksheet: { findFirst } },
      { GRADING_STALE_PROCESSING_MS: '1000' }
    );
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/class/c1',
      { headers: authHeaders(token) },
      env
    );
    const body = (await res.json()) as { jobs: Array<{ status: string }> };
    expect(body.jobs[0].status).toBe('QUEUED');
  });
});

describe('GET /api/grading-jobs/:jobId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const { app, env } = mountApp({ gradingJob: { findUnique: vi.fn() } });
    const res = await app.request('/api/grading-jobs/job-1', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns 404 when the job does not exist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const { app, env } = mountApp({ gradingJob: { findUnique } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/missing',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: 'Job not found' });
  });

  it('returns the job wrapped in { success, job }', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue(makeJob({ id: 'j-ok', status: 'COMPLETED', worksheetId: 'w-1' }));
    const { app, env } = mountApp({ gradingJob: { findUnique } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/j-ok',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; job: { id: string } };
    expect(body.success).toBe(true);
    expect(body.job.id).toBe('j-ok');
  });

  it('reconciles a COMPLETED job missing worksheetId', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue(makeJob({ id: 'j-orphan', status: 'COMPLETED', worksheetId: null }));
    const findFirst = vi.fn().mockResolvedValue({ id: 'ws-777' });
    const update = vi.fn().mockResolvedValue({});
    const { app, env } = mountApp({
      gradingJob: { findUnique, update },
      worksheet: { findFirst },
    });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/j-orphan',
      { headers: authHeaders(token) },
      env
    );
    const body = (await res.json()) as { job: { worksheetId: string } };
    expect(body.job.worksheetId).toBe('ws-777');
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'j-orphan' },
        data: expect.objectContaining({ worksheetId: 'ws-777' }),
      })
    );
  });

  it('is matched after /teacher/today — static path wins', async () => {
    const findUnique = vi.fn();
    const findMany = vi.fn().mockResolvedValue([]);
    const { app, env } = mountApp({ gradingJob: { findMany, findUnique } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/teacher/today',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(200);
    // teacher/today was a 2-segment path → never matched /:jobId, so
    // findUnique shouldn't have fired.
    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalled();
  });
});

describe('POST /api/grading-jobs/batch-status', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without token', async () => {
    const { app, env } = mountApp({ gradingJob: { findMany: vi.fn() } });
    const res = await app.request(
      '/api/grading-jobs/batch-status',
      { method: 'POST' },
      env
    );
    expect(res.status).toBe(401);
  });

  it('returns 400 when jobIds is missing', async () => {
    const { app, env } = mountApp({ gradingJob: { findMany: vi.fn() } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/batch-status',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      env
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: 'jobIds array required' });
  });

  it('returns 400 when jobIds is not an array', async () => {
    const { app, env } = mountApp({ gradingJob: { findMany: vi.fn() } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/batch-status',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: 'not-an-array' }),
      },
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when body is not valid JSON', async () => {
    const { app, env } = mountApp({ gradingJob: { findMany: vi.fn() } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/batch-status',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: '{not json',
      },
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns the matching jobs', async () => {
    const findMany = vi.fn().mockResolvedValue([
      makeJob({ id: 'a', status: 'COMPLETED', worksheetId: 'w-a' }),
      makeJob({ id: 'b', status: 'FAILED' }),
    ]);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken();
    const res = await app.request(
      '/api/grading-jobs/batch-status',
      {
        method: 'POST',
        headers: { ...authHeaders(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ jobIds: ['a', 'b', 'c'] }),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; jobs: Array<{ id: string }> };
    expect(body.success).toBe(true);
    expect(body.jobs.map((j) => j.id)).toEqual(['a', 'b']);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: { in: ['a', 'b', 'c'] } } })
    );
  });
});

// Helper for the admin-dashboard tests — build a job with the wider
// projection that handler reads (class + school name).
function makeAdminJob(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'job-A',
    studentName: 'Alice',
    worksheetNumber: 1,
    status: 'COMPLETED',
    errorMessage: null,
    dispatchError: null,
    attemptCount: 1,
    enqueuedAt: new Date('2026-05-08T10:00:00Z'),
    startedAt: new Date('2026-05-08T10:00:05Z'),
    lastHeartbeatAt: null,
    lastErrorAt: null,
    createdAt: new Date('2026-05-08T10:00:00Z'),
    completedAt: new Date('2026-05-08T10:00:35Z'),
    class: { name: 'Class A', school: { name: 'School A' } },
    ...overrides,
  };
}

function todayUtcDateOnly(): string {
  const d = new Date();
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

describe('GET /api/grading-jobs/admin/dashboard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const { app, env } = mountApp({ gradingJob: { findMany: vi.fn() } });
    const res = await app.request('/api/grading-jobs/admin/dashboard', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns 403 for a TEACHER token', async () => {
    const { app, env } = mountApp({ gradingJob: { findMany: vi.fn() } });
    const token = await validToken('teacher-1', 'TEACHER');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(403);
  });

  it('returns 200 with empty payload when no jobs exist', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken('admin-1', 'SUPERADMIN');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      minDate: string;
      dateRange: { startDate: string; endDate: string };
      historical: { summary: { total: number }; byDay: unknown[]; failureReasons: unknown[]; recentFailures: unknown[] };
      current: { queued: number; processing: number; byClass: unknown[]; inProgress: number };
    };
    expect(body.success).toBe(true);
    expect(body.minDate).toBe('2026-05-06');
    expect(body.dateRange.startDate).toBe(todayUtcDateOnly());
    expect(body.dateRange.endDate).toBe(todayUtcDateOnly());
    expect(body.historical.summary.total).toBe(0);
    expect(body.historical.byDay).toEqual([]);
    expect(body.historical.failureReasons).toEqual([]);
    expect(body.historical.recentFailures).toEqual([]);
    expect(body.current.queued).toBe(0);
    expect(body.current.processing).toBe(0);
    expect(body.current.inProgress).toBe(0);
    expect(body.current.byClass).toEqual([]);
  });

  it('clamps requested startDate below 2026-05-06 to the floor', async () => {
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken('admin-1', 'SUPERADMIN');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard?startDate=2024-01-01&endDate=2024-01-02',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { dateRange: { startDate: string; endDate: string } };
    expect(body.dateRange.startDate).toBe('2026-05-06');
    expect(body.dateRange.endDate).toBe('2026-05-06');
    // Confirm the historical findMany.where.createdAt.gte is clamped too.
    const firstCall = findMany.mock.calls[0]?.[0] as {
      where: { createdAt: { gte: Date; lt: Date } };
    };
    expect(firstCall.where.createdAt.gte.toISOString()).toBe(
      '2026-05-06T00:00:00.000Z'
    );
  });

  it('aggregates summary correctly across mixed statuses', async () => {
    const historicalJobs = [
      makeAdminJob({
        id: 'c-1',
        status: 'COMPLETED',
        startedAt: new Date('2026-05-08T10:00:00Z'),
        completedAt: new Date('2026-05-08T10:00:30Z'),
      }),
      makeAdminJob({
        id: 'c-2',
        status: 'COMPLETED',
        startedAt: new Date('2026-05-08T10:00:00Z'),
        completedAt: new Date('2026-05-08T10:00:50Z'),
      }),
      makeAdminJob({
        id: 'f-1',
        status: 'FAILED',
        errorMessage: 'thing broke',
        startedAt: new Date('2026-05-08T10:00:00Z'),
        completedAt: new Date('2026-05-08T10:01:00Z'),
        lastErrorAt: new Date('2026-05-08T10:01:00Z'),
      }),
      makeAdminJob({ id: 'q-1', status: 'QUEUED', startedAt: null, completedAt: null }),
      makeAdminJob({ id: 'p-1', status: 'PROCESSING', startedAt: new Date(), completedAt: null }),
    ];
    const findMany = vi.fn().mockResolvedValueOnce(historicalJobs).mockResolvedValueOnce([]);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken('admin-1', 'SUPERADMIN');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard',
      { headers: authHeaders(token) },
      env
    );
    const body = (await res.json()) as {
      historical: {
        summary: {
          total: number;
          completed: number;
          failed: number;
          queued: number;
          processing: number;
          successRate: number | null;
          failureRate: number | null;
          avgJobSeconds: number | null;
        };
      };
    };
    expect(body.historical.summary.total).toBe(5);
    expect(body.historical.summary.completed).toBe(2);
    expect(body.historical.summary.failed).toBe(1);
    expect(body.historical.summary.queued).toBe(1);
    expect(body.historical.summary.processing).toBe(1);
    // 2/3 terminal = 66.67
    expect(body.historical.summary.successRate).toBe(66.67);
    // 1/3 terminal = 33.33
    expect(body.historical.summary.failureRate).toBe(33.33);
    expect(body.historical.summary.avgJobSeconds).toBeGreaterThan(0);
  });

  it('current.activeProcessing vs staleProcessing discriminates by heartbeat age', async () => {
    const now = Date.now();
    const currentJobs = [
      // Active: heartbeat 30s ago.
      makeAdminJob({
        id: 'p-active',
        status: 'PROCESSING',
        lastHeartbeatAt: new Date(now - 30 * 1000),
        startedAt: new Date(now - 60 * 1000),
        completedAt: null,
      }),
      // Stale: heartbeat past PROCESSING_STALE_MS (default 20 min).
      makeAdminJob({
        id: 'p-stale',
        status: 'PROCESSING',
        lastHeartbeatAt: new Date(now - 2 * 60 * 60 * 1000),
        startedAt: new Date(now - 3 * 60 * 60 * 1000),
        completedAt: null,
      }),
    ];
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(currentJobs);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken('admin-1', 'SUPERADMIN');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard',
      { headers: authHeaders(token) },
      env
    );
    const body = (await res.json()) as {
      current: { activeProcessing: number; staleProcessing: number; processing: number };
    };
    expect(body.current.processing).toBe(2);
    expect(body.current.activeProcessing).toBe(1);
    expect(body.current.staleProcessing).toBe(1);
  });

  it('byClass truncates to 12 entries sorted by total desc', async () => {
    const currentJobs = Array.from({ length: 13 }).map((_, i) =>
      makeAdminJob({
        id: `cur-${i}`,
        status: 'QUEUED',
        startedAt: null,
        class: { name: `C${i}`, school: { name: `S${i}` } },
      })
    );
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce(currentJobs);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken('admin-1', 'SUPERADMIN');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard',
      { headers: authHeaders(token) },
      env
    );
    const body = (await res.json()) as {
      current: { byClass: Array<{ className: string; total: number }> };
    };
    expect(body.current.byClass).toHaveLength(12);
  });

  it('failureReasons groups by errorMessage and caps examples at 3', async () => {
    const failed = Array.from({ length: 5 }).map((_, i) =>
      makeAdminJob({
        id: `f-${i}`,
        status: 'FAILED',
        errorMessage: 'thing broke',
        startedAt: new Date('2026-05-08T10:00:00Z'),
        completedAt: new Date('2026-05-08T10:01:00Z'),
        lastErrorAt: new Date('2026-05-08T10:01:00Z'),
      })
    );
    const findMany = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce([]);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken('admin-1', 'SUPERADMIN');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard',
      { headers: authHeaders(token) },
      env
    );
    const body = (await res.json()) as {
      historical: {
        failureReasons: Array<{ reason: string; count: number; examples: unknown[] }>;
      };
    };
    expect(body.historical.failureReasons).toHaveLength(1);
    expect(body.historical.failureReasons[0].reason).toBe('thing broke');
    expect(body.historical.failureReasons[0].count).toBe(5);
    expect(body.historical.failureReasons[0].examples).toHaveLength(3);
  });

  it('recentFailures slice cap is 100', async () => {
    const failed = Array.from({ length: 150 }).map((_, i) =>
      makeAdminJob({
        id: `f-${i}`,
        status: 'FAILED',
        errorMessage: 'thing broke',
      })
    );
    const findMany = vi.fn().mockResolvedValueOnce(failed).mockResolvedValueOnce([]);
    const { app, env } = mountApp({ gradingJob: { findMany } });
    const token = await validToken('admin-1', 'SUPERADMIN');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard',
      { headers: authHeaders(token) },
      env
    );
    const body = (await res.json()) as {
      historical: { recentFailures: unknown[] };
    };
    expect(body.historical.recentFailures).toHaveLength(100);
  });

  it('static path /admin/dashboard wins over /:jobId', async () => {
    const findUnique = vi.fn();
    const findMany = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const { app, env } = mountApp({ gradingJob: { findUnique, findMany } });
    const token = await validToken('admin-1', 'SUPERADMIN');
    const res = await app.request(
      '/api/grading-jobs/admin/dashboard',
      { headers: authHeaders(token) },
      env
    );
    expect(res.status).toBe(200);
    // The /:jobId param route uses findUnique. Confirm it was never hit.
    expect(findUnique).not.toHaveBeenCalled();
    expect(findMany).toHaveBeenCalledTimes(2);
  });

  it('returns 500 with controllerError dual-write on prisma failure', async () => {
    const findMany = vi.fn().mockRejectedValue(new Error('db down'));
    const { app, env } = mountApp({ gradingJob: { findMany } }, { POSTHOG_API_KEY: 'k' });
    const token = await validToken('admin-1', 'SUPERADMIN');
    // Silence the captureControllerError console.error mirror.
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Mock fetch so capturePosthogException doesn't try a real network call.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 200 })) as unknown as typeof fetch;
    try {
      const res = await app.request(
        '/api/grading-jobs/admin/dashboard',
        { headers: authHeaders(token) },
        env
      );
      expect(res.status).toBe(500);
      const body = (await res.json()) as { message: string };
      expect(body.message).toBe('Server error');
    } finally {
      globalThis.fetch = originalFetch;
      consoleSpy.mockRestore();
    }
  });
});
