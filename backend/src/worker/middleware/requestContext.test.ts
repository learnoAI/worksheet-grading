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

  it('prefixes every sane inbound X-Request-Id (no caller is trusted to skip)', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: { 'X-Request-Id': 'abc-123_XYZ' },
    });
    // All inbound IDs are namespaced so they cannot be confused with
    // internally generated UUIDs in log searches. There is no exemption
    // for headers like X-Grading-Worker-Token — those are only validated
    // by the per-route auth middleware, not here.
    expect(res.headers.get('X-Request-Id')).toBe('ext:abc-123_XYZ');
    expect(((await res.json()) as { requestId: string }).requestId).toBe('ext:abc-123_XYZ');
  });

  it('still prefixes when an attacker-spoofed worker-token header is present', async () => {
    // Regression: an earlier version skipped the prefix when an
    // X-Grading-Worker-Token header was present, which was a bypassable
    // header-presence check. The token's *value* is only validated at
    // protected routes, so this middleware must not branch on it.
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: {
        'X-Request-Id': 'abc-123_XYZ',
        'X-Grading-Worker-Token': 'not-a-real-secret',
      },
    });
    expect(res.headers.get('X-Request-Id')).toBe('ext:abc-123_XYZ');
  });

  it('does not double-prefix an already-namespaced inbound id (e.g. on fallback re-entry)', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: { 'X-Request-Id': 'ext:abc-123_XYZ' },
    });
    expect(res.headers.get('X-Request-Id')).toBe('ext:abc-123_XYZ');
  });

  it('generates a fresh id when the inbound header has disallowed characters', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: { 'X-Request-Id': 'not ok!' },
    });
    const id = res.headers.get('X-Request-Id');
    expect(id).not.toBe('not ok!');
    expect(id).not.toBe('ext:not ok!');
    expect(id).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('ignores an overly long inbound X-Request-Id', async () => {
    const app = buildApp();
    const tooLong = 'a'.repeat(200);
    const res = await app.request('/ping', { headers: { 'X-Request-Id': tooLong } });
    const id = res.headers.get('X-Request-Id') ?? '';
    expect(id.length).toBeLessThan(200);
    expect(id).not.toContain(tooLong);
  });

  it('exposes the worker-chosen id on c.var.requestId for downstream consumers', async () => {
    // The CF Workers runtime makes the inbound Request.headers immutable,
    // so we deliberately do NOT mutate `c.req.raw.headers` in middleware.
    // Downstream consumers (e.g. the fallback proxy) read `c.var.requestId`.
    const app = new Hono<AppBindings>();
    app.use('*', requestContext);
    app.get('/echo-var', (c) => c.json({ chosen: c.get('requestId') }));
    const res = await app.request('/echo-var', {
      headers: { 'X-Request-Id': 'attacker-supplied-id' },
    });
    const body = (await res.json()) as { chosen: string };
    expect(body.chosen).toBe('ext:attacker-supplied-id');
  });

  it('generates distinct ids across requests', async () => {
    const app = buildApp();
    const a = await app.request('/ping');
    const b = await app.request('/ping');
    expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'));
  });
});
