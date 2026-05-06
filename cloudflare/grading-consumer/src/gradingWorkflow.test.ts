import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock the LLM module so we can drive tier-by-tier success/failure from
// the test rather than spinning up a real fetch chain.
vi.mock('./llm', () => {
  class LlmHttpError extends Error {
    constructor(public readonly status: number, public readonly responseText: string) {
      super(`LLM ${status}: ${responseText}`);
      this.name = 'LlmHttpError';
    }
  }
  return {
    LlmHttpError,
    llmGenerateJson: vi.fn(),
  };
});

vi.mock('./assets', () => ({
  loadAnswerKey: vi.fn(async () => ({})),
  loadCustomPrompt: vi.fn(async () => null),
}));

vi.mock('./prompts', () => ({
  buildOcrPrompt: () => 'OCR_PROMPT',
  buildAiGradingPrompt: () => 'GRADING_PROMPT',
  buildBookGradingPrompt: () => 'BOOK_GRADING_PROMPT',
}));

vi.mock('./gradingTransform', () => ({
  toBackendGradingResponse: (g: unknown) => ({ success: true, grade: 5, _from: g }),
}));

vi.mock('./schemas', () => ({
  ExtractedQuestionsJsonSchema: {},
  GradingResultJsonSchema: {},
  ExtractedQuestionsSchema: { parse: (v: unknown) => v },
  GradingResultSchema: { parse: (v: unknown) => v },
}));

import { GradingWorkflow } from './gradingWorkflow';
import { llmGenerateJson } from './llm';

interface StepCall {
  name: string;
}

function makeStepStub() {
  const calls: StepCall[] = [];
  const step = {
    async do<T>(name: string, _config: unknown, fn?: () => Promise<T>): Promise<T> {
      calls.push({ name });
      // step.do is called with either (name, fn) or (name, config, fn).
      const callable = (typeof _config === 'function' ? _config : fn) as () => Promise<T>;
      return callable();
    },
    async sleep() {
      /* noop */
    },
  };
  return { step, calls };
}

const acceptableImage = {
  s3Key: 'k1',
  storageProvider: 'R2' as const,
  pageNumber: 1,
  mimeType: 'image/png',
};

const acceptableJob = {
  id: 'job-1',
  status: 'PROCESSING',
  tokenNo: 'T1',
  worksheetName: 'W',
  worksheetNumber: 5,
  submittedOn: '2026-04-10T00:00:00Z',
  isRepeated: false,
  studentId: 'st1',
  classId: 'c1',
  teacherId: 't1',
  images: [acceptableImage],
};

