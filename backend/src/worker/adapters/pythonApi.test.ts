import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { callPython, PythonApiError } from './pythonApi';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
});

function mockFetchSequence(responses: Array<() => Promise<Response>>): ReturnType<typeof vi.fn> {
  let i = 0;
  const fn = vi.fn(async () => {
    const maker = responses[Math.min(i, responses.length - 1)];
    i++;
    return maker();
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('callPython — JSON body', () => {
  it('POSTs JSON and parses the JSON response', async () => {
    const fetchMock = mockFetchSequence([
      () => Promise.resolve(new Response('{"ok":true,"n":3}', { status: 200 })),
    ]);
    const out = await callPython<{ ok: boolean; n: number }>('https://py/api', {
      method: 'POST',
      json: { hello: 'world' },
    });
    expect(out).toEqual({ ok: true, n: 3 });
    const call = fetchMock.mock.calls[0];
    const init = call[1] as RequestInit;
    expect(init.method).toBe('POST');
    expect(init.body).toBe('{"hello":"world"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
  });
});

describe('callPython — multipart files', () => {
  it('sends files under the `files` field without setting Content-Type manually', async () => {
    let receivedForm: FormData | undefined;
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      receivedForm = init.body as FormData;
      return new Response('{"success":true}', { status: 200 });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await callPython('https://py/process', {
      files: [
        {
          filename: 'page-1.png',
          contentType: 'image/png',
          buffer: new Uint8Array([1, 2, 3]),
        },
        {
          filename: 'page-2.jpg',
          contentType: 'image/jpeg',
          buffer: new Blob([new Uint8Array([4, 5])], { type: 'image/jpeg' }),
        },
      ],
      fields: { token_no: 'T1', worksheet_name: 'WS-1' },
    });

    expect(receivedForm).toBeInstanceOf(FormData);
    const fileList = receivedForm!.getAll('files');
    expect(fileList.length).toBe(2);
    expect((fileList[0] as File).name).toBe('page-1.png');
    expect((fileList[0] as File).type).toBe('image/png');
    expect((fileList[1] as File).name).toBe('page-2.jpg');
    expect(receivedForm!.get('token_no')).toBe('T1');
    expect(receivedForm!.get('worksheet_name')).toBe('WS-1');

    // Make sure we did not set a manual Content-Type (the runtime adds the
    // multipart boundary header for us).
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const headers = init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBeUndefined();
  });
});

describe('callPython — query parameters', () => {
  it('appends query params without duplicating existing ones', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response('{}', { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await callPython('https://py/lookup?existing=1', {
      method: 'GET',
      query: { token_no: 'T1', worksheet_name: 'WS-1', skip: undefined },
    });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('existing=1');
    expect(url).toContain('token_no=T1');
    expect(url).toContain('worksheet_name=WS-1');
    expect(url).not.toContain('skip=');
  });
});

describe('callPython — retries', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('retries on 5xx with exponential backoff and eventually succeeds', async () => {
    const fetchMock = mockFetchSequence([
      () => Promise.resolve(new Response('x', { status: 502 })),
      () => Promise.resolve(new Response('x', { status: 503 })),
      () => Promise.resolve(new Response('{"ok":true}', { status: 200 })),
    ]);
    const onRetry = vi.fn();

    const promise = callPython('https://py/api', {
      json: {},
      maxRetries: 3,
      baseDelayMs: 10,
      onRetry,
    });
    await vi.runAllTimersAsync();
    const out = await promise;

    expect(out).toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenCalledTimes(2);
    expect(onRetry.mock.calls[0][0]).toBe(1); // attempt counter for first retry
    expect(onRetry.mock.calls[1][0]).toBe(2);
  });

  it('does not retry on 4xx client errors (except 408/429)', async () => {
    const fetchMock = mockFetchSequence([
      () => Promise.resolve(new Response('bad', { status: 400 })),
    ]);
    await expect(
      callPython('https://py/api', { json: {}, maxRetries: 3, baseDelayMs: 10 })
    ).rejects.toMatchObject({ status: 400 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retries on 429 (rate limited)', async () => {
    const fetchMock = mockFetchSequence([
      () => Promise.resolve(new Response('slow down', { status: 429 })),
      () => Promise.resolve(new Response('{"ok":true}', { status: 200 })),
    ]);
    const promise = callPython('https://py/api', { json: {}, maxRetries: 2, baseDelayMs: 10 });
    await vi.runAllTimersAsync();
    await promise;
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws PythonApiError with status + body on terminal failure', async () => {
    mockFetchSequence([
      () => Promise.resolve(new Response('db exploded', { status: 500 })),
      () => Promise.resolve(new Response('db exploded', { status: 500 })),
    ]);
    const promise = callPython('https://py/api', {
      json: {},
      maxRetries: 2,
      baseDelayMs: 10,
    });
    await vi.runAllTimersAsync();
    await expect(promise).rejects.toMatchObject({
      name: 'PythonApiError',
      status: 500,
      responseText: 'db exploded',
    });
  });
});

describe('callPython — response parsing', () => {
  it('returns null on 204 No Content', async () => {
    mockFetchSequence([() => Promise.resolve(new Response(null, { status: 204 }))]);
    const out = await callPython('https://py/api');
    expect(out).toBeNull();
  });

  it('throws PythonApiError when body is not valid JSON', async () => {
    mockFetchSequence([() => Promise.resolve(new Response('not json', { status: 200 }))]);
    await expect(callPython('https://py/api')).rejects.toBeInstanceOf(PythonApiError);
  });
});
