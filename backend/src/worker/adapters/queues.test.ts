import { describe, expect, it, afterEach, vi } from 'vitest';
import { publishToQueue, publishBatch, QueueError } from './queues';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

const ENV = {
  CF_ACCOUNT_ID: 'acct-1',
  CF_API_TOKEN: 'token-xyz',
  CF_API_BASE_URL: 'https://api.cloudflare.com/client/v4',
  CF_QUEUE_ID: 'queue-123',
};

function mockOkResponse(result: unknown = {}): () => Promise<Response> {
  return () =>
    Promise.resolve(
      new Response(JSON.stringify({ success: true, result }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
}

describe('publishToQueue', () => {
  it('throws CONFIG_MISSING when any of account/token/queueId is missing', async () => {
    await expect(
      publishToQueue({ ...ENV, CF_ACCOUNT_ID: undefined }, 'CF_QUEUE_ID', { jobId: 'j1' })
    ).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    await expect(
      publishToQueue({ ...ENV, CF_API_TOKEN: undefined }, 'CF_QUEUE_ID', { jobId: 'j1' })
    ).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
    await expect(
      publishToQueue({ ...ENV, CF_QUEUE_ID: undefined }, 'CF_QUEUE_ID', { jobId: 'j1' })
    ).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
  });

  it('POSTs to the queue URL with { body: message }', async () => {
    const fetchMock = vi.fn(mockOkResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await publishToQueue(ENV, 'CF_QUEUE_ID', { jobId: 'j1', enqueuedAt: '2026-01-01' });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.cloudflare.com/client/v4/accounts/acct-1/queues/queue-123/messages'
    );
    const i = init as RequestInit;
    expect(i.method).toBe('POST');
    expect((i.headers as Record<string, string>).Authorization).toBe('Bearer token-xyz');
    expect(JSON.parse(i.body as string)).toEqual({
      body: { jobId: 'j1', enqueuedAt: '2026-01-01' },
    });
  });

  it('supports arbitrary queue-id env keys for multiple queues', async () => {
    const fetchMock = vi.fn(mockOkResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await publishToQueue(
      { ...ENV, QUESTION_GENERATION_QUEUE_ID: 'qg-9' },
      'QUESTION_GENERATION_QUEUE_ID',
      { skillId: 's1' }
    );

    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain('/queues/qg-9/messages');
  });

  it('throws API_REQUEST_FAILED on non-2xx', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('bad', { status: 502 })
    ) as unknown as typeof fetch;
    await expect(
      publishToQueue(ENV, 'CF_QUEUE_ID', { x: 1 })
    ).rejects.toMatchObject({ code: 'API_REQUEST_FAILED', status: 502 });
  });

  it('throws API_REJECTED when CF returns success=false', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({ success: false, errors: [{ code: 10006, message: 'no such queue' }] }),
        { status: 200 }
      )
    ) as unknown as typeof fetch;
    await expect(
      publishToQueue(ENV, 'CF_QUEUE_ID', { x: 1 })
    ).rejects.toMatchObject({ code: 'API_REJECTED', message: expect.stringContaining('no such queue') });
  });

  it('throws INVALID_RESPONSE when body is not JSON', async () => {
    globalThis.fetch = vi.fn(async () =>
      new Response('<html>bad gateway</html>', { status: 200 })
    ) as unknown as typeof fetch;
    await expect(
      publishToQueue(ENV, 'CF_QUEUE_ID', { x: 1 })
    ).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });

  it('wraps a network error as API_REQUEST_FAILED', async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('network down');
    }) as unknown as typeof fetch;
    await expect(
      publishToQueue(ENV, 'CF_QUEUE_ID', { x: 1 })
    ).rejects.toMatchObject({ code: 'API_REQUEST_FAILED', message: 'network down' });
  });
});

describe('publishBatch', () => {
  it('short-circuits on empty input', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await publishBatch(ENV, 'CF_QUEUE_ID', []);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects batches larger than 100', async () => {
    const messages = new Array(101).fill({ x: 1 });
    await expect(publishBatch(ENV, 'CF_QUEUE_ID', messages)).rejects.toBeInstanceOf(QueueError);
  });

  it('POSTs to the /batch endpoint wrapping each message in { body }', async () => {
    const fetchMock = vi.fn(mockOkResponse());
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await publishBatch(ENV, 'CF_QUEUE_ID', [{ jobId: 'a' }, { jobId: 'b' }]);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/queues/queue-123/messages/batch');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({ messages: [{ body: { jobId: 'a' } }, { body: { jobId: 'b' } }] });
  });
});
