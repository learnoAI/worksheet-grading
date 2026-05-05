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
  const fn = vi.fn(async (..._args: Parameters<typeof fetch>) =>
    new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
  );
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

function mockFailedPublish(status = 500, body = 'nope') {
  const fn = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(body, { status }));
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
    // Stale-requeue is a clean retry, NOT an error retry — these fields
    // must be cleared so the next tick's `shouldRetryDispatch` doesn't
    // skip the rescued job by applying backoff to a fake "error".
    expect(call.data.lastErrorAt).toBeNull();
    expect(call.data.dispatchError).toBeNull();
    expect(call.data.attemptCount).toBe(0);
  });

  it('clears lastErrorAt/attemptCount so the rescued job dispatches on the very next tick', async () => {
    // Simulates two consecutive ticks with the same in-memory prisma
    // mock. Tick 1 reclaims a stale PROCESSING job. Tick 2 reads the
    // QUEUED row and must NOT skip it via backoff.
    const dbRow: {
      id: string;
      attemptCount: number;
      lastErrorAt: Date | null;
    } = { id: 'rescued-1', attemptCount: 4, lastErrorAt: new Date(Date.now() - 1000) };
    const updateMany = vi.fn(
      async (args: {
        where: { status: string };
        data: { attemptCount?: number; lastErrorAt?: Date | null };
      }) => {
        // Two updateMany calls happen per tick: stale-PROCESSING requeue
        // and orphan-QUEUED sweep. Only the stale-requeue is what this
        // test exercises; the orphan sweep is a no-op here (its filter
        // wouldn't match in real life either, since the row's updatedAt
        // is fresh from the tick-1 stale-requeue write).
        if (args.where.status !== 'PROCESSING') return { count: 0 };
        // Tick 1's stale-requeue should null these out (the bug we're fixing).
        Object.assign(dbRow, {
          attemptCount: args.data.attemptCount,
          lastErrorAt: args.data.lastErrorAt,
        });
        return { count: 1 };
      }
    );
    // First tick: findMany returns nothing (job was just moved from PROCESSING
    // to QUEUED but we model the dispatch loop's two-step read).
    // Second tick: findMany returns the rescued row with whatever
    // updateMany wrote into it.
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockImplementation(async () => [
        {
          id: dbRow.id,
          attemptCount: dbRow.attemptCount,
          lastErrorAt: dbRow.lastErrorAt,
        },
      ]);
    const update = vi.fn().mockResolvedValue({});
    const prisma = {
      gradingJob: { updateMany, findMany, update },
    } as unknown as PrismaClient;
    const fetchMock = mockSuccessfulPublish();

    const tick1 = await dispatchPendingJobs(prisma, ENV);
    expect(tick1.staleRequeued).toBe(1);

    // Now the second tick — the rescued job MUST be dispatched, not
    // skipped by backoff.
    // Make the second updateMany a no-op (no fresh stale rows).
    updateMany.mockResolvedValueOnce({ count: 0 });
    const tick2 = await dispatchPendingJobs(prisma, ENV);
    expect(tick2.skippedByBackoff).toBe(0);
    expect(tick2.dispatched).toBe(1);
    expect(tick2.attempted).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
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

describe('dispatchPendingJobs — orphan-QUEUED sweep', () => {
  beforeEach(() => vi.clearAllMocks());

  // The orphan sweep is the SECOND updateMany call in a tick (after the
  // stale-PROCESSING requeue). Tests below pin assertions to
  // `updateMany.mock.calls[1]` rather than `[0]` to avoid coupling to
  // the stale-requeue's args.

  it('filters on status=QUEUED with leaseId/startedAt null and both timestamp gates', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      gradingJob: { updateMany, findMany, update: vi.fn() },
    } as unknown as PrismaClient;
    mockSuccessfulPublish();

    await dispatchPendingJobs(prisma, ENV);

    expect(updateMany).toHaveBeenCalledTimes(2);
    const orphanCall = updateMany.mock.calls[1][0];
    expect(orphanCall.where.status).toBe('QUEUED');
    expect(orphanCall.where.leaseId).toBeNull();
    expect(orphanCall.where.startedAt).toBeNull();
    expect(orphanCall.where.enqueuedAt.lt).toBeInstanceOf(Date);
    expect(orphanCall.where.updatedAt.lt).toBeInstanceOf(Date);
  });

  it('stamps lastErrorAt + dispatchError and clears enqueuedAt on the data payload', async () => {
    // INVERSE of the stale-PROCESSING requeue: orphan recovery is an
    // error condition (a queue message went missing), so we surface it
    // via `lastErrorAt` + `dispatchError` instead of nulling them. Do
    // NOT copy the "clean retry" assertions from the stale-requeue test.
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      gradingJob: { updateMany, findMany, update: vi.fn() },
    } as unknown as PrismaClient;
    mockSuccessfulPublish();

    await dispatchPendingJobs(prisma, ENV);

    const orphanData = updateMany.mock.calls[1][0].data;
    expect(orphanData.enqueuedAt).toBeNull();
    expect(orphanData.dispatchError).toBe(
      'Requeued by dispatch loop: queued message orphaned'
    );
    expect(orphanData.lastErrorAt).toBeInstanceOf(Date);
    // Must not piggyback the stale-requeue's clean-retry resets.
    expect(orphanData.attemptCount).toBeUndefined();
    expect(orphanData.status).toBeUndefined();
    expect(orphanData.leaseId).toBeUndefined();
  });

  it('propagates the orphan-sweep count onto result.orphanRequeued', async () => {
    // First updateMany call = stale-PROCESSING (return 0), second = orphan
    // sweep (return 7). mockResolvedValueOnce queues per-call overrides.
    const updateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 0 })
      .mockResolvedValueOnce({ count: 7 });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      gradingJob: { updateMany, findMany, update: vi.fn() },
    } as unknown as PrismaClient;
    mockSuccessfulPublish();

    const result = await dispatchPendingJobs(prisma, ENV);
    expect(result.orphanRequeued).toBe(7);
    expect(result.staleRequeued).toBe(0);
  });

  it('honours GRADING_DISPATCH_ORPHAN_MS override on both timestamp filters', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      gradingJob: { updateMany, findMany, update: vi.fn() },
    } as unknown as PrismaClient;
    mockSuccessfulPublish();

    const before = Date.now();
    await dispatchPendingJobs(prisma, {
      ...ENV,
      GRADING_DISPATCH_ORPHAN_MS: '120000', // 2 min
    });

    const orphanWhere = updateMany.mock.calls[1][0].where;
    const enqueuedCutoff = orphanWhere.enqueuedAt.lt as Date;
    const updatedCutoff = orphanWhere.updatedAt.lt as Date;
    expect(enqueuedCutoff).toBeInstanceOf(Date);
    expect(updatedCutoff).toBeInstanceOf(Date);
    // Both gates share the same cutoff so a job's CF retry cycle finishes
    // in lockstep with the silence window.
    expect(enqueuedCutoff.getTime()).toBe(updatedCutoff.getTime());
    const cutoffMs = enqueuedCutoff.getTime();
    expect(cutoffMs).toBeGreaterThanOrEqual(before - 120_000 - 1000);
    expect(cutoffMs).toBeLessThanOrEqual(before - 120_000 + 1000);
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
    globalThis.fetch = vi.fn(async (..._args: Parameters<typeof fetch>) => {
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
