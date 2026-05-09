import { describe, expect, it, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import { tryParseJsonBody } from './parseJson';
import type { AppBindings } from '../types';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockFetchOK(): ReturnType<typeof vi.fn> {
  const fn = vi.fn(
    async (..._args: Parameters<typeof fetch>) => new Response(null, { status: 200 })
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function buildApp() {
  const app = new Hono<AppBindings>();
  app.post('/echo', async (c) => {
    const body = await tryParseJsonBody<{ x?: number }>(c);
    if (body === undefined) {
      return c.json({ message: 'Invalid request body' }, 400);
    }
    return c.json({ ok: true, x: body.x ?? null });
  });
  return app;
}

describe('tryParseJsonBody', () => {
  it('returns the parsed body on valid JSON and does not emit', async () => {
    const fetchMock = mockFetchOK();
    const app = buildApp();
    const res = await app.request(
      '/echo',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ x: 7 }),
      },
      { POSTHOG_API_KEY: 'k' }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; x: number };
    expect(body).toEqual({ ok: true, x: 7 });
    // No PostHog emission on the happy path.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns undefined and fires backend_request_body_parse_error on malformed JSON', async () => {
    const fetchMock = mockFetchOK();
    const app = buildApp();
    const res = await app.request(
      '/echo',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      },
      { POSTHOG_API_KEY: 'k' }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe('Invalid request body');
    // Exactly one PostHog event with the expected payload shape.
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(sent.event).toBe('backend_request_body_parse_error');
    expect(sent.properties.path).toBe('/echo');
    expect(sent.properties.method).toBe('POST');
    expect(typeof sent.properties.errorMessage).toBe('string');
  });

  it('skips PostHog emission when POSTHOG_API_KEY is unset', async () => {
    const fetchMock = mockFetchOK();
    const app = buildApp();
    const res = await app.request(
      '/echo',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '}{',
      },
      {} // no api key
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('threads the routes /-prefixed path into the event payload', async () => {
    const fetchMock = mockFetchOK();
    const app = new Hono<AppBindings>();
    app.post('/api/widgets/create', async (c) => {
      const body = await tryParseJsonBody<unknown>(c);
      if (body === undefined) {
        return c.json({ message: 'bad' }, 400);
      }
      return c.json({ ok: true });
    });
    await app.request(
      '/api/widgets/create',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: 'garbage',
      },
      { POSTHOG_API_KEY: 'k' }
    );
    const sent = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(sent.properties.path).toBe('/api/widgets/create');
  });
});
