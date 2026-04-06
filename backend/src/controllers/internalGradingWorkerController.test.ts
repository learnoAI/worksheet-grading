import { beforeEach, describe, expect, it, vi } from 'vitest';

const prismaMocks = vi.hoisted(() => ({
  $transaction: vi.fn(),
}));

vi.mock('../utils/prisma', () => ({
  default: prismaMocks,
}));

const lifecycleMocks = vi.hoisted(() => ({
  markGradingJobCompleted: vi.fn(),
  markGradingJobFailed: vi.fn(),
}));

vi.mock('../services/gradingJobLifecycleService', () => ({
  acquireGradingJobLease: vi.fn(),
  touchGradingJobHeartbeat: vi.fn(),
  markGradingJobCompleted: lifecycleMocks.markGradingJobCompleted,
  markGradingJobFailed: lifecycleMocks.markGradingJobFailed,
  requeueGradingJobForRetry: vi.fn(),
}));

const persistenceMocks = vi.hoisted(() => ({
  persistWorksheetForGradingJobId: vi.fn(),
}));

vi.mock('../services/gradingWorksheetPersistenceService', () => ({
  persistWorksheetForGradingJobId: persistenceMocks.persistWorksheetForGradingJobId,
}));

vi.mock('../services/errorLogService', () => ({
  logError: vi.fn(async () => {}),
}));

vi.mock('../services/logger', () => ({
  aiGradingLogger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import { complete } from './internalGradingWorkerController';

describe('internalGradingWorkerController.complete', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns 500 on persistence error without marking job FAILED (queue will retry)', async () => {
    persistenceMocks.persistWorksheetForGradingJobId.mockRejectedValueOnce(new Error('db temporarily unavailable'));

    const tx: any = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'job-1', status: 'PROCESSING', leaseId: 'lease-1', worksheetId: null },
      ]),
      gradingJob: {
        updateMany: vi.fn(),
      },
    };

    prismaMocks.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const req: any = {
      params: { jobId: 'job-1' },
      body: {
        leaseId: 'lease-1',
        gradingResponse: {
          success: true,
          grade: 10,
          total_possible: 40,
          total_questions: 1,
          correct_answers: 1,
          wrong_answers: 0,
          unanswered: 0,
          grade_percentage: 25,
          question_scores: [],
          wrong_questions: [],
          unanswered_questions: [],
          overall_feedback: 'ok',
        },
      },
    };

    const res: any = {
      status: vi.fn(function status(this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function json(this: any, body: any) {
        this.body = body;
        return this;
      }),
    };

    await complete(req, res);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(lifecycleMocks.markGradingJobFailed).not.toHaveBeenCalled();
    expect(lifecycleMocks.markGradingJobCompleted).not.toHaveBeenCalled();
    expect(tx.gradingJob.updateMany).not.toHaveBeenCalled();
    expect(res.body.success).toBe(false);
  });

  it('returns 409 when leaseId does not match the current PROCESSING lease', async () => {
    persistenceMocks.persistWorksheetForGradingJobId.mockResolvedValueOnce({
      worksheetId: 'w1',
      action: 'CREATED',
      grade: 10,
    });

    const tx: any = {
      $queryRaw: vi.fn().mockResolvedValue([
        { id: 'job-2', status: 'PROCESSING', leaseId: 'lease-current', worksheetId: null },
      ]),
      gradingJob: {
        updateMany: vi.fn(),
      },
    };

    prismaMocks.$transaction.mockImplementation(async (cb: any) => cb(tx));

    const req: any = {
      params: { jobId: 'job-2' },
      body: {
        leaseId: 'lease-stale',
        gradingResponse: {
          success: true,
          grade: 10,
          total_possible: 40,
          total_questions: 1,
          correct_answers: 1,
          wrong_answers: 0,
          unanswered: 0,
          grade_percentage: 25,
          question_scores: [],
          wrong_questions: [],
          unanswered_questions: [],
          overall_feedback: 'ok',
        },
      },
    };

    const res: any = {
      status: vi.fn(function status(this: any, code: number) {
        this.statusCode = code;
        return this;
      }),
      json: vi.fn(function json(this: any, body: any) {
        this.body = body;
        return this;
      }),
    };

    await complete(req, res);

    expect(res.status).toHaveBeenCalledWith(409);
    expect(persistenceMocks.persistWorksheetForGradingJobId).not.toHaveBeenCalled();
    expect(tx.gradingJob.updateMany).not.toHaveBeenCalled();
  });
});
