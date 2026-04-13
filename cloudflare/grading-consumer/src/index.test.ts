import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Gemini calls so tests focus on queue + backend reliability semantics.
vi.mock('./gemini', () => {
  class GeminiHttpError extends Error {
    readonly status: number;
    readonly responseText: string;

    constructor(status: number, responseText: string) {
      super(`Gemini request failed (${status}): ${responseText}`);
      this.name = 'GeminiHttpError';
      this.status = status;
      this.responseText = responseText;
    }
  }

  return {
    GeminiHttpError,
    geminiGenerateJson: vi.fn(),
  };
});

import worker from './index';
import { GeminiHttpError, geminiGenerateJson } from './gemini';

type FetchCall = { url: string; init?: RequestInit };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function makeR2Bucket(objects: Record<string, { text?: string; bytes?: Uint8Array }>): R2Bucket {
  return {
    async get(key: string) {
      const obj = objects[key];
      if (!obj) return null;
      return {
        async text() {
          return obj.text ?? '';
        },
        async arrayBuffer() {
          const bytes = obj.bytes ?? new Uint8Array();
          return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
        },
      } as any;
    },
  } as any;
}

describe('cloudflare grading consumer queue semantics', () => {
  let fetchCalls: FetchCall[] = [];

  beforeEach(() => {
    fetchCalls = [];
    vi.resetAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    // Default fetch stub; individual tests can override by changing handlers below.
    vi.stubGlobal('fetch', vi.fn(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });
      return jsonResponse({ success: true });
    }) as any);
  });

  it('acks duplicate delivery when backend acquire returns acquired=false', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });
      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-1/acquire`)) {
        return jsonResponse({ success: true, acquired: false });
      }
      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      IMAGES_BUCKET: makeR2Bucket({}),
      ASSETS_BUCKET: makeR2Bucket({}),
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm1',
            attempts: 1,
            body: { v: 1, jobId: 'job-1', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(fetchCalls.map((c) => c.url)).toEqual([
      `${backendBase}/internal/grading-worker/jobs/job-1/acquire`,
    ]);
  });

  it('fails + acks on non-retryable errors after acquiring the lease', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-2/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-2',
          job: {
            id: 'job-2',
            status: 'QUEUED',
            tokenNo: '123',
            worksheetName: '15',
            worksheetNumber: 15,
            submittedOn: new Date().toISOString(),
            isRepeated: false,
            studentId: 's',
            classId: 'c',
            teacherId: 't',
            images: [{ s3Key: 'k1', storageProvider: 'S3', pageNumber: 1, mimeType: 'image/jpeg' }],
          },
        });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-2/fail`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      IMAGES_BUCKET: makeR2Bucket({}),
      ASSETS_BUCKET: makeR2Bucket({}),
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm2',
            attempts: 1,
            body: { v: 1, jobId: 'job-2', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(retry).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(fetchCalls.some((c) => c.url.endsWith('/fail'))).toBe(true);
  });

  it('acks and drops invalid queue messages without calling backend', async () => {
    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: 'https://backend.example',
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      IMAGES_BUCKET: makeR2Bucket({}),
      ASSETS_BUCKET: makeR2Bucket({}),
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm-invalid',
            attempts: 1,
            body: { v: 1, enqueuedAt: new Date().toISOString() }, // missing jobId
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(ack).toHaveBeenCalledTimes(1);
    expect(retry).not.toHaveBeenCalled();
    expect(fetchCalls).toEqual([]);
  });

  it('requeues + retries on retryable Gemini errors (no ack)', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-3/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-3',
          job: {
            id: 'job-3',
            status: 'QUEUED',
            tokenNo: '123',
            worksheetName: '15',
            worksheetNumber: 15,
            submittedOn: new Date().toISOString(),
            isRepeated: false,
            studentId: 's',
            classId: 'c',
            teacherId: 't',
            images: [{ s3Key: 'img-1', storageProvider: 'R2', pageNumber: 1, mimeType: 'image/jpeg' }],
          },
        });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-3/heartbeat`)) {
        return jsonResponse({ success: true });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-3/requeue`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    (geminiGenerateJson as any).mockImplementation(async () => {
      throw new GeminiHttpError(503, 'unavailable');
    });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      IMAGES_BUCKET: makeR2Bucket({
        'img-1': { bytes: new Uint8Array([1, 2, 3]) },
      }),
      ASSETS_BUCKET: makeR2Bucket({
        'answers_by_worksheet.json': { text: JSON.stringify({ '15': [] }) },
      }),
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm3',
            attempts: 1,
            body: { v: 1, jobId: 'job-3', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
    expect(fetchCalls.some((c) => c.url.endsWith('/requeue'))).toBe(true);
    expect(fetchCalls.some((c) => c.url.endsWith('/fail'))).toBe(false);
  });

  it('acks on success after persisting grading result', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-5/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-5',
          job: {
            id: 'job-5',
            status: 'QUEUED',
            tokenNo: '123',
            worksheetName: '15',
            worksheetNumber: 15,
            submittedOn: new Date().toISOString(),
            isRepeated: false,
            studentId: 's',
            classId: 'c',
            teacherId: 't',
            images: [{ s3Key: 'img-1', storageProvider: 'R2', pageNumber: 1, mimeType: 'image/jpeg' }],
          },
        });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-5/heartbeat`)) {
        return jsonResponse({ success: true });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-5/complete`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    (geminiGenerateJson as any)
      .mockResolvedValueOnce({
        parsed: { questions: [{ question_number: 1, question: '1+1', student_answer: '2' }] },
        rawText: '{"questions":[{"question_number":1,"question":"1+1","student_answer":"2"}]}',
      })
      .mockResolvedValueOnce({
        parsed: {
          total_questions: 1,
          overall_score: 40,
          grade_percentage: 100,
          question_scores: [
            {
              question_number: 1,
              question: '1+1',
              student_answer: '2',
              correct_answer: '2',
              points_earned: 40,
              max_points: 40,
              is_correct: true,
              feedback: 'good',
            },
          ],
          correct_answers: 1,
          wrong_answers: 0,
          unanswered: 0,
          overall_feedback: 'great',
        },
        rawText: '{}',
      });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      IMAGES_BUCKET: makeR2Bucket({
        'img-1': { bytes: new Uint8Array([1, 2, 3]) },
      }),
      ASSETS_BUCKET: makeR2Bucket({
        'answers_by_worksheet.json': { text: JSON.stringify({ '15': [] }) },
      }),
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm5',
            attempts: 1,
            body: { v: 1, jobId: 'job-5', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(retry).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(fetchCalls.some((c) => c.url.endsWith('/complete'))).toBe(true);
    expect(fetchCalls.some((c) => c.url.endsWith('/fail'))).toBe(false);
  });

  it('requeues + retries when backend /complete returns 5xx', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-6/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-6',
          job: {
            id: 'job-6',
            status: 'QUEUED',
            tokenNo: '123',
            worksheetName: '15',
            worksheetNumber: 15,
            submittedOn: new Date().toISOString(),
            isRepeated: false,
            studentId: 's',
            classId: 'c',
            teacherId: 't',
            images: [{ s3Key: 'img-1', storageProvider: 'R2', pageNumber: 1, mimeType: 'image/jpeg' }],
          },
        });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-6/heartbeat`)) {
        return jsonResponse({ success: true });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-6/complete`)) {
        return jsonResponse({ success: false, error: 'db down' }, 500);
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-6/requeue`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    (geminiGenerateJson as any)
      .mockResolvedValueOnce({
        parsed: { questions: [{ question_number: 1, question: '1+1', student_answer: '2' }] },
        rawText: '{}',
      })
      .mockResolvedValueOnce({
        parsed: {
          total_questions: 1,
          overall_score: 40,
          grade_percentage: 100,
          question_scores: [
            {
              question_number: 1,
              question: '1+1',
              student_answer: '2',
              correct_answer: '2',
              points_earned: 40,
              max_points: 40,
              is_correct: true,
              feedback: 'good',
            },
          ],
          correct_answers: 1,
          wrong_answers: 0,
          unanswered: 0,
          overall_feedback: 'great',
        },
        rawText: '{}',
      });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      IMAGES_BUCKET: makeR2Bucket({
        'img-1': { bytes: new Uint8Array([1, 2, 3]) },
      }),
      ASSETS_BUCKET: makeR2Bucket({
        'answers_by_worksheet.json': { text: JSON.stringify({ '15': [] }) },
      }),
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm6',
            attempts: 1,
            body: { v: 1, jobId: 'job-6', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(retry).toHaveBeenCalledTimes(1);
    expect(ack).not.toHaveBeenCalled();
    expect(fetchCalls.some((c) => c.url.endsWith('/requeue'))).toBe(true);
  });

  it('marks FAILED + acks once max attempts are reached (no retry)', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-4/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-4',
          job: {
            id: 'job-4',
            status: 'QUEUED',
            tokenNo: '123',
            worksheetName: '15',
            worksheetNumber: 15,
            submittedOn: new Date().toISOString(),
            isRepeated: false,
            studentId: 's',
            classId: 'c',
            teacherId: 't',
            images: [{ s3Key: 'img-1', storageProvider: 'R2', pageNumber: 1, mimeType: 'image/jpeg' }],
          },
        });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-4/heartbeat`)) {
        return jsonResponse({ success: true });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-4/fail`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    (geminiGenerateJson as any).mockImplementation(async () => {
      throw new GeminiHttpError(503, 'unavailable');
    });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      MAX_QUEUE_ATTEMPTS: '5',
      IMAGES_BUCKET: makeR2Bucket({
        'img-1': { bytes: new Uint8Array([1, 2, 3]) },
      }),
      ASSETS_BUCKET: makeR2Bucket({
        'answers_by_worksheet.json': { text: JSON.stringify({ '15': [] }) },
      }),
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm4',
            attempts: 5,
            body: { v: 1, jobId: 'job-4', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(retry).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(fetchCalls.some((c) => c.url.endsWith('/fail'))).toBe(true);
  });

  it('acks (no retry, no fail) when backend rejects completion with 409 lease mismatch', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-7/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-7',
          job: {
            id: 'job-7',
            status: 'QUEUED',
            tokenNo: '123',
            worksheetName: '15',
            worksheetNumber: 15,
            submittedOn: new Date().toISOString(),
            isRepeated: false,
            studentId: 's',
            classId: 'c',
            teacherId: 't',
            images: [{ s3Key: 'img-1', storageProvider: 'R2', pageNumber: 1, mimeType: 'image/jpeg' }],
          },
        });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-7/heartbeat`)) {
        return jsonResponse({ success: true });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-7/complete`)) {
        return jsonResponse({ success: false, error: 'Lease mismatch' }, 409);
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-7/fail`)) {
        throw new Error('Worker should not mark FAILED on lease mismatch');
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    (geminiGenerateJson as any)
      .mockResolvedValueOnce({
        parsed: { questions: [{ question_number: 1, question: '1+1', student_answer: '2' }] },
        rawText: '{"questions":[{"question_number":1,"question":"1+1","student_answer":"2"}]}',
      })
      .mockResolvedValueOnce({
        parsed: {
          total_questions: 1,
          overall_score: 40,
          grade_percentage: 100,
          question_scores: [
            {
              question_number: 1,
              question: '1+1',
              student_answer: '2',
              correct_answer: '2',
              points_earned: 40,
              max_points: 40,
              is_correct: true,
              feedback: 'good',
            },
          ],
          correct_answers: 1,
          wrong_answers: 0,
          unanswered: 0,
          overall_feedback: 'great',
        },
        rawText: '{}',
      });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      IMAGES_BUCKET: makeR2Bucket({
        'img-1': { bytes: new Uint8Array([1, 2, 3]) },
      }),
      ASSETS_BUCKET: makeR2Bucket({
        'answers_by_worksheet.json': { text: JSON.stringify({ '15': [] }) },
      }),
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm7',
            attempts: 1,
            body: { v: 1, jobId: 'job-7', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(retry).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
    expect(fetchCalls.some((c) => c.url.endsWith('/complete'))).toBe(true);
    expect(fetchCalls.some((c) => c.url.endsWith('/fail'))).toBe(false);
  });
});
