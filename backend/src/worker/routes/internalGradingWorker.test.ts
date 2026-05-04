import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import internalGradingWorker from './internalGradingWorker';
import type { AppBindings } from '../types';

const WORKER_TOKEN = 'gw-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/internal/grading-worker', internalGradingWorker);
  return app;
}

async function authed(
  app: Hono<AppBindings>,
  path: string,
  init: RequestInit = {},
  env: Record<string, unknown> = {}
): Promise<Response> {
  return app.request(
    path,
    {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'X-Grading-Worker-Token': WORKER_TOKEN,
      },
    },
    { GRADING_WORKER_TOKEN: WORKER_TOKEN, ...env }
  );
}

async function postJson(
  app: Hono<AppBindings>,
  path: string,
  body: unknown,
  env: Record<string, unknown> = {}
) {
  return authed(
    app,
    path,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    env
  );
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Auth — /internal/grading-worker/*', () => {
  it('rejects requests without the worker token', async () => {
    const app = mountApp({});
    const res = await app.request(
      '/internal/grading-worker/jobs/j1/heartbeat',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: 'l' }),
      },
      { GRADING_WORKER_TOKEN: WORKER_TOKEN }
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /jobs/:jobId/acquire', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns acquired=false when the job is not QUEUED', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn();
    const queryRaw = vi.fn().mockResolvedValue([]);
    const app = mountApp({
      gradingJob: { updateMany, findUnique },
      $queryRaw: queryRaw,
    });
    const res = await authed(app, '/internal/grading-worker/jobs/j1/acquire', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, acquired: false });
  });

  it('returns 404 when the job disappeared between acquire and lookup', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue(null);
    const queryRaw = vi.fn().mockResolvedValue([]);
    const app = mountApp({
      gradingJob: { updateMany, findUnique },
      $queryRaw: queryRaw,
    });
    const res = await authed(app, '/internal/grading-worker/jobs/j1/acquire', {
      method: 'POST',
    });
    expect(res.status).toBe(404);
  });

  it('returns the job payload + leaseId on successful acquire', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({
      id: 'j1',
      status: 'PROCESSING',
      tokenNo: 'T1',
      worksheetName: '5',
      worksheetNumber: 5,
      submittedOn: new Date('2026-04-10'),
      isRepeated: false,
      studentId: 'st1',
      classId: 'c1',
      teacherId: 't1',
      images: [
        { s3Key: 'k1', storageProvider: 'R2', pageNumber: 1, mimeType: 'image/png' },
      ],
    });
    const queryRaw = vi.fn().mockResolvedValue([]);
    const app = mountApp({
      gradingJob: { updateMany, findUnique },
      $queryRaw: queryRaw,
    });
    const res = await authed(app, '/internal/grading-worker/jobs/j1/acquire', {
      method: 'POST',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { acquired: boolean; leaseId: string; job: { id: string } };
    expect(body.acquired).toBe(true);
    expect(typeof body.leaseId).toBe('string');
    expect(body.job.id).toBe('j1');
  });
});

describe('POST /jobs/:jobId/heartbeat', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects body without leaseId', async () => {
    const app = mountApp({});
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/heartbeat', {});
    expect(res.status).toBe(400);
  });

  it('returns 409 on lease mismatch', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({ lastHeartbeatAt: null });
    const app = mountApp({ gradingJob: { updateMany, findUnique } });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/heartbeat', {
      leaseId: 'stale',
    });
    expect(res.status).toBe(409);
  });

  it('returns 200 on successful heartbeat', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi.fn().mockResolvedValue({ lastHeartbeatAt: null });
    const app = mountApp({ gradingJob: { updateMany, findUnique } });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/heartbeat', {
      leaseId: 'lease-xyz',
      phase: 'initial',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
  });
});

describe('POST /jobs/:jobId/complete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when body has no leaseId', async () => {
    const app = mountApp({});
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/complete', {});
    expect(res.status).toBe(400);
  });

  it('returns 400 when grading response is missing success field', async () => {
    const app = mountApp({});
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/complete', {
      leaseId: 'l',
      gradingResponse: { grade: 32 }, // no success
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 on lease mismatch inside the transaction', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { id: 'j1', status: 'PROCESSING', leaseId: 'different', worksheetId: null },
    ]);
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        $queryRaw: queryRaw,
        gradingJob: { updateMany: vi.fn() },
        worksheet: { findFirst: vi.fn(), upsert: vi.fn() },
        worksheetTemplate: { findFirst: vi.fn() },
      })
    );
    const app = mountApp({ $transaction: transaction });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/complete', {
      leaseId: 'mine',
      gradingResponse: { success: true, grade: 32 },
    });
    expect(res.status).toBe(409);
  });

  it('returns 404 when the job is not found inside the lock', async () => {
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ $queryRaw: vi.fn().mockResolvedValue([]) })
    );
    const app = mountApp({ $transaction: transaction });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/complete', {
      leaseId: 'mine',
      gradingResponse: { success: true, grade: 32 },
    });
    expect(res.status).toBe(404);
  });

  it('idempotently returns ALREADY_COMPLETED when job was already COMPLETED', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { id: 'j1', status: 'COMPLETED', leaseId: null, worksheetId: 'ws-prev' },
    ]);
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ $queryRaw: queryRaw, gradingJob: { updateMany: vi.fn() } })
    );
    const app = mountApp({
      $transaction: transaction,
      gradingJob: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/complete', {
      leaseId: 'mine',
      gradingResponse: { success: true, grade: 32 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { action: string; worksheetId: string };
    expect(body.action).toBe('ALREADY_COMPLETED');
    expect(body.worksheetId).toBe('ws-prev');
  });

  it('completes the job and updates mastery on happy path', async () => {
    const queryRaw = vi.fn().mockResolvedValue([
      { id: 'j1', status: 'PROCESSING', leaseId: 'mine', worksheetId: null },
    ]);
    // Inside the transaction: persistWorksheetForGradingJobId needs a
    // few lookups + an upsert.
    const txOps = {
      $queryRaw: queryRaw,
      gradingJob: {
        findUnique: vi.fn().mockResolvedValue({
          studentId: 'st1',
          classId: 'c1',
          teacherId: 't1',
          worksheetNumber: 5,
          submittedOn: new Date('2026-04-10'),
          isRepeated: false,
        }),
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
      worksheetTemplate: { findFirst: vi.fn().mockResolvedValue({ id: 'tpl' }) },
      worksheet: {
        findFirst: vi.fn().mockResolvedValue(null),
        upsert: vi.fn().mockResolvedValue({ id: 'ws-new' }),
      },
    };
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => cb(txOps));
    // Post-transaction mastery update needs a second $transaction plus
    // findUnique. Using spies we can keep it all inline.
    const gradingJobFindUnique = vi.fn().mockResolvedValue({
      studentId: 'st1',
      worksheetNumber: 5,
      submittedOn: new Date('2026-04-10'),
    });
    const skillMapFindUnique = vi.fn().mockResolvedValue(null); // no skill map → no-op mastery
    const app = mountApp({
      $transaction: transaction,
      gradingJob: { findUnique: gradingJobFindUnique },
      worksheetSkillMap: { findUnique: skillMapFindUnique },
    });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/complete', {
      leaseId: 'mine',
      gradingResponse: {
        success: true,
        grade: 32,
        total_possible: 40,
        wrong_questions: [],
        unanswered_questions: [],
      },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { worksheetId: string; action: string };
    expect(body.worksheetId).toBe('ws-new');
    expect(['CREATED', 'UPDATED']).toContain(body.action);
    // Mastery update path was attempted (no skill map → no-op)
    expect(skillMapFindUnique).toHaveBeenCalled();
  });

  it('accepts the legacy flat grading-response payload shape', async () => {
    // Body itself has `success` (no gradingResponse nesting).
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({ $queryRaw: vi.fn().mockResolvedValue([]) })
    );
    const app = mountApp({ $transaction: transaction });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/complete', {
      leaseId: 'mine',
      success: true,
      grade: 32,
    });
    // Reaches the transaction (returns 404 there because $queryRaw=[])
    expect(res.status).toBe(404);
  });
});

describe('POST /jobs/:jobId/fail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects body without errorMessage', async () => {
    const app = mountApp({});
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/fail', {
      leaseId: 'l',
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 on lease mismatch', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const app = mountApp({ gradingJob: { updateMany } });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/fail', {
      leaseId: 'stale',
      errorMessage: 'python down',
    });
    expect(res.status).toBe(409);
  });

  it('returns 200 on successful fail', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = mountApp({ gradingJob: { updateMany } });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/fail', {
      leaseId: 'mine',
      errorMessage: 'python down',
    });
    expect(res.status).toBe(200);
    const call = updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('FAILED');
    expect(call.data.errorMessage).toBe('python down');
  });
});

describe('POST /jobs/:jobId/requeue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 409 on lease mismatch', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const app = mountApp({ gradingJob: { updateMany } });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/requeue', {
      leaseId: 'stale',
    });
    expect(res.status).toBe(409);
  });

  it('returns 200 on successful requeue and does NOT clear enqueuedAt', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const app = mountApp({ gradingJob: { updateMany } });
    const res = await postJson(app, '/internal/grading-worker/jobs/j1/requeue', {
      leaseId: 'mine',
      reason: 'lease_lost',
    });
    expect(res.status).toBe(200);
    const call = updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('QUEUED');
    expect(call.data.dispatchError).toBe('lease_lost');
    expect(call.data).not.toHaveProperty('enqueuedAt');
  });
});
