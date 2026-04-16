import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  requeueGradingJobForRetry,
  acquireGradingJobLease,
  touchGradingJobHeartbeat,
  markGradingJobCompleted,
  markGradingJobFailed,
} from './gradingLifecycle';

function mockPrisma(updateManyResult: { count: number }) {
  const updateMany = vi.fn().mockResolvedValue(updateManyResult);
  const prisma = { gradingJob: { updateMany } } as unknown as PrismaClient;
  return { prisma, updateMany };
}

describe('acquireGradingJobLease', () => {
  it('returns a leaseId when the row transitions QUEUED → PROCESSING', async () => {
    const { prisma, updateMany } = mockPrisma({ count: 1 });
    const leaseId = await acquireGradingJobLease(prisma, 'job-1');
    expect(leaseId).toMatch(/^[0-9a-f-]{36}$/);
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'job-1', status: 'QUEUED' });
    expect(call.data.status).toBe('PROCESSING');
    expect(call.data.leaseId).toBe(leaseId);
    expect(call.data.attemptCount).toEqual({ increment: 1 });
  });

  it('returns null when no row was transitioned', async () => {
    const { prisma } = mockPrisma({ count: 0 });
    expect(await acquireGradingJobLease(prisma, 'job-1')).toBeNull();
  });
});

describe('touchGradingJobHeartbeat', () => {
  it('updates only when lease matches', async () => {
    const { prisma, updateMany } = mockPrisma({ count: 1 });
    const ok = await touchGradingJobHeartbeat(prisma, 'job-1', 'lease-xyz');
    expect(ok).toBe(true);
    const call = updateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: 'job-1',
      status: 'PROCESSING',
      leaseId: 'lease-xyz',
    });
    expect(call.data.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it('returns false when lease does not match', async () => {
    const { prisma } = mockPrisma({ count: 0 });
    expect(await touchGradingJobHeartbeat(prisma, 'job-1', 'stale')).toBe(false);
  });
});

describe('markGradingJobCompleted', () => {
  it('transitions PROCESSING → COMPLETED with worksheetId', async () => {
    const { prisma, updateMany } = mockPrisma({ count: 1 });
    const ok = await markGradingJobCompleted(prisma, 'job-1', 'lease', 'ws-1');
    expect(ok).toBe(true);
    const call = updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({
      status: 'COMPLETED',
      worksheetId: 'ws-1',
      leaseId: null,
    });
  });

  it('returns false when lease mismatches', async () => {
    const { prisma } = mockPrisma({ count: 0 });
    expect(await markGradingJobCompleted(prisma, 'j', 'l', 'w')).toBe(false);
  });
});

describe('markGradingJobFailed', () => {
  it('transitions PROCESSING → FAILED with error message', async () => {
    const { prisma, updateMany } = mockPrisma({ count: 1 });
    const ok = await markGradingJobFailed(prisma, 'job-1', 'lease', 'python down');
    expect(ok).toBe(true);
    const call = updateMany.mock.calls[0][0];
    expect(call.data).toMatchObject({
      status: 'FAILED',
      errorMessage: 'python down',
      leaseId: null,
    });
  });
});

describe('requeueGradingJobForRetry', () => {
  it('moves PROCESSING → QUEUED without clearing enqueuedAt', async () => {
    const { prisma, updateMany } = mockPrisma({ count: 1 });
    const ok = await requeueGradingJobForRetry(
      prisma,
      'job-1',
      'lease',
      'lease_lost'
    );
    expect(ok).toBe(true);
    const call = updateMany.mock.calls[0][0];
    expect(call.data.status).toBe('QUEUED');
    expect(call.data.dispatchError).toBe('lease_lost');
    expect(call.data.leaseId).toBeNull();
    // Critical invariant: we do NOT touch enqueuedAt — the CF Queues
    // message is still live and will be retried from there.
    expect(call.data).not.toHaveProperty('enqueuedAt');
  });

  it('treats missing reason as null dispatchError', async () => {
    const { prisma, updateMany } = mockPrisma({ count: 1 });
    await requeueGradingJobForRetry(prisma, 'job-1', 'lease');
    expect(updateMany.mock.calls[0][0].data.dispatchError).toBeNull();
  });

  it('returns false on lease mismatch', async () => {
    const { prisma } = mockPrisma({ count: 0 });
    expect(
      await requeueGradingJobForRetry(prisma, 'job-1', 'stale', 'x')
    ).toBe(false);
  });
});
