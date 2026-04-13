import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const loggerMocks = vi.hoisted(() => ({
  apiLogger: {
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

const posthogMocks = vi.hoisted(() => ({
  capturePosthogEvent: vi.fn(),
}));

vi.mock('../config/env', () => ({
  default: {
    diagnostics: {
      enabled: true,
      slowRequestMs: 1500,
    },
  },
}));

vi.mock('../services/logger', () => loggerMocks);

vi.mock('../services/posthogService', () => posthogMocks);

import { requestDiagnostics } from './requestDiagnostics';

class MockResponse extends EventEmitter {
  statusCode = 200;
  writableEnded = false;
  private readonly headers = new Map<string, string>();

  setHeader(name: string, value: string): void {
    this.headers.set(name.toLowerCase(), value);
  }

  getHeader(name: string): string | undefined {
    return this.headers.get(name.toLowerCase());
  }
}

describe('requestDiagnostics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('logs failing grading requests with a summarized request body', () => {
    const req: any = {
      method: 'POST',
      originalUrl: '/internal/grading-worker/jobs/job-1/complete',
      url: '/internal/grading-worker/jobs/job-1/complete',
      path: '/internal/grading-worker/jobs/job-1/complete',
      params: { jobId: 'job-1' },
      body: {
        leaseId: 'lease-1',
        gradingResponse: {
          success: true,
          worksheetId: 42,
        },
      },
      get: vi.fn(),
    };
    const res: any = new MockResponse();
    const next = vi.fn();

    requestDiagnostics(req, res, next);
    res.statusCode = 503;
    res.writableEnded = true;
    res.emit('finish');

    expect(next).toHaveBeenCalledOnce();
    expect(res.getHeader('x-request-id')).toBeTruthy();
    expect(loggerMocks.apiLogger.error).toHaveBeenCalledWith(
      'Request failed with server error',
      expect.objectContaining({
        jobId: 'job-1',
        statusCode: 503,
        requestBodySummary: expect.objectContaining({
          gradingResponseWorksheetIdType: 'number',
        }),
      })
    );
    expect(posthogMocks.capturePosthogEvent).toHaveBeenCalledWith(
      'backend_request_diagnostic',
      expect.any(String),
      expect.objectContaining({
        diagnosticType: 'server_error',
        jobId: 'job-1',
      })
    );
  });
});
