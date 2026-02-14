import { describe, expect, it, vi } from 'vitest';

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

import { complete } from './internalGradingWorkerController';

describe('internalGradingWorkerController.complete', () => {
  it('returns 500 on persistence error without marking job FAILED (queue will retry)', async () => {
    persistenceMocks.persistWorksheetForGradingJobId.mockRejectedValueOnce(new Error('db temporarily unavailable'));

    const req: any = {
      params: { jobId: 'job-1' },
      body: {
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
    expect(res.body.success).toBe(false);
  });
});
