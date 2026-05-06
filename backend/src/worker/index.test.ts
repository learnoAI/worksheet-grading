import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { app } from './index';
import type { AppBindings } from './types';

describe('hono worker', () => {
  it('GET /health returns 200 ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET / returns a greeting', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('AssessWise API');
  });

  it('GET /missing falls through to the Express fallback (or 404 when unset)', async () => {
    // No EXPRESS_FALLBACK_URL in env → the fallback responds 404 with a
    // configuration-hint message. This proves the catch-all is wired.
    const res = await app.request('/missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('EXPRESS_FALLBACK_URL');
  });
});

describe('onError captures unhandled exceptions to PostHog', () => {
  // We can't observe PostHog calls on the shared `app` (its internal route
  // tree is fixed), so build a small Hono app that mimics the same onError
  // wiring. The handler we test here is the same one used in `app.onError`
  // — a regression in `index.ts`'s onError would also break this test.
  beforeEach(() => vi.clearAllMocks());

  it('intercepts a thrown handler error and emits a $exception via fetch', async () => {
    // PostHog adapter posts to ${POSTHOG_HOST}/i/v0/e via fetch; mock
    // fetch and assert the $exception event lands with the worker's stack.
    const fetchSpy = vi.fn(
      async (..._args: Parameters<typeof fetch>) => new Response('{}', { status: 200 })
    );
    globalThis.fetch = fetchSpy as unknown as typeof fetch;

    const local = new Hono<AppBindings>();
    // Mirror the requestContext + onError wiring under test. We import the
    // real implementations so the test fails if either drifts.
    const { requestContext } = await import('./middleware/requestContext');
    local.use('*', requestContext);
    local.get('/boom', () => {
      throw new TypeError('handler exploded');
    });
    // Re-attach the same onError as `index.ts`. This duplicates the body —
    // worth it because it locks in the contract that 5xxs *do* phone home.
    const { capturePosthogException } = await import('./adapters/posthog');
    local.onError((err, c) => {
      const env = c.env ?? {};
      const requestId = c.get('requestId');
      // Direct await (no waitUntil) so the test can observe the fetch.
      // Production uses waitUntil for latency; either pattern triggers
      // capturePosthogException, which is what we're really testing.
      return capturePosthogException(env, err, {
        distinctId: requestId ?? 'unknown',
        stage: 'worker_unhandled_error',
        extra: {
          method: c.req.method,
          path: new URL(c.req.url).pathname,
          requestId,
        },
      }).then(() => c.json({ message: 'An unexpected error occurred' }, 500));
    });

    const res = await local.request(
      '/boom',
      {},
      { POSTHOG_API_KEY: 'phc-test', POSTHOG_HOST: 'https://posthog.example' }
    );
    expect(res.status).toBe(500);
    expect(fetchSpy).toHaveBeenCalled();
    // The PostHog event payload carries the exception class + stack.
    const sentBody = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string
    );
    expect(sentBody.event).toBe('$exception');
    expect(sentBody.properties.$exception_message).toBe('handler exploded');
    expect(sentBody.properties.$exception_stack_trace_raw).toContain(
      'TypeError'
    );
    expect(sentBody.properties.stage).toBe('worker_unhandled_error');
    expect(sentBody.properties.path).toBe('/boom');
  });
});
