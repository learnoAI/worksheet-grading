import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import internalWs from './internalWorksheetGeneration';
import type { AppBindings } from '../types';

const WORKER_TOKEN = 'worker-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/internal/worksheet-generation', internalWs);
  return app;
}

async function authed(
  app: Hono<AppBindings>,
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  return app.request(
    path,
    {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        'X-Worksheet-Creation-Token': WORKER_TOKEN,
      },
    },
    { WORKSHEET_CREATION_WORKER_TOKEN: WORKER_TOKEN }
  );
}

async function postJson(
  app: Hono<AppBindings>,
  path: string,
  body: unknown
): Promise<Response> {
  return authed(app, path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('auth on /internal/worksheet-generation/*', () => {
  it('rejects requests without the worker token', async () => {
    const app = mountApp({ generatedWorksheet: { findUnique: vi.fn() } });
    const res = await app.request(
      '/internal/worksheet-generation/w1/data',
      {},
      { WORKSHEET_CREATION_WORKER_TOKEN: WORKER_TOKEN }
    );
    expect(res.status).toBe(401);
  });

  it('returns 500 when WORKSHEET_CREATION_WORKER_TOKEN is not configured', async () => {
    const app = mountApp({ generatedWorksheet: { findUnique: vi.fn() } });
    const res = await app.request(
      '/internal/worksheet-generation/w1/data',
      { headers: { 'X-Worksheet-Creation-Token': 'anything' } }
    );
    expect(res.status).toBe(500);
  });
});

describe('GET /internal/worksheet-generation/:id/data', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when the worksheet does not exist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const app = mountApp({ generatedWorksheet: { findUnique } });
    const res = await authed(app, '/internal/worksheet-generation/missing/data');
    expect(res.status).toBe(404);
  });

  it('returns the worksheet projection on success', async () => {
    const row = {
      id: 'w1',
      studentId: 'st1',
      batchId: 'b1',
      sectionsJson: { foo: 'bar' },
      status: 'PENDING',
    };
    const findUnique = vi.fn().mockResolvedValue(row);
    const app = mountApp({ generatedWorksheet: { findUnique } });
    const res = await authed(app, '/internal/worksheet-generation/w1/data');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: row });
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'w1' } })
    );
  });
});

describe('POST /internal/worksheet-generation/:id/complete — first-time transitions', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects body without pdfUrl', async () => {
    const app = mountApp({ generatedWorksheet: { updateMany: vi.fn() } });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {});
    expect(res.status).toBe(400);
  });

  it('uses a status-guarded updateMany so replays are no-ops', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique: vi.fn() },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
      pdfUrl: 'https://cdn/x.pdf',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    // Conditional WHERE guards against double-write on CF Queue replays.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', status: { notIn: ['COMPLETED', 'FAILED'] } },
      data: { pdfUrl: 'https://cdn/x.pdf', status: 'COMPLETED' },
    });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('accepts an explicit batchId: null (pdf-renderer wire format)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique: vi.fn() },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
      pdfUrl: 'https://cdn/worksheet.pdf',
      batchId: null,
    });
    expect(res.status).toBe(200);
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('increments completedWorksheets on the batch when batchId is provided', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn().mockResolvedValue({
      completedWorksheets: 2,
      failedWorksheets: 0,
      totalWorksheets: 5,
    });
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique: vi.fn() },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
      pdfUrl: 'https://cdn/x.pdf',
      batchId: 'b1',
    });
    expect(res.status).toBe(200);
    expect(batchUpdate).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { completedWorksheets: { increment: 1 } },
    });
  });

  it('marks batch COMPLETED when total worksheets are done', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi
      .fn()
      .mockResolvedValueOnce({
        completedWorksheets: 5,
        failedWorksheets: 0,
        totalWorksheets: 5,
      })
      .mockResolvedValueOnce({});
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique: vi.fn() },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
      pdfUrl: 'https://cdn/x.pdf',
      batchId: 'b1',
    });
    expect(res.status).toBe(200);
    expect(batchUpdate).toHaveBeenCalledTimes(2);
    expect(batchUpdate).toHaveBeenNthCalledWith(2, {
      where: { id: 'b1' },
      data: { status: 'COMPLETED' },
    });
  });

  it('still returns 200 when the batch callback fails (non-fatal)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn().mockRejectedValue(new Error('db down'));
    // Silence console.error so test output stays readable.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique: vi.fn() },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
      pdfUrl: 'https://cdn/x.pdf',
      batchId: 'b1',
    });
    expect(res.status).toBe(200);
    errSpy.mockRestore();
  });
});

