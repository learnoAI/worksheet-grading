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

describe('POST /internal/worksheet-generation/:id/complete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects body without pdfUrl', async () => {
    const app = mountApp({ generatedWorksheet: { update: vi.fn() } });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {});
    expect(res.status).toBe(400);
  });

  it('marks the worksheet COMPLETED and records pdfUrl when no batchId', async () => {
    const update = vi.fn().mockResolvedValue({});
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { update },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
      pdfUrl: 'https://cdn/worksheet.pdf',
    });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { pdfUrl: 'https://cdn/worksheet.pdf', status: 'COMPLETED' },
    });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('increments completedWorksheets on the batch when batchId is provided', async () => {
    const update = vi.fn().mockResolvedValue({});
    const batchUpdate = vi.fn().mockResolvedValue({
      completedWorksheets: 2,
      failedWorksheets: 0,
      totalWorksheets: 5,
    });
    const app = mountApp({
      generatedWorksheet: { update },
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
    const update = vi.fn().mockResolvedValue({});
    // First call returns the batch state post-increment (threshold reached),
    // the inline helper then issues the second update to flip status.
    const batchUpdate = vi
      .fn()
      .mockResolvedValueOnce({
        completedWorksheets: 5,
        failedWorksheets: 0,
        totalWorksheets: 5,
      })
      .mockResolvedValueOnce({});
    const app = mountApp({
      generatedWorksheet: { update },
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
    const update = vi.fn().mockResolvedValue({});
    const batchUpdate = vi.fn().mockRejectedValue(new Error('db down'));
    const app = mountApp({
      generatedWorksheet: { update },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/complete', {
      pdfUrl: 'https://cdn/x.pdf',
      batchId: 'b1',
    });
    expect(res.status).toBe(200);
  });
});

describe('POST /internal/worksheet-generation/:id/fail', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks the worksheet FAILED even without a batchId', async () => {
    const update = vi.fn().mockResolvedValue({});
    const batchUpdate = vi.fn();
    const app = mountApp({
      generatedWorksheet: { update },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await postJson(app, '/internal/worksheet-generation/w1/fail', {
      error: 'render crashed',
    });
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'w1' },
      data: { status: 'FAILED' },
    });
    expect(batchUpdate).not.toHaveBeenCalled();
  });

  it('increments failedWorksheets on the batch when batchId is provided', async () => {
    const update = vi.fn().mockResolvedValue({});
    const batchUpdate = vi.fn().mockResolvedValue({
      completedWorksheets: 3,
      failedWorksheets: 1,
      totalWorksheets: 5,
    });
    const app = mountApp({
      generatedWorksheet: { update },
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
});
