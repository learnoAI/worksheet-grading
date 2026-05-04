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

  it('prefixes a sane inbound X-Request-Id from an untrusted (external) caller', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: { 'X-Request-Id': 'abc-123_XYZ' },
    });
    // External callers are namespaced so their IDs cannot be confused with
    // internally generated UUIDs in log searches.
    expect(res.headers.get('X-Request-Id')).toBe('ext:abc-123_XYZ');
    expect(((await res.json()) as { requestId: string }).requestId).toBe('ext:abc-123_XYZ');
  });

  it('honors a sane inbound X-Request-Id from a trusted internal caller (grading worker)', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: {
        'X-Request-Id': 'abc-123_XYZ',
        'X-Grading-Worker-Token': 'whatever-the-secret-is',
      },
    });
    // Presence of the worker-token header is enough to mark the caller as
    // internal for ID purposes — the actual secret check happens in
    // `workerTokens.ts` per-route. The middleware here is not the gate.
    expect(res.headers.get('X-Request-Id')).toBe('abc-123_XYZ');
  });

  it('honors a sane inbound X-Request-Id from a trusted internal caller (worksheet creation)', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {
      headers: {
        'X-Request-Id': 'abc-123_XYZ',
        'X-Worksheet-Creation-Token': 'whatever-the-secret-is',
      },
    });
    expect(res.headers.get('X-Request-Id')).toBe('abc-123_XYZ');
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

  it('overwrites X-Request-Id on the underlying request so downstream proxies forward the worker-chosen id', async () => {
    const app = new Hono<AppBindings>();
    app.use('*', requestContext);
    // Echo back the *request* header, not the response header, to prove the
    // worker mutated the inbound header for downstream consumers (fallback).
    app.get('/echo-req', (c) => c.json({ inbound: c.req.raw.headers.get('X-Request-Id') }));
    const res = await app.request('/echo-req', {
      headers: { 'X-Request-Id': 'attacker-supplied-id' },
    });
    const body = (await res.json()) as { inbound: string };
    expect(body.inbound).toBe('ext:attacker-supplied-id');
  });

  it('generates distinct ids across requests', async () => {
    const app = buildApp();
    const a = await app.request('/ping');
    const b = await app.request('/ping');
    expect(a.headers.get('X-Request-Id')).not.toBe(b.headers.get('X-Request-Id'));
  });
});
