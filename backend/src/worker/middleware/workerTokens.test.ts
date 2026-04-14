import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requireGradingWorkerToken, requireWorksheetCreationToken } from './workerTokens';
import type { AppBindings } from '../types';

function buildGradingApp() {
  const app = new Hono<AppBindings>();
  app.use('/internal/*', requireGradingWorkerToken);
  app.get('/internal/ping', (c) => c.json({ ok: true }));
  return app;
}

function buildWorksheetCreationApp() {
  const app = new Hono<AppBindings>();
  app.use('/internal/*', requireWorksheetCreationToken);
  app.get('/internal/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('requireGradingWorkerToken', () => {
  it('returns 500 when GRADING_WORKER_TOKEN is not configured', async () => {
    const app = buildGradingApp();
    const res = await app.request('/internal/ping', {
      headers: { 'X-Grading-Worker-Token': 'whatever' },
    });
    expect(res.status).toBe(500);
    expect(await res.json()).toMatchObject({ success: false });
  });

  it('returns 401 when token header is missing', async () => {
    const app = buildGradingApp();
    const res = await app.request('/internal/ping', {}, { GRADING_WORKER_TOKEN: 'expected' });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Unauthorized' });
  });

  it('returns 401 when token does not match', async () => {
    const app = buildGradingApp();
    const res = await app.request(
      '/internal/ping',
      { headers: { 'X-Grading-Worker-Token': 'wrong' } },
      { GRADING_WORKER_TOKEN: 'expected' }
    );
    expect(res.status).toBe(401);
  });

  it('passes through when token matches', async () => {
    const app = buildGradingApp();
    const res = await app.request(
      '/internal/ping',
      { headers: { 'X-Grading-Worker-Token': 'expected' } },
      { GRADING_WORKER_TOKEN: 'expected' }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('requireWorksheetCreationToken', () => {
  it('returns 500 when secret is not configured', async () => {
    const app = buildWorksheetCreationApp();
    const res = await app.request('/internal/ping', {
      headers: { 'X-Worksheet-Creation-Token': 'whatever' },
    });
    expect(res.status).toBe(500);
  });

  it('returns 401 on mismatch', async () => {
    const app = buildWorksheetCreationApp();
    const res = await app.request(
      '/internal/ping',
      { headers: { 'X-Worksheet-Creation-Token': 'wrong' } },
      { WORKSHEET_CREATION_WORKER_TOKEN: 'expected' }
    );
    expect(res.status).toBe(401);
  });

  it('passes through on match', async () => {
    const app = buildWorksheetCreationApp();
    const res = await app.request(
      '/internal/ping',
      { headers: { 'X-Worksheet-Creation-Token': 'expected' } },
      { WORKSHEET_CREATION_WORKER_TOKEN: 'expected' }
    );
    expect(res.status).toBe(200);
  });
});