describe('POST /internal/worksheet-generation/:id/complete — idempotent replays + 404', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when updateMany count=0 AND the row does not exist', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue(null);
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(
      app,
      '/internal/worksheet-generation/missing/complete',
      { pdfUrl: 'https://cdn/x.pdf', batchId: 'b1' }
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Worksheet not found' });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('returns {success:true, idempotent:true} when row exists and is already terminal', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({ id: 'w1' });
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
      pdfUrl: 'https://cdn/x.pdf',
      batchId: 'b1',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, idempotent: true });
    // CRITICAL: replays must NOT increment the batch counter.
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('three replayed /complete calls increment the batch counter exactly once', async () => {
    // First call: PENDING → COMPLETED (count=1).
    // Next two: row already terminal (count=0, findUnique returns the row).
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 0 });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'w1' })
      .mockResolvedValueOnce({ id: 'w1' });
    const batchUpdate = vi.fn().mockResolvedValue({
      completedWorksheets: 1,
      failedWorksheets: 0,
      totalWorksheets: 5,
    });
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique },
      worksheetBatch: { update: batchUpdate },
    });
    for (let i = 0; i < 3; i++) {
      const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
        pdfUrl: 'https://cdn/x.pdf',
        batchId: 'b1',
      });
      expect(res.status).toBe(200);
    }
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchUpdate).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { completedWorksheets: { increment: 1 } },
    });
  });
});

describe('POST /internal/worksheet-generation/:id/fail — first-time + replays', () => {
  beforeEach(() => vi.clearAllMocks());

  it('accepts an explicit batchId: null on /fail (pdf-renderer wire format)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique: vi.fn() },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/fail', {
      error: 'rendering failed',
      batchId: null,
    });
    expect(res.status).toBe(200);
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('marks the worksheet FAILED via status-guarded updateMany even without a batchId', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique: vi.fn() },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/fail', {
      error: 'render crashed',
    });
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', status: { notIn: ['COMPLETED', 'FAILED'] } },
      data: { status: 'FAILED' },
    });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('increments failedWorksheets on the batch when batchId is provided', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn().mockResolvedValue({
      completedWorksheets: 3,
      failedWorksheets: 1,
      totalWorksheets: 5,
    });
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique: vi.fn() },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/fail', {
      batchId: 'b1',
    });
    expect(res.status).toBe(200);
    expect(batchUpdate).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { failedWorksheets: { increment: 1 } },
    });
  });

  it('cross-state replay: /fail after the row already went COMPLETED → idempotent, no counter', async () => {
    // updateMany returns count=0 because the row is COMPLETED (terminal).
    // findUnique returns the row → idempotent reply, no failedWorksheets bump.
    // Protects against the "transient 503 on /complete made the consumer
    // fall back to /fail even though /complete actually succeeded
    // server-side" scenario.
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue({ id: 'w1' });
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/fail', {
      batchId: 'b1',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, idempotent: true });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('returns 404 when /fail is called for a row that does not exist', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findUnique = vi.fn().mockResolvedValue(null);
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { updateMany, findUnique },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/missing/fail', {
      batchId: 'b1',
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Worksheet not found' });
    expect(batchUpdate).not.toHaveBeenCalled();
  });
});
