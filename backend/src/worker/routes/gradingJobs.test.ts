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
