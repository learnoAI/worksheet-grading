import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GradingJobStatus } from '@prisma/client';

const mockPrisma = vi.hoisted(() => ({
  gradingJob: {
    updateMany: vi.fn(),
  },
}));

vi.mock('../utils/prisma', () => ({
  default: mockPrisma,
}));

import { acquireGradingJobLease, requeueGradingJobForRetry, resetQueuedJobDispatch } from './gradingJobLifecycleService';

describe('gradingJobLifecycleService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('acquireGradingJobLease transitions QUEUED -> PROCESSING and increments attemptCount', async () => {
    mockPrisma.gradingJob.updateMany.mockResolvedValue({ count: 1 });

    const acquired = await acquireGradingJobLease('job-1');

    expect(acquired).toEqual(expect.any(String));
    expect(mockPrisma.gradingJob.updateMany).toHaveBeenCalledTimes(1);

    const call = mockPrisma.gradingJob.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'job-1', status: GradingJobStatus.QUEUED });
    expect(call.data.status).toBe(GradingJobStatus.PROCESSING);
    expect(call.data.attemptCount).toEqual({ increment: 1 });
    expect(call.data.leaseId).toBe(acquired);
    expect(call.data.startedAt).toBeInstanceOf(Date);
    expect(call.data.lastHeartbeatAt).toBeInstanceOf(Date);
  });

  it('acquireGradingJobLease returns null when job is not QUEUED', async () => {
    mockPrisma.gradingJob.updateMany.mockResolvedValue({ count: 0 });
    const acquired = await acquireGradingJobLease('job-2');
    expect(acquired).toBeNull();
  });

  it('requeueGradingJobForRetry releases lease without clearing enqueuedAt', async () => {
    mockPrisma.gradingJob.updateMany.mockResolvedValue({ count: 1 });

    await requeueGradingJobForRetry('job-3', 'lease-3', 'transient error');

    expect(mockPrisma.gradingJob.updateMany).toHaveBeenCalledTimes(1);
    const call = mockPrisma.gradingJob.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({ id: 'job-3', status: GradingJobStatus.PROCESSING, leaseId: 'lease-3' });
    expect(call.data.status).toBe(GradingJobStatus.QUEUED);
    expect(call.data.dispatchError).toBe('transient error');
    expect(call.data.lastErrorAt).toBeInstanceOf(Date);
    expect(call.data.leaseId).toBeNull();
    expect(call.data.startedAt).toBeNull();
    expect(call.data.lastHeartbeatAt).toBeNull();
    expect(call.data.completedAt).toBeNull();

    // Critical: we must NOT clear enqueuedAt here or the dispatch loop might publish duplicates.
    expect(call.data).not.toHaveProperty('enqueuedAt');
  });

  it('resetQueuedJobDispatch clears enqueuedAt for stuck queued jobs', async () => {
    mockPrisma.gradingJob.updateMany.mockResolvedValue({ count: 1 });

    const updated = await resetQueuedJobDispatch('job-4', 'queue delivery exhausted');

    expect(updated).toBe(true);
    expect(mockPrisma.gradingJob.updateMany).toHaveBeenCalledTimes(1);

    const call = mockPrisma.gradingJob.updateMany.mock.calls[0][0];
    expect(call.where).toEqual({
      id: 'job-4',
      status: GradingJobStatus.QUEUED,
      leaseId: null,
    });
    expect(call.data.enqueuedAt).toBeNull();
    expect(call.data.dispatchError).toBe('queue delivery exhausted');
    expect(call.data.lastErrorAt).toBeInstanceOf(Date);
    expect(call.data.startedAt).toBeNull();
    expect(call.data.lastHeartbeatAt).toBeNull();
    expect(call.data.completedAt).toBeNull();
    expect(call.data.errorMessage).toBeNull();
  });
});
