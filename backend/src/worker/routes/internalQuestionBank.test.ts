import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import internalQuestionBank from './internalQuestionBank';
import type { AppBindings } from '../types';

const WORKER_TOKEN = 'worker-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/internal/question-bank', internalQuestionBank);
  return app;
}

async function authed(
  app: Hono<AppBindings>,
  path: string,
  body: unknown,
  env: Record<string, unknown> = {}
) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Worksheet-Creation-Token': WORKER_TOKEN,
      },
      body: JSON.stringify(body),
    },
    { WORKSHEET_CREATION_WORKER_TOKEN: WORKER_TOKEN, ...env }
  );
}

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('Auth on /internal/question-bank/*', () => {
  it('rejects requests without the worker token', async () => {
    const app = mountApp({});
    const res = await app.request(
      '/internal/question-bank/store',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mathSkillId: 's1', questions: [{ question: 'Q', answer: 'A' }] }),
      },
      { WORKSHEET_CREATION_WORKER_TOKEN: WORKER_TOKEN }
    );
    expect(res.status).toBe(401);
  });
});

describe('POST /internal/question-bank/store', () => {
  beforeEach(() => vi.clearAllMocks());

  it('validates the body and rejects empty questions arrays', async () => {
    const app = mountApp({});
    const res = await authed(app, '/internal/question-bank/store', {
      mathSkillId: 's1',
      questions: [],
    });
    expect(res.status).toBe(400);
  });

  it('stores questions via createMany and returns count', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const app = mountApp({ questionBank: { createMany } });
    const res = await authed(app, '/internal/question-bank/store', {
      mathSkillId: 's1',
      questions: [
        { question: 'Q1', answer: 'A1' },
        { question: 'Q2', answer: 'A2', instruction: 'Solve.' },
        { question: 'Q3', answer: 'A3' },
      ],
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, stored: 3 });
    const call = createMany.mock.calls[0][0];
    expect(call.data).toHaveLength(3);
    expect(call.data[1].instruction).toBe('Solve.');
  });

  it('increments batch completedSkills when batchId is provided', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    // Mock for incrementBatchCompletedSkills:
    const batchUpdate = vi
      .fn()
      .mockResolvedValueOnce({ completedSkills: 1, pendingSkills: 3 })
      .mockResolvedValue({});
    const app = mountApp({
      questionBank: { createMany },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await authed(app, '/internal/question-bank/store', {
      mathSkillId: 's1',
      questions: [{ question: 'Q', answer: 'A' }],
      batchId: 'b-1',
    });
    expect(res.status).toBe(200);
    expect(batchUpdate).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      data: { completedSkills: { increment: 1 } },
    });
  });

  it('kicks off PDF assembly when batch completes (completedSkills reaches pendingSkills)', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    // Counter reaches the pending threshold → adapter flips status.
    const batchUpdate = vi
      .fn()
      .mockResolvedValueOnce({ completedSkills: 3, pendingSkills: 3 })
      .mockResolvedValueOnce({}); // status flip to RENDERING_PDFS

    const generatedWsFindMany = vi
      .fn()
      .mockResolvedValue([
        {
          id: 'ws-1',
          batchId: 'b-1',
          newSkillId: 'n1',
          reviewSkill1Id: 'r1',
          reviewSkill2Id: 'r2',
        },
      ]);
    const generatedWsUpdate = vi.fn().mockResolvedValue({});
    const questionBankFindMany = vi.fn().mockResolvedValue([]);
    const questionBankUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const mathSkillFindUnique = vi.fn().mockResolvedValue({ name: 'S' });

    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
    ) as unknown as typeof fetch;

    const app = mountApp({
      questionBank: {
        createMany,
        findMany: questionBankFindMany,
        updateMany: questionBankUpdateMany,
      },
      worksheetBatch: { update: batchUpdate },
      generatedWorksheet: { findMany: generatedWsFindMany, update: generatedWsUpdate },
      mathSkill: { findUnique: mathSkillFindUnique },
    });
    const res = await authed(
      app,
      '/internal/question-bank/store',
      { mathSkillId: 's1', questions: [{ question: 'Q', answer: 'A' }], batchId: 'b-1' },
      {
        CF_ACCOUNT_ID: 'acct',
        CF_API_TOKEN: 'tok',
        CF_API_BASE_URL: 'https://api.cloudflare.com/client/v4',
        PDF_RENDERING_QUEUE_ID: 'pdf',
      }
    );
    expect(res.status).toBe(200);
    // The assemble-and-enqueue path ran:
    expect(generatedWsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { batchId: 'b-1', status: 'PENDING' } })
    );
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('still returns 200 even if batch progress fails (non-fatal)', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn().mockRejectedValue(new Error('db down'));
    const app = mountApp({
      questionBank: { createMany },
      worksheetBatch: { update: batchUpdate },
    });
    const res = await authed(app, '/internal/question-bank/store', {
      mathSkillId: 's1',
      questions: [{ question: 'Q', answer: 'A' }],
      batchId: 'b-1',
    });
    expect(res.status).toBe(200);
  });

  it('returns 500 when createMany itself throws', async () => {
    const app = mountApp({
      questionBank: { createMany: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    const res = await authed(app, '/internal/question-bank/store', {
      mathSkillId: 's1',
      questions: [{ question: 'Q', answer: 'A' }],
    });
    expect(res.status).toBe(500);
  });
});

describe('POST /internal/question-bank/generate', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when skill is not found', async () => {
    const app = mountApp({
      mathSkill: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const res = await authed(app, '/internal/question-bank/generate', {
      mathSkillId: 'missing',
    });
    expect(res.status).toBe(404);
  });

  it('returns 500 when QUESTION_GENERATOR_WORKER_URL is not configured', async () => {
    const app = mountApp({
      mathSkill: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          name: 'Fractions',
          mainTopic: { name: 'Math' },
        }),
      },
    });
    const res = await authed(app, '/internal/question-bank/generate', {
      mathSkillId: 's1',
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('QUESTION_GENERATOR_WORKER_URL');
  });

  it('forwards to the worker and persists returned questions', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const app = mountApp({
      mathSkill: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          name: 'Fractions',
          mainTopic: { name: 'Math' },
        }),
      },
      questionBank: { createMany },
    });

    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          questions: [
            { question: 'Q1', answer: 'A1', instruction: 'Solve.' },
            { question: 'Q2', answer: 'A2' },
          ],
        }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const res = await authed(
      app,
      '/internal/question-bank/generate',
      { mathSkillId: 's1', count: 10 },
      { QUESTION_GENERATOR_WORKER_URL: 'https://qg-worker.example.com' }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, stored: 2 });
    expect(createMany).toHaveBeenCalled();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://qg-worker.example.com');
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body).toEqual({
      mathSkillId: 's1',
      skillName: 'Fractions',
      topicName: 'Math',
      count: 10,
    });
  });

  it('defaults count to 30 when not provided', async () => {
    const app = mountApp({
      mathSkill: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          name: 'Fractions',
          mainTopic: null,
        }),
      },
      questionBank: { createMany: vi.fn().mockResolvedValue({ count: 1 }) },
    });
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          success: true,
          questions: [{ question: 'Q', answer: 'A' }],
        }),
        { status: 200 }
      )
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    await authed(
      app,
      '/internal/question-bank/generate',
      { mathSkillId: 's1' },
      { QUESTION_GENERATOR_WORKER_URL: 'https://qg-worker.example.com' }
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string);
    expect(body.count).toBe(30);
    // Falls back to "Math" topicName when mainTopic is null
    expect(body.topicName).toBe('Math');
  });

  it('returns 502 when the worker responds with non-2xx', async () => {
    const app = mountApp({
      mathSkill: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          name: 'Fractions',
          mainTopic: null,
        }),
      },
      questionBank: { createMany: vi.fn() },
    });
    globalThis.fetch = vi.fn(async () =>
      new Response('nope', { status: 502 })
    ) as unknown as typeof fetch;
    const res = await authed(
      app,
      '/internal/question-bank/generate',
      { mathSkillId: 's1' },
      { QUESTION_GENERATOR_WORKER_URL: 'https://qg-worker.example.com' }
    );
    expect(res.status).toBe(502);
  });

  it('returns 502 when the worker returns success=false or no questions', async () => {
    const app = mountApp({
      mathSkill: {
        findUnique: vi.fn().mockResolvedValue({
          id: 's1',
          name: 'Fractions',
          mainTopic: null,
        }),
      },
      questionBank: { createMany: vi.fn() },
    });
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: false, error: 'model refused' }), {
        status: 200,
      })
    ) as unknown as typeof fetch;
    const res = await authed(
      app,
      '/internal/question-bank/generate',
      { mathSkillId: 's1' },
      { QUESTION_GENERATOR_WORKER_URL: 'https://qg-worker.example.com' }
    );
    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('model refused');
  });
});
