import { describe, expect, it, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { requestContext } from './requestContext';
import type { AppBindings, WorkerEnv } from '../types';

function buildApp() {
  const app = new Hono<AppBindings>();
  app.use('*', requestContext);
  app.get('/ping', (c) => c.json({ requestId: c.get('requestId') }));
  return app;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function mockFetchOK(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(async (..._args: Parameters<typeof fetch>) =>
    new Response(null, { status: 200 })
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const PH_ENV: Partial<WorkerEnv> = {
  POSTHOG_API_KEY: 'phc_xyz',
  NODE_ENV: 'test',
};

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

describe('requestContext — diagnostics emission', () => {
  function buildEmittingApp() {
    const app = new Hono<AppBindings>();
    app.use('*', requestContext);
    app.get('/api/grading-jobs/:jobId/echo', (c) =>
      c.json({ ok: true, jobId: c.req.param('jobId') })
    );
    app.get('/slow', async (c) => {
      // Simulated slow handler — surpasses the 50ms threshold below.
      await new Promise((r) => setTimeout(r, 80));
      return c.json({ ok: true });
    });
    app.get('/server-error', (c) => c.json({ message: 'boom' }, 500));
    app.get('/client-error', (c) => c.json({ message: 'bad request' }, 400));
    app.get('/ok', (c) => c.json({ ok: true }));
    app.post('/api/grading-jobs/explode', (c) =>
      c.json({ message: 'rejected' }, 400)
    );
    return app;
  }

  it('emits backend_request_diagnostic with diagnosticType=server_error on 5xx', async () => {
    const fetchMock = mockFetchOK();
    const app = buildEmittingApp();
    const res = await app.request('/server-error', undefined, PH_ENV);
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.event).toBe('backend_request_diagnostic');
    expect(body.properties.diagnosticType).toBe('server_error');
    expect(body.properties.statusCode).toBe(500);
    expect(body.properties.path).toBe('/server-error');
    expect(body.properties.method).toBe('GET');
    expect(body.properties.aborted).toBe(false);
    expect(body.properties.category).toBe('other');
  });

  it('emits backend_request_diagnostic with diagnosticType=slow_request when handler exceeds threshold', async () => {
    const fetchMock = mockFetchOK();
    const app = buildEmittingApp();
    // Set a tight threshold so /slow definitely trips it.
    const env = { ...PH_ENV, REQUEST_DIAGNOSTICS_SLOW_MS: '50' };
    const res = await app.request('/slow', undefined, env);
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.event).toBe('backend_request_diagnostic');
    expect(body.properties.diagnosticType).toBe('slow_request');
    expect(body.properties.durationMs).toBeGreaterThanOrEqual(50);
  });

  it('emits backend_request_client_error on 4xx (sampled — randomness mocked)', async () => {
    const fetchMock = mockFetchOK();
    // Force the sampler to always pass.
    vi.spyOn(Math, 'random').mockReturnValue(0);
    const app = buildEmittingApp();
    const res = await app.request('/client-error', undefined, PH_ENV);
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.event).toBe('backend_request_client_error');
    expect(body.properties.statusCode).toBe(400);
    expect(body.properties.sampleRate).toBe(0.1);
  });

  it('drops 4xx events when the random sampler rejects', async () => {
    const fetchMock = mockFetchOK();
    vi.spyOn(Math, 'random').mockReturnValue(0.99);
    const app = buildEmittingApp();
    await app.request('/client-error', undefined, PH_ENV);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not emit anything for fast 2xx responses', async () => {
    const fetchMock = mockFetchOK();
    const env = { ...PH_ENV, REQUEST_DIAGNOSTICS_SLOW_MS: '5000' };
    const app = buildEmittingApp();
    await app.request('/ok', undefined, env);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('respects REQUEST_DIAGNOSTICS_ENABLED=false to skip all emissions', async () => {
    const fetchMock = mockFetchOK();
    const env = { ...PH_ENV, REQUEST_DIAGNOSTICS_ENABLED: 'false' };
    const app = buildEmittingApp();
    // Even a 5xx should not emit when disabled.
    await app.request('/server-error', undefined, env);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('threads jobId param into the payload', async () => {
    const fetchMock = mockFetchOK();
    const app = buildEmittingApp();
    // Hit a 5xx-like path that includes a jobId param. We use a route
    // that returns a non-2xx so an event fires.
    app.get('/api/grading-jobs/:jobId/fail', (c) => c.json({ x: 1 }, 500));
    const res = await app.request('/api/grading-jobs/JOB-7/fail', undefined, PH_ENV);
    expect(res.status).toBe(500);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.properties.jobId).toBe('JOB-7');
    expect(body.properties.category).toBe('grading_jobs_api');
  });

  it('summarizes request body shape on /grading paths', async () => {
    const fetchMock = mockFetchOK();
    vi.spyOn(Math, 'random').mockReturnValue(0); // force sample-pass
    const app = buildEmittingApp();
    const res = await app.request(
      '/api/grading-jobs/explode',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leaseId: 'l-1', reason: 'because', extra: { a: 1 } }),
      },
      PH_ENV
    );
    expect(res.status).toBe(400);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.properties.requestBodySummary).toBeDefined();
    expect((body.properties.requestBodySummary as Record<string, unknown>).bodyType).toBe('object');
    expect((body.properties.requestBodySummary as Record<string, unknown>).bodyKeys).toEqual(
      expect.arrayContaining(['leaseId', 'reason', 'extra'])
    );
  });

  it('skips PostHog when POSTHOG_API_KEY is unset (no-op posthog adapter)', async () => {
    const fetchMock = mockFetchOK();
    const app = buildEmittingApp();
    // No api key in env.
    await app.request('/server-error', undefined, {});
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
