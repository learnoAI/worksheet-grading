import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  computeDispatchBackoffMs,
  shouldRetryDispatch,
  dispatchPendingJobs,
} from './dispatch';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('computeDispatchBackoffMs', () => {
  it('doubles per attempt starting at 2s', () => {
    expect(computeDispatchBackoffMs(0)).toBe(2000);
    expect(computeDispatchBackoffMs(1)).toBe(4000);
    expect(computeDispatchBackoffMs(2)).toBe(8000);
    expect(computeDispatchBackoffMs(3)).toBe(16000);
  });

  it('caps at attempt=6 (128s)', () => {
    expect(computeDispatchBackoffMs(6)).toBe(128000);
    expect(computeDispatchBackoffMs(100)).toBe(128000);
  });

  it('clamps negative attempts to 0', () => {
    expect(computeDispatchBackoffMs(-5)).toBe(2000);
  });
});

describe('shouldRetryDispatch', () => {
  it('always retries when lastErrorAt is null', () => {
    expect(shouldRetryDispatch(null, 5)).toBe(true);
  });

  it('retries when enough time has passed since last error', () => {
    const lastError = new Date(Date.now() - 10_000); // 10s ago
    expect(shouldRetryDispatch(lastError, 0)).toBe(true); // need 2s
    expect(shouldRetryDispatch(lastError, 1)).toBe(true); // need 4s
    expect(shouldRetryDispatch(lastError, 2)).toBe(true); // need 8s
  });

  it('skips when within the backoff window', () => {
    const lastError = new Date(Date.now() - 1_000); // 1s ago
    expect(shouldRetryDispatch(lastError, 0)).toBe(false); // need 2s
    expect(shouldRetryDispatch(lastError, 3)).toBe(false); // need 16s
  });
});

const ENV = {
  CF_ACCOUNT_ID: 'acct',
  CF_API_TOKEN: 'tok',
  CF_API_BASE_URL: 'https://api.cloudflare.com/client/v4',
  CF_QUEUE_ID: 'queue-1',
};

function mockSuccessfulPublish() {
  const fn = vi.fn(async () =>
    new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFailedPublish(status = 500, body = 'nope') {
  const fn = vi.fn(async () => new Response(body, { status }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('dispatchPendingJobs — stale requeue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('requeues stale PROCESSING jobs and fires telemetry', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      gradingJob: { updateMany, findMany, update: vi.fn() },
    } as unknown as PrismaClient;
    mockSuccessfulPublish();

    const result = await dispatchPendingJobs(prisma, ENV);
    expect(result.staleRequeued).toBe(3);
    expect(result.attempted).toBe(0);
    const call = updateMany.mock.calls[0][0];
    expect(call.where.status).toBe('PROCESSING');
    expect(call.data.status).toBe('QUEUED');
    expect(call.data.leaseId).toBeNull();
  });

  it('uses GRADING_STALE_PROCESSING_MS override when set', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      gradingJob: { updateMany, findMany, update: vi.fn() },
    } as unknown as PrismaClient;
    mockSuccessfulPublish();

    const before = Date.now();
    await dispatchPendingJobs(prisma, {
      ...ENV,
      GRADING_STALE_PROCESSING_MS: '60000', // 60s
    });
    const staleCutoff = updateMany.mock.calls[0][0].where.OR[0].lastHeartbeatAt.lt;
    expect(staleCutoff).toBeInstanceOf(Date);
    const cutoffMs = staleCutoff.getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 60_000 - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(before - 60_000 + 1000);
  });
});

describe('dispatchPendingJobs — publish loop', () => {
  beforeEach(() => vi.clearAllMocks());

  it('publishes a pending job to CF Queues and stamps enqueuedAt', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([
      { id: 'j1', attemptCount: 0, lastErrorAt: null },
    ]);
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      gradingJob: { updateMany, findMany, update },
    } as unknown as PrismaClient;

    const fetchMock = mockSuccessfulPublish();

    const result = await dispatchPendingJobs(prisma, ENV);
    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/queues/queue-1/messages');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.body.jobId).toBe('j1');

    // enqueuedAt stamped on the DB row
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'j1' },
        data: expect.objectContaining({
          enqueuedAt: expect.any(Date),
          dispatchError: null,
        }),
      })
    );
  });

  it('skips jobs within their backoff window', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([
      // last error 500ms ago, attempt 2 → needs 8s backoff → skip
      {
        id: 'j1',
        attemptCount: 2,
        lastErrorAt: new Date(Date.now() - 500),
      },
    ]);
    const update = vi.fn();
    const prisma = {
      gradingJob: { updateMany, findMany, update },
    } as unknown as PrismaClient;
    const fetchMock = mockSuccessfulPublish();

    const result = await dispatchPendingJobs(prisma, ENV);
    expect(result.skippedByBackoff).toBe(1);
    expect(result.attempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('records failures with dispatchError + increments attemptCount', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([
      { id: 'j1', attemptCount: 0, lastErrorAt: null },
    ]);
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      gradingJob: { updateMany, findMany, update },
    } as unknown as PrismaClient;
    mockFailedPublish(500, 'api exploded');

    const result = await dispatchPendingJobs(prisma, ENV);
    expect(result.failed).toBe(1);
    expect(result.dispatched).toBe(0);

    const call = update.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'j1' });
    expect(call.data.dispatchError).toContain('API_REQUEST_FAILED');
    expect(call.data.attemptCount).toEqual({ increment: 1 });
    expect(call.data.lastErrorAt).toBeInstanceOf(Date);
  });

  it('respects GRADING_QUEUE_POLL_BATCH_SIZE override', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      gradingJob: { updateMany, findMany, update: vi.fn() },
    } as unknown as PrismaClient;
    mockSuccessfulPublish();

    await dispatchPendingJobs(prisma, { ...ENV, GRADING_QUEUE_POLL_BATCH_SIZE: '5' });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ take: 5 })
    );
  });

  it('processes multiple jobs in one tick', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([
      { id: 'j1', attemptCount: 0, lastErrorAt: null },
      { id: 'j2', attemptCount: 0, lastErrorAt: null },
      { id: 'j3', attemptCount: 0, lastErrorAt: null },
    ]);
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      gradingJob: { updateMany, findMany, update },
    } as unknown as PrismaClient;
    const fetchMock = mockSuccessfulPublish();

    const result = await dispatchPendingJobs(prisma, ENV);
    expect(result.dispatched).toBe(3);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('surfaces mixed outcomes (one success, one backoff-skip, one fail)', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([
      { id: 'j1', attemptCount: 0, lastErrorAt: null },
      {
        id: 'j2',
        attemptCount: 2,
        lastErrorAt: new Date(Date.now() - 500), // within 8s backoff
      },
      { id: 'j3', attemptCount: 0, lastErrorAt: null },
    ]);
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      gradingJob: { updateMany, findMany, update },
    } as unknown as PrismaClient;

    // First publish succeeds, second fails
    let call = 0;
    globalThis.fetch = vi.fn(async () => {
      call++;
      if (call === 1) {
        return new Response(JSON.stringify({ success: true, result: {} }), {
          status: 200,
        });
      }
      return new Response('boom', { status: 500 });
    }) as unknown as typeof fetch;

    const result = await dispatchPendingJobs(prisma, ENV);
    expect(result.dispatched).toBe(1);
    expect(result.failed).toBe(1);
    expect(result.skippedByBackoff).toBe(1);
    expect(result.attempted).toBe(2); // j1 + j3, not j2
  });
});
