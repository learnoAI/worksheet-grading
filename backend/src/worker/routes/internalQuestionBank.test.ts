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

/**
 * Wire `$transaction(cb)` to a tx proxy that re-uses the outer
 * worksheetBatch + batchSkillProgress mocks (so call counts on those
 * mocks remain visible to the test). Propagates callback rejections so
 * the caller's outer P2002 catch still fires.
 */
function makeTransactionMock(
  batchUpdate: ReturnType<typeof vi.fn>,
  skillProgressCreate: ReturnType<typeof vi.fn>
) {
  return vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    const tx = {
      worksheetBatch: { update: batchUpdate },
      batchSkillProgress: { create: skillProgressCreate },
    };
    return cb(tx);
  });
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

  it('persists renderSpec when present (matches Express + question-generator wire format)', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const app = mountApp({ questionBank: { createMany } });
    const renderSpec = {
      kind: 'long_division',
      divisor: '3',
      dividend: '24',
    };
    const res = await authed(app, '/internal/question-bank/store', {
      mathSkillId: 's1',
      questions: [
        { question: '3 ) 24', answer: '8', instruction: 'Solve.', renderSpec },
        { question: '5 + 5', answer: '10', instruction: 'Add.' }, // no renderSpec
      ],
    });
    expect(res.status).toBe(200);
    const call = createMany.mock.calls[0][0];
    expect(call.data[0].renderSpec).toEqual(renderSpec);
    expect(call.data[1].renderSpec).toBeUndefined();
  });

  it('records BatchSkillProgress AND increments batch completedSkills inside a $transaction', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi
      .fn()
      .mockResolvedValueOnce({ completedSkills: 1, pendingSkills: 3 })
      .mockResolvedValue({});
    const batchUpdateMany = vi.fn();
    const skillProgressCreate = vi.fn().mockResolvedValue({});
    const transaction = makeTransactionMock(batchUpdate, skillProgressCreate);
    const app = mountApp({
      questionBank: { createMany },
      worksheetBatch: { update: batchUpdate, updateMany: batchUpdateMany },
      batchSkillProgress: { create: skillProgressCreate },
      $transaction: transaction,
    });
    const res = await authed(app, '/internal/question-bank/store', {
      mathSkillId: 's1',
      questions: [{ question: 'Q', answer: 'A' }],
      batchId: 'b-1',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, stored: 1, idempotent: false });
    // Atomicity: BOTH writes happen inside the same transactional
    // callback (one $transaction call).
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(skillProgressCreate).toHaveBeenCalledWith({
      data: { batchId: 'b-1', mathSkillId: 's1' },
    });
    expect(batchUpdate).toHaveBeenCalledWith({
      where: { id: 'b-1' },
      data: { completedSkills: { increment: 1 } },
      select: { completedSkills: true, pendingSkills: true },
    });
  });

  it('returns idempotent:true and SKIPS counter increment when BatchSkillProgress.create raises P2002', async () => {
    // CF Queue redelivery scenario: the worker delivered the same
    // (batchId, mathSkillId) message twice. The first call inserted the
    // dedup row. The second call (this one) gets P2002 from the tx
    // callback, the transaction aborts, and the route returns idempotent.
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const batchUpdate = vi.fn();
    const batchFindUnique = vi.fn().mockResolvedValue({
      completedSkills: 1,
      pendingSkills: 3,
    });
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    const skillProgressCreate = vi.fn().mockRejectedValueOnce(p2002);
    const transaction = makeTransactionMock(batchUpdate, skillProgressCreate);
    // Silence the new redelivery-rate log.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // Mock fetch for the PostHog event the route now fires on idempotent
    // replays.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(
      async (..._args: Parameters<typeof fetch>) => new Response(null, { status: 200 })
    ) as unknown as typeof fetch;
    try {
      const app = mountApp({
        questionBank: { createMany },
        worksheetBatch: {
          update: batchUpdate,
          updateMany: vi.fn(),
          findUnique: batchFindUnique,
        },
        batchSkillProgress: { create: skillProgressCreate },
        $transaction: transaction,
      });
      const res = await app.request(
        '/internal/question-bank/store',
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Worksheet-Creation-Token': WORKER_TOKEN,
          },
          body: JSON.stringify({
            mathSkillId: 's1',
            questions: [{ question: 'Q', answer: 'A' }],
            batchId: 'b-1',
          }),
        },
        {
          WORKSHEET_CREATION_WORKER_TOKEN: WORKER_TOKEN,
          POSTHOG_API_KEY: 'phc-test',
        }
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        success: boolean;
        stored: number;
        idempotent: boolean;
      };
      expect(body.success).toBe(true);
      expect(body.stored).toBe(1);
      expect(body.idempotent).toBe(true);
      // CRITICAL: the batch counter MUST NOT have been touched.
      expect(batchUpdate).not.toHaveBeenCalled();
      expect(skillProgressCreate).toHaveBeenCalledTimes(1);
      // Observability: warn fires + PostHog event lands.
      // Prefix shared with the Express service (`[ws-batch]`) so oncall
      // greps one pattern across both runtimes during parallel-run.
      expect(warnSpy).toHaveBeenCalledWith(
        '[ws-batch] idempotent replay',
        expect.objectContaining({ batchId: 'b-1', mathSkillId: 's1' })
      );
      const fetchMock = globalThis.fetch as unknown as ReturnType<typeof vi.fn>;
      const calls = fetchMock.mock.calls
        .map((call) => JSON.parse((call[1] as RequestInit).body as string))
        .filter((b) => b.event === 'grading_pipeline');
      expect(calls).toHaveLength(1);
      expect(calls[0].properties.stage).toBe('question_bank_store_replayed');
      expect(calls[0].properties.batchId).toBe('b-1');
      expect(calls[0].properties.mathSkillId).toBe('s1');
    } finally {
      globalThis.fetch = originalFetch;
      warnSpy.mockRestore();
    }
  });

  it('kicks off PDF assembly when batch completes (completedSkills reaches pendingSkills)', async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    // Counter reaches the pending threshold → adapter flips status.
    // The flip itself is now a race-safe updateMany gated on
    // `status='GENERATING_QUESTIONS'`, returning count: 1 when we win
    // the race (so assembly fires) or count: 0 otherwise.
    const batchUpdate = vi
      .fn()
      .mockResolvedValueOnce({ completedSkills: 3, pendingSkills: 3 });
    const batchUpdateMany = vi.fn().mockResolvedValueOnce({ count: 1 });

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

    globalThis.fetch = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
    ) as unknown as typeof fetch;

    const skillProgressCreate = vi.fn().mockResolvedValue({});
    const transaction = makeTransactionMock(batchUpdate, skillProgressCreate);
    const app = mountApp({
      questionBank: {
        createMany,
        findMany: questionBankFindMany,
        updateMany: questionBankUpdateMany,
      },
      worksheetBatch: { update: batchUpdate, updateMany: batchUpdateMany },
      generatedWorksheet: { findMany: generatedWsFindMany, update: generatedWsUpdate },
      mathSkill: { findUnique: mathSkillFindUnique },
      batchSkillProgress: { create: skillProgressCreate },
      $transaction: transaction,
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
    const skillProgressCreate = vi.fn().mockResolvedValue({});
    // The $transaction internally fails because batchUpdate rejects
    // (simulating the partial-failure / DB blip scenario). Postgres
    // rolls back the dedup row; the route layer catches and returns 200.
    const transaction = makeTransactionMock(batchUpdate, skillProgressCreate);
    const app = mountApp({
      questionBank: { createMany },
      worksheetBatch: { update: batchUpdate, updateMany: vi.fn() },
      batchSkillProgress: { create: skillProgressCreate },
      $transaction: transaction,
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

    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
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
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
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
    globalThis.fetch = vi.fn(async (..._args: Parameters<typeof fetch>) =>
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
    globalThis.fetch = vi.fn(async (..._args: Parameters<typeof fetch>) =>
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
