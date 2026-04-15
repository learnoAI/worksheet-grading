import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { expressFallback } from './fallback';
import type { AppBindings } from './types';

function buildApp(fetchImpl: typeof fetch) {
  const app = new Hono<AppBindings>();
  app.get('/api/known', (c) => c.json({ handledByHono: true }));
  // Catch-all must be the LAST mount — matches how index.ts will wire it.
  app.all('*', expressFallback({ fetchImpl }));
  return app;
}

function mockUpstream(
  statusOrResponse: number | Response,
  body: BodyInit | null = null,
  headers: Record<string, string> = {}
): ReturnType<typeof vi.fn> {
  return vi.fn(async (_url: string, _init: RequestInit) => {
    if (statusOrResponse instanceof Response) return statusOrResponse;
    return new Response(body, { status: statusOrResponse, headers });
  });
}

const ENV = { EXPRESS_FALLBACK_URL: 'https://express.example.com/prefix' };

describe('expressFallback — routing', () => {
  beforeEach(() => vi.clearAllMocks());

  it('does NOT fall back for routes Hono handles', async () => {
    const fetchSpy = vi.fn();
    const app = buildApp(fetchSpy as unknown as typeof fetch);
    const res = await app.request('/api/known', {}, ENV);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ handledByHono: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns 404 with a clear message when EXPRESS_FALLBACK_URL is unset', async () => {
    const app = buildApp(mockUpstream(200) as unknown as typeof fetch);
    const res = await app.request('/api/unknown', {}, {});
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('EXPRESS_FALLBACK_URL');
  });

  it('forwards the path and query string verbatim', async () => {
    const upstream = mockUpstream(200, JSON.stringify({ ok: true }), {
      'content-type': 'application/json',
    });
    const app = buildApp(upstream as unknown as typeof fetch);
    const res = await app.request('/api/unknown?a=1&b=2', {}, ENV);
    expect(res.status).toBe(200);
    const [url, init] = upstream.mock.calls[0];
    expect(url).toBe('https://express.example.com/prefix/api/unknown?a=1&b=2');
    expect((init as RequestInit).method).toBe('GET');
  });
});

describe('expressFallback — request passthrough', () => {
  beforeEach(() => vi.clearAllMocks());

  it('forwards method, body, and non-hop-by-hop headers', async () => {
    const upstream = mockUpstream(200);
    const app = buildApp(upstream as unknown as typeof fetch);
    await app.request(
      '/api/unknown',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer abc',
          'Cf-Connecting-Ip': '203.0.113.7',
          Connection: 'keep-alive', // hop-by-hop — must be stripped
        },
        body: JSON.stringify({ x: 1 }),
      },
      ENV
    );
    const init = upstream.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe('POST');
    const h = init.headers as Headers;
    expect(h.get('content-type')).toBe('application/json');
    expect(h.get('authorization')).toBe('Bearer abc');
    expect(h.get('connection')).toBeNull(); // hop-by-hop stripped
    expect(h.get('cf-connecting-ip')).toBeNull(); // cf header stripped
    expect(h.get('x-forwarded-for')).toBe('203.0.113.7');
    expect(h.get('x-forwarded-via')).toBe('hono-worker');
  });

  it('does not forward a body for GET/HEAD', async () => {
    const upstream = mockUpstream(200);
    const app = buildApp(upstream as unknown as typeof fetch);
    await app.request('/api/unknown', { method: 'GET' }, ENV);
    expect((upstream.mock.calls[0][1] as RequestInit).body).toBeUndefined();
  });
});

describe('expressFallback — response passthrough', () => {
  beforeEach(() => vi.clearAllMocks());

  it('streams status, headers, and body from upstream to client', async () => {
    const upstreamRes = new Response(JSON.stringify({ result: 'upstream' }), {
      status: 201,
      headers: {
        'content-type': 'application/json',
        'x-custom': 'from-express',
        'transfer-encoding': 'chunked', // hop-by-hop — must be stripped
      },
    });
    const upstream = mockUpstream(upstreamRes);
    const app = buildApp(upstream as unknown as typeof fetch);
    const res = await app.request('/api/unknown', { method: 'POST' }, ENV);
    expect(res.status).toBe(201);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(res.headers.get('x-custom')).toBe('from-express');
    expect(res.headers.get('transfer-encoding')).toBeNull();
    expect(await res.json()).toEqual({ result: 'upstream' });
  });

  it('returns 502 when upstream fetch rejects', async () => {
    const upstream = vi.fn(async () => {
      throw new TypeError('network failure');
    });
    const app = buildApp(upstream as unknown as typeof fetch);
    const res = await app.request('/api/unknown', { method: 'POST' }, ENV);
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string; detail: string };
    expect(body.error).toContain('unreachable');
    expect(body.detail).toContain('network failure');
  });

  it('passes through upstream 4xx/5xx statuses verbatim', async () => {
    const upstream = mockUpstream(500, 'internal boom');
    const app = buildApp(upstream as unknown as typeof fetch);
    const res = await app.request('/api/unknown', {}, ENV);
    expect(res.status).toBe(500);
    expect(await res.text()).toBe('internal boom');
  });
});

describe('expressFallback — base URL handling', () => {
  it('accepts upstream URLs with trailing slash', async () => {
    const upstream = mockUpstream(200);
    const app = buildApp(upstream as unknown as typeof fetch);
    await app.request('/api/unknown', {}, { EXPRESS_FALLBACK_URL: 'https://a.com/b/' });
    expect(upstream.mock.calls[0][0]).toBe('https://a.com/b/api/unknown');
  });
});
