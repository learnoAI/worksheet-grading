import { describe, expect, it, afterEach, beforeEach, vi } from 'vitest';
import { capturePosthogEvent, capturePosthogException } from './posthog';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function mockFetch(responder: (call: number) => Promise<Response> | Response) {
  let i = 0;
  const fn = vi.fn(async () => {
    const out = await responder(i);
    i++;
    return out;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('capturePosthogEvent — skipped when disabled', () => {
  it('does not call fetch when POSTHOG_API_KEY is not set', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await capturePosthogEvent({}, 'evt', 'u-1', { x: 1 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('capturePosthogEvent — success path', () => {
  it('POSTs to the default host with the PostHog payload shape', async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 200 }));
    await capturePosthogEvent(
      { POSTHOG_API_KEY: 'phc_xyz', NODE_ENV: 'test', GIT_SHA: 'abc123' },
      'grading_pipeline',
      'job-1',
      { jobId: 'job-1', grade: 7 }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://us.i.posthog.com/capture/');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.api_key).toBe('phc_xyz');
    expect(body.event).toBe('grading_pipeline');
    expect(body.distinct_id).toBe('job-1');
    expect(body.properties.service).toBe('worksheet-grading-backend');
    expect(body.properties.environment).toBe('test');
    expect(body.properties.release).toBe('abc123');
    expect(body.properties.jobId).toBe('job-1');
    expect(body.properties.grade).toBe(7);
    expect(typeof body.timestamp).toBe('string');
  });

  it('honors POSTHOG_HOST override and strips trailing slash', async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 200 }));
    await capturePosthogEvent(
      { POSTHOG_API_KEY: 'k', POSTHOG_HOST: 'https://eu.i.posthog.com/' },
      'evt',
      'u-1'
    );
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://eu.i.posthog.com/capture/');
  });

  it('serializes Date values and drops undefined properties', async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 200 }));
    await capturePosthogEvent({ POSTHOG_API_KEY: 'k' }, 'evt', 'u-1', {
      when: new Date('2026-04-10T10:00:00Z'),
      omitMe: undefined,
      keep: 1,
    });
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.properties.when).toBe('2026-04-10T10:00:00.000Z');
    expect(body.properties.omitMe).toBeUndefined();
    expect(body.properties.keep).toBe(1);
  });
});

describe('capturePosthogEvent — retries and failure tolerance', () => {
  beforeEach(() => vi.useFakeTimers());

  it('retries once on 502 and succeeds', async () => {
    const fetchMock = mockFetch((i) =>
      i === 0 ? new Response('bad', { status: 502 }) : new Response(null, { status: 200 })
    );
    const promise = capturePosthogEvent(
      { POSTHOG_API_KEY: 'k' },
      'evt',
      'u-1',
      {},
      { maxRetries: 2, baseDelayMs: 5, timeoutMs: 100 }
    );
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('swallows terminal failure and does not throw', async () => {
    mockFetch(() => new Response('bad', { status: 500 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const promise = capturePosthogEvent(
      { POSTHOG_API_KEY: 'k' },
      'evt',
      'u-1',
      {},
      { maxRetries: 2, baseDelayMs: 5, timeoutMs: 100 }
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('does not retry on 400 client errors', async () => {
    const fetchMock = mockFetch(() => new Response('bad', { status: 400 }));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await capturePosthogEvent(
      { POSTHOG_API_KEY: 'k' },
      'evt',
      'u-1',
      {},
      { maxRetries: 3, baseDelayMs: 5, timeoutMs: 100 }
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('never throws on network error', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('network');
    }) as unknown as typeof fetch;
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const promise = capturePosthogEvent(
      { POSTHOG_API_KEY: 'k' },
      'evt',
      'u-1',
      {},
      { maxRetries: 2, baseDelayMs: 5, timeoutMs: 100 }
    );
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBeUndefined();
    warn.mockRestore();
  });
});

describe('capturePosthogException', () => {
  it('sends $exception event with message and stack', async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 200 }));
    await capturePosthogException(
      { POSTHOG_API_KEY: 'k' },
      new Error('boom'),
      { distinctId: 'job-1', stage: 'grading', extra: { jobId: 'job-1' } }
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.event).toBe('$exception');
    expect(body.properties.$exception_message).toBe('boom');
    expect(body.properties.stage).toBe('grading');
    expect(body.properties.jobId).toBe('job-1');
    expect(typeof body.properties.$exception_stack_trace_raw).toBe('string');
  });

  it('accepts non-Error values', async () => {
    const fetchMock = mockFetch(() => new Response(null, { status: 200 }));
    await capturePosthogException(
      { POSTHOG_API_KEY: 'k' },
      'string error',
      { distinctId: 'job-1' }
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body.properties.$exception_message).toBe('string error');
    expect(body.properties.$exception_stack_trace_raw).toBeUndefined();
  });
});