function makeEnvStubs() {
  const r2Get = vi.fn(async () => ({
    arrayBuffer: async () => new ArrayBuffer(8),
  }));
  const env = {
    BACKEND_BASE_URL: 'http://backend',
    BACKEND_WORKER_TOKEN: 'tok',
    IMAGES_BUCKET: { get: r2Get } as never,
    ASSETS_BUCKET: { get: vi.fn() } as never,
  };
  return env;
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

function mockBackendFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url;
    return handler(url, init);
  }) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('GradingWorkflow', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('succeeds on tier 1 → calls persist-success once, never invokes later tiers', async () => {
    const env = makeEnvStubs();
    const { step, calls } = makeStepStub();
    const completeCalls: Array<{ url: string; body: unknown }> = [];

    mockBackendFetch(async (url, init) => {
      if (url.endsWith('/acquire')) {
        return jsonResponse({ success: true, acquired: true, leaseId: 'lease-1', job: acceptableJob });
      }
      if (url.endsWith('/complete')) {
        completeCalls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse({ success: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    (llmGenerateJson as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      parsed: { questions: [{ question_number: 1, question: 'q', student_answer: 'a' }] },
      rawText: '{}',
    });
    // Second LLM call (grading)
    (llmGenerateJson as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (opts: { parts: Array<{ text?: string }> }) => {
      const isOcr = opts.parts.some((p) => p.text === 'OCR_PROMPT');
      if (isOcr) {
        return {
          parsed: { questions: [{ question_number: 1, question: 'q', student_answer: 'a' }] },
          rawText: '{}',
        };
      }
      return {
        parsed: { question_scores: [], overall_feedback: 'ok' },
        rawText: '{}',
      };
    });

    const wf = new GradingWorkflow({} as never, env as never);
    await wf.run({ payload: { jobId: 'job-1', enqueuedAt: '2026-05-07T00:00:00Z' } } as never, step as never);

    // tier-1 only for both OCR and grading; no fallthrough.
    const tierStepNames = calls.map((c) => c.name);
    expect(tierStepNames).toContain('ocr-cf-gemma-thinking');
    expect(tierStepNames).toContain('grading-cf-gemma-thinking');
    expect(tierStepNames).not.toContain('ocr-cf-gemma-no-thinking');
    expect(tierStepNames).not.toContain('grading-cf-gemma-no-thinking');
    expect(tierStepNames).not.toContain('ocr-openrouter');
    expect(tierStepNames).not.toContain('grading-openrouter');
    expect(tierStepNames).toContain('persist-success');
    expect(tierStepNames).not.toContain('persist-failure');

    expect(completeCalls).toHaveLength(1);
  });

  it('falls through tier 1 → tier 2 success on grading; persist-success still wins', async () => {
    const env = makeEnvStubs();
    const { step, calls } = makeStepStub();
    let completeHits = 0;

    mockBackendFetch(async (url) => {
      if (url.endsWith('/acquire')) {
        return jsonResponse({ success: true, acquired: true, leaseId: 'lease-2', job: acceptableJob });
      }
      if (url.endsWith('/complete')) {
        completeHits++;
        return jsonResponse({ success: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    let gradingCallCount = 0;
    (llmGenerateJson as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (opts: { parts: Array<{ text?: string }>; reasoningEffort?: string }) => {
        const isOcr = opts.parts.some((p) => p.text === 'OCR_PROMPT');
        if (isOcr) {
          return {
            parsed: { questions: [{ question_number: 1, question: 'q', student_answer: 'a' }] },
            rawText: '{}',
          };
        }
        gradingCallCount++;
        // tier 1 (reasoningEffort=high) throws; tier 2 (low) succeeds.
        if (opts.reasoningEffort === 'high') {
          throw new Error('thinking-mode timeout');
        }
        return {
          parsed: { question_scores: [], overall_feedback: 'ok' },
          rawText: '{}',
        };
      },
    );

    const wf = new GradingWorkflow({} as never, env as never);
    await wf.run({ payload: { jobId: 'job-1', enqueuedAt: '2026-05-07T00:00:00Z' } } as never, step as never);

    const tierStepNames = calls.map((c) => c.name);
    expect(tierStepNames).toContain('grading-cf-gemma-thinking');
    expect(tierStepNames).toContain('grading-cf-gemma-no-thinking');
    expect(tierStepNames).not.toContain('grading-openrouter');
    expect(tierStepNames).toContain('persist-success');
    expect(completeHits).toBe(1);
    expect(gradingCallCount).toBe(2);
  });

  it('exhausts all 3 grading tiers → persist-failure called, throws NonRetryableError', async () => {
    const env = makeEnvStubs();
    const { step, calls } = makeStepStub();
    const failCalls: Array<{ body: unknown }> = [];

    mockBackendFetch(async (url, init) => {
      if (url.endsWith('/acquire')) {
        return jsonResponse({ success: true, acquired: true, leaseId: 'lease-3', job: acceptableJob });
      }
      if (url.endsWith('/fail')) {
        failCalls.push({ body: init?.body ? JSON.parse(String(init.body)) : null });
        return jsonResponse({ success: true });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    (llmGenerateJson as unknown as ReturnType<typeof vi.fn>).mockImplementation(
      async (opts: { parts: Array<{ text?: string }> }) => {
        const isOcr = opts.parts.some((p) => p.text === 'OCR_PROMPT');
        if (isOcr) {
          return {
            parsed: { questions: [{ question_number: 1, question: 'q', student_answer: 'a' }] },
            rawText: '{}',
          };
        }
        // Every grading tier fails.
        throw new Error('llm down');
      },
    );

    const wf = new GradingWorkflow({} as never, env as never);
    await expect(
      wf.run({ payload: { jobId: 'job-1', enqueuedAt: '2026-05-07T00:00:00Z' } } as never, step as never),
    ).rejects.toThrow(/Grading failed after all tiers/);

    const tierStepNames = calls.map((c) => c.name);
    expect(tierStepNames).toContain('grading-cf-gemma-thinking');
    expect(tierStepNames).toContain('grading-cf-gemma-no-thinking');
    expect(tierStepNames).toContain('grading-openrouter');
    expect(tierStepNames).toContain('persist-failure');
    expect(tierStepNames).not.toContain('persist-success');
    expect(failCalls).toHaveLength(1);
    const failBody = failCalls[0].body as { errorMessage: string; leaseId: string };
    expect(failBody.leaseId).toBe('lease-3');
    expect(failBody.errorMessage).toBe('llm down');
  });

  it('aborts immediately on acquire mismatch (job not in QUEUED state)', async () => {
    const env = makeEnvStubs();
    const { step, calls } = makeStepStub();

    mockBackendFetch(async (url) => {
      if (url.endsWith('/acquire')) {
        return jsonResponse({ success: true, acquired: false });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const wf = new GradingWorkflow({} as never, env as never);
    await expect(
      wf.run({ payload: { jobId: 'job-1', enqueuedAt: '2026-05-07T00:00:00Z' } } as never, step as never),
    ).rejects.toThrow();

    // No tier or persist step should run if acquire didn't yield a lease.
    const stepNames = calls.map((c) => c.name);
    expect(stepNames).toContain('acquire');
    expect(stepNames).not.toContain('ocr-cf-gemma-thinking');
    expect(stepNames).not.toContain('grading-cf-gemma-thinking');
    expect(stepNames).not.toContain('persist-success');
    expect(stepNames).not.toContain('persist-failure');
  });
});
