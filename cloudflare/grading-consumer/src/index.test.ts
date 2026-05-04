import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock LLM calls so tests focus on queue + backend reliability semantics.
vi.mock('./llm', () => {
  class LlmHttpError extends Error {
    readonly status: number;
    readonly responseText: string;

    constructor(status: number, responseText: string) {
      super(`LLM request failed (${status}): ${responseText}`);
      this.name = 'LlmHttpError';
      this.status = status;
      this.responseText = responseText;
    }
  }

  return {
    LlmHttpError,
    llmGenerateJson: vi.fn(),
  };
});

import worker from './index';
import { LlmHttpError, llmGenerateJson } from './llm';

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

function makeRateLimiterBinding(
  handler: (url: string, init?: RequestInit) => Promise<Response>
): { binding: DurableObjectNamespace; fetch: ReturnType<typeof vi.fn> } {
  const limiterFetch = vi.fn(handler);
  const stub = { fetch: limiterFetch };
  return {
    binding: {
      idFromName: vi.fn(() => ({ toString: () => 'global-gemini-limiter' })),
      get: vi.fn(() => stub),
    } as any,
    fetch: limiterFetch,
  };
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

    (llmGenerateJson as any).mockImplementation(async () => {
      throw new LlmHttpError(503, 'unavailable', 'workers-ai', '@cf/google/gemma-4-26b-a4b-it');
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

  it('delays Cloudflare queue retry with exponential backoff on Gemini 429', async () => {
    const backendBase = 'https://backend.example';
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0.5);

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-429/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-429',
          job: {
            id: 'job-429',
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

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-429/heartbeat`)) {
        return jsonResponse({ success: true });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-429/requeue`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    (llmGenerateJson as any).mockImplementation(async () => {
      throw new LlmHttpError(429, JSON.stringify({
        error: {
          code: 429,
          message: 'Resource exhausted. Please try again later.',
          status: 'RESOURCE_EXHAUSTED',
        },
      }), 'workers-ai', '@cf/google/gemma-4-26b-a4b-it');
    });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      GEMINI_API_KEY: 'gemini',
      GEMINI_429_RETRY_BASE_DELAY_SECONDS: '10',
      GEMINI_429_RETRY_MAX_DELAY_SECONDS: '300',
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
            id: 'm429',
            attempts: 2,
            body: { v: 1, jobId: 'job-429', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(retry).toHaveBeenCalledWith({ delaySeconds: 20 });
    expect(ack).not.toHaveBeenCalled();
    expect(fetchCalls.some((c) => c.url.endsWith('/requeue'))).toBe(true);
    randomSpy.mockRestore();
  });

  it('resets backend dispatch state when retries are exhausted before lease acquisition', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-pre-acquire/acquire`)) {
        return new Response('backend unavailable', { status: 503 });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-pre-acquire/reset-dispatch`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    const ack = vi.fn();
    const retry = vi.fn();

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      IMAGES_BUCKET: makeR2Bucket({}),
      ASSETS_BUCKET: makeR2Bucket({}),
      MAX_QUEUE_ATTEMPTS: '5',
    };

    await worker.queue(
      {
        messages: [
          {
            id: 'm-pre-acquire',
            attempts: 5,
            body: { v: 1, jobId: 'job-pre-acquire', enqueuedAt: new Date().toISOString() },
            ack,
            retry,
          },
        ],
      },
      env,
      {} as any
    );

    expect(fetchCalls.some((c) => c.url.endsWith('/reset-dispatch'))).toBe(true);
    expect(retry).not.toHaveBeenCalled();
    expect(ack).toHaveBeenCalledTimes(1);
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

    (llmGenerateJson as any)
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

  it('uses provider and model settings per stage', async () => {
    const backendBase = 'https://backend.example';

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-provider-config/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-provider-config',
          job: {
            id: 'job-provider-config',
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

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-provider-config/heartbeat`)) {
        return jsonResponse({ success: true });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-provider-config/complete`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    (llmGenerateJson as any)
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

    const env: any = {
      BACKEND_BASE_URL: backendBase,
      BACKEND_WORKER_TOKEN: 'token',
      CF_AI_GATEWAY_ACCOUNT_ID: 'acct-123',
      CF_AI_GATEWAY_TOKEN: 'cf-gateway-token',
      CF_AI_GATEWAY_ID: 'grading',
      OCR_PROVIDER: 'workers-ai',
      OCR_MODEL: '@cf/meta/llama-3.2-11b-vision-instruct',
      OCR_REASONING_EFFORT: 'low',
      OCR_REQUEST_TIMEOUT_MS: '180000',
      AI_GRADING_PROVIDER: 'openai',
      AI_GRADING_MODEL: 'gpt-4.1-mini',
      AI_GRADING_API_KEY: 'openai-key',
      AI_GRADING_REASONING_EFFORT: 'low',
      AI_GRADING_REQUEST_TIMEOUT_MS: '90000',
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
            id: 'm-provider-config',
            attempts: 1,
            body: { v: 1, jobId: 'job-provider-config', enqueuedAt: new Date().toISOString() },
            ack: vi.fn(),
            retry: vi.fn(),
          },
        ],
      },
      env,
      {} as any
    );

    const calls = (llmGenerateJson as any).mock.calls;
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toMatchObject({
      gatewayAccountId: 'acct-123',
      gatewayId: 'grading',
      gatewayToken: 'cf-gateway-token',
      providerConfig: {
        provider: 'workers-ai',
        model: '@cf/meta/llama-3.2-11b-vision-instruct',
      },
      reasoningEffort: 'low',
      requestTimeoutMs: 180000,
    });
    expect(calls[1][0]).toMatchObject({
      providerConfig: {
        provider: 'openai',
        model: 'gpt-4.1-mini',
        apiKey: 'openai-key',
      },
      reasoningEffort: 'low',
      requestTimeoutMs: 90000,
    });
  });

  it('paces Gemini calls through the shared limiter and reports success feedback', async () => {
    const backendBase = 'https://backend.example';
    const limiterRequests: Array<{ path: string; body: any }> = [];
    const limiter = makeRateLimiterBinding(async (url, init) => {
      const parsedUrl = new URL(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      limiterRequests.push({ path: parsedUrl.pathname, body });
      if (parsedUrl.pathname === '/acquire') {
        return jsonResponse({ waitMs: 0, targetRps: 30, intervalMs: 34, scheduledAt: Date.now() });
      }
      if (parsedUrl.pathname === '/feedback') {
        return jsonResponse({ targetRps: 30, consecutive429s: 0, successCount: 1 });
      }
      return jsonResponse({ error: 'not found' }, 404);
    });

    (globalThis.fetch as any).mockImplementation(async (url: any, init?: any) => {
      fetchCalls.push({ url: String(url), init });

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-limited/acquire`)) {
        return jsonResponse({
          success: true,
          acquired: true,
          leaseId: 'lease-limited',
          job: {
            id: 'job-limited',
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

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-limited/heartbeat`)) {
        return jsonResponse({ success: true });
      }

      if (String(url).startsWith(`${backendBase}/internal/grading-worker/jobs/job-limited/complete`)) {
        return jsonResponse({ success: true });
      }

      throw new Error(`Unexpected fetch: ${String(url)}`);
    });

    (llmGenerateJson as any)
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
      GEMINI_RATE_LIMITER: limiter.binding,
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
            id: 'm-limited',
            attempts: 1,
            body: { v: 1, jobId: 'job-limited', enqueuedAt: new Date().toISOString() },
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
    expect(limiter.fetch).toHaveBeenCalledTimes(4);
    expect(limiterRequests.map((request) => request.path)).toEqual([
      '/acquire',
      '/feedback',
      '/acquire',
      '/feedback',
    ]);
    expect(limiterRequests[0].body.stage).toBe('ocr');
    expect(limiterRequests[1].body).toMatchObject({ ok: true, stage: 'ocr' });
    expect(limiterRequests[2].body.stage).toBe('grading');
    expect(limiterRequests[3].body).toMatchObject({ ok: true, stage: 'grading' });
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

    (llmGenerateJson as any)
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

    (llmGenerateJson as any).mockImplementation(async () => {
      throw new LlmHttpError(503, 'unavailable', 'workers-ai', '@cf/google/gemma-4-26b-a4b-it');
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

    (llmGenerateJson as any)
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
