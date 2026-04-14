import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { requestContext } from './requestContext';
import type { AppBindings } from '../types';

function buildApp() {
  const app = new Hono<AppBindings>();
  app.use('*', requestContext);
  app.get('/ping', (c) => c.json({ requestId: c.get('requestId') }));
  return app;
}

describe('requestContext middleware', () => {
  it('generates a request id and sets it on the response', async () => {
    const app = buildApp();
    const res = await app.request('/ping');
    expect(res.status).toBe(200);
    const headerId = res.headers.get('X-Request-Id');
    expect(headerId).toBeTruthy();
    expect(headerId).toMatch(/^[A-Za-z0-9_-]+$/);

    const body = (await res.json()) as { requestId: string };
    expect(body.requestId).toBe(headerId);
  });

  it('honors a sane inbound X-Request-Id header', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: { 'X-Request-Id': 'abc-123_XYZ' },
    });
    expect(res.headers.get('X-Request-Id')).toBe('abc-123_XYZ');
    expect(((await res.json()) as { requestId: string }).requestId).toBe('abc-123_XYZ');
  });

  it('generates a fresh id when the inbound header has disallowed characters', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: { 'X-Request-Id': 'not ok!' },
    });
    const id = res.headers.get('X-Request-Id');
    expect(id).not.toBe('not ok!');
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('ignores an overly long inbound X-Request-Id', async () => {
    const app = buildApp();
    const tooLong = 'a'.repeat(200);
    const res = await app.request('/ping', { headers: { 'X-Request-Id': tooLong } });
    expect(res.headers.get('X-Request-Id')?.length ?? 0).toBeLessThan(200);
  });

  it('generates distinct ids across requests', async () => {
    const app = buildApp();
    const a = await app.request('/ping');
    const b = await app.request('/ping');
    expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'));
  });
});
