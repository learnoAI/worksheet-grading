import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  buildSections,
  generateWorksheets,
  createClassBatch,
} from './worksheetGeneration';
import type { WorkerEnv } from '../types';

// ─── global fetch stub for the CF Queues API + question-gen worker ─────────
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function makeEnv(overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    CF_ACCOUNT_ID: 'acct-1',
    CF_API_TOKEN: 'tok-1',
    PDF_RENDERING_QUEUE_ID: 'pdf-q',
    QUESTION_GENERATION_QUEUE_ID: 'qgen-q',
    QUESTION_GENERATOR_WORKER_URL: 'https://qgen.workers.dev',
    WORKSHEET_CREATION_WORKER_TOKEN: 'wc-tok',
    ...overrides,
  };
}

function okCfApiResponse() {
  return new Response(
    JSON.stringify({ success: true, result: { messages: [] } }),
    { status: 200, headers: { 'Content-Type': 'application/json' } }
  );
}

// afterAll helper (vitest exposes globally via `globals: true` config, but
// in this project globals aren't on — so use the explicit import)
import { afterAll } from 'vitest';

describe('buildSections', () => {
  it('draws new skill for A+C (10 each), review1 for B, review2 for D', async () => {
    const findMany = vi
      .fn()
      // first call: new skill, 20 questions
      .mockResolvedValueOnce([
        ...Array.from({ length: 20 }, (_, i) => ({
          id: `n${i}`,
          question: `newQ${i}`,
          answer: `newA${i}`,
          instruction: 'Solve:',
        })),
      ])
      // second call: review1, 10 questions
      .mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => ({
          id: `r1_${i}`,
          question: `r1Q${i}`,
          answer: `r1A${i}`,
          instruction: 'Review1:',
        }))
      )
      // third call: review2, 10 questions
      .mockResolvedValueOnce(
        Array.from({ length: 10 }, (_, i) => ({
          id: `r2_${i}`,
          question: `r2Q${i}`,
          answer: `r2A${i}`,
          instruction: 'Review2:',
        }))
      );
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ name: 'Fractions' })
      .mockResolvedValueOnce({ name: 'Addition' })
      .mockResolvedValueOnce({ name: 'Multiplication' });

    const prisma = {
      questionBank: { findMany, updateMany },
      mathSkill: { findUnique },
    } as unknown as PrismaClient;

    const sections = await buildSections(prisma, 'new-s', 'r1-s', 'r2-s');
    expect(sections).toHaveLength(4);

    // A = first 10 new
    expect(sections[0].skillId).toBe('new-s');
    expect(sections[0].skillName).toBe('Fractions');
    expect(sections[0].questions).toHaveLength(10);
    expect(sections[0].questions[0]).toEqual({ question: 'newQ0', answer: 'newA0' });

    // B = review1
    expect(sections[1].skillId).toBe('r1-s');
    expect(sections[1].skillName).toBe('Addition');
    expect(sections[1].questions).toHaveLength(10);

    // C = last 10 new (indices 10..19)
    expect(sections[2].skillId).toBe('new-s');
    expect(sections[2].questions[0]).toEqual({ question: 'newQ10', answer: 'newA10' });

    // D = review2
    expect(sections[3].skillId).toBe('r2-s');
    expect(sections[3].skillName).toBe('Multiplication');

    // updateMany called 3 times (once per draw with non-empty results)
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it('returns "Math" when skill name lookup returns null', async () => {
    const prisma = {
      questionBank: {
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      mathSkill: {
        findUnique: vi.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaClient;

    const sections = await buildSections(prisma, 'a', 'b', 'c');
    expect(sections[0].skillName).toBe('Math');
    expect(sections[0].questions).toEqual([]);
  });
});

describe('generateWorksheets', () => {
  it('returns success with empty plans when curriculum has no skills', async () => {
    const prisma = {
      worksheetSkillMap: { findMany: vi.fn().mockResolvedValue([]) },
      skillPracticeLog: { findFirst: vi.fn() },
      studentSkillMastery: { findMany: vi.fn() },
    } as unknown as PrismaClient;

    const res = await generateWorksheets(
      prisma,
      makeEnv(),
      'student-1',
      2,
      new Date('2026-04-20')
    );
    expect(res.worksheetIds).toEqual([]);
    expect(res.errors).toContain('No skills mapped in curriculum');
    // No CF API calls — short-circuit before any queue publish.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('creates worksheet rows and enqueues PDF rendering for each', async () => {
    // Curriculum has 1 skill, 1 day requested → 1 worksheet created.
    const prisma = {
      worksheetSkillMap: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
      studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
      questionBank: {
        count: vi.fn().mockResolvedValue(100), // already enough, skip gen
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      mathSkill: { findUnique: vi.fn().mockResolvedValue({ name: 'Math' }) },
      generatedWorksheet: {
        create: vi.fn().mockResolvedValue({ id: 'ws-1' }),
      },
    } as unknown as PrismaClient;

    fetchMock.mockResolvedValue(okCfApiResponse());

    const res = await generateWorksheets(
      prisma,
      makeEnv(),
      'student-1',
      1,
      new Date('2026-04-20')
    );
    expect(res.worksheetIds).toEqual(['ws-1']);
    expect(res.status).toBe('COMPLETED');

    // One PDF enqueue per worksheet.
    const pdfQCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('pdf-q')
    );
    expect(pdfQCalls).toHaveLength(1);
    const body = JSON.parse(pdfQCalls[0][1]!.body as string);
    expect(body.body.worksheetId).toBe('ws-1');
    expect(body.body.v).toBe(1);
  });

  it('records PARTIAL status when a PDF enqueue fails', async () => {
    const prisma = {
      worksheetSkillMap: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
      studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
      questionBank: {
        count: vi.fn().mockResolvedValue(100),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      mathSkill: { findUnique: vi.fn().mockResolvedValue({ name: 'Math' }) },
      generatedWorksheet: { create: vi.fn().mockResolvedValue({ id: 'ws-1' }) },
    } as unknown as PrismaClient;

    fetchMock.mockResolvedValue(new Response('boom', { status: 500 }));
    const res = await generateWorksheets(
      prisma,
      makeEnv(),
      'student-1',
      1,
      new Date('2026-04-20')
    );
    expect(res.worksheetIds).toEqual(['ws-1']);
    expect(res.status).toBe('PARTIAL');
    expect(res.errors.some((e) => e.includes('enqueue PDF'))).toBe(true);
  });

  it('calls the question-gen worker when question count is below threshold', async () => {
    const prisma = {
      worksheetSkillMap: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
      studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
      questionBank: {
        count: vi.fn().mockResolvedValue(5), // below 30 → trigger gen
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
        createMany: vi.fn().mockResolvedValue({ count: 30 }),
      },
      mathSkill: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'A', name: 'SkillA', mainTopic: { name: 'Topic' } }),
      },
      generatedWorksheet: { create: vi.fn().mockResolvedValue({ id: 'ws-1' }) },
    } as unknown as PrismaClient;

    // First fetch = question-gen worker, returns 30 questions.
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            questions: Array.from({ length: 30 }, (_, i) => ({
              question: `q${i}`,
              answer: `a${i}`,
              instruction: 'solve',
            })),
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        )
      )
      // subsequent calls = queue publishes → ok envelope
      .mockResolvedValue(okCfApiResponse());

    const res = await generateWorksheets(
      prisma,
      makeEnv(),
      'student-1',
      1,
      new Date('2026-04-20')
    );
    expect(res.status).toBe('COMPLETED');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://qgen.workers.dev',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'X-Worksheet-Creation-Token': 'wc-tok',
        }),
      })
    );
    expect((prisma.questionBank.createMany as ReturnType<typeof vi.fn>)).toHaveBeenCalled();
  });

  it('records an error when QUESTION_GENERATOR_WORKER_URL is not set', async () => {
    const prisma = {
      worksheetSkillMap: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
      studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
      questionBank: {
        count: vi.fn().mockResolvedValue(0),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      mathSkill: {
        findUnique: vi.fn().mockResolvedValue({ id: 'A', name: 'Sk', mainTopic: null }),
      },
      generatedWorksheet: { create: vi.fn().mockResolvedValue({ id: 'ws-1' }) },
    } as unknown as PrismaClient;

    fetchMock.mockResolvedValue(okCfApiResponse());

    const env = makeEnv({ QUESTION_GENERATOR_WORKER_URL: undefined });
    const res = await generateWorksheets(
      prisma,
      env,
      'student-1',
      1,
      new Date('2026-04-20')
    );
    expect(res.status).toBe('PARTIAL');
    expect(res.errors.some((e) => e.includes('QUESTION_GENERATOR_WORKER_URL'))).toBe(
      true
    );
  });
});

describe('createClassBatch', () => {
  it('returns an error when class has no students', async () => {
    const prisma = {
      studentClass: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    const res = await createClassBatch(
      prisma,
      makeEnv(),
      'class-1',
      2,
      new Date('2026-04-20')
    );
    expect(res.batchId).toBe('');
    expect(res.errors).toContain('No students in class');
  });

  it('creates batch, enqueues question generation when skills are sparse', async () => {
    const prisma = {
      studentClass: {
        findMany: vi.fn().mockResolvedValue([{ studentId: 's1' }]),
      },
      worksheetBatch: {
        create: vi.fn().mockResolvedValue({ id: 'batch-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      worksheetSkillMap: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
      studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
      generatedWorksheet: { create: vi.fn().mockResolvedValue({ id: 'ws-1' }) },
      questionBank: { count: vi.fn().mockResolvedValue(0) }, // sparse
      mathSkill: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ id: 'A', name: 'Sk', mainTopic: { name: 'Topic' } }),
      },
    } as unknown as PrismaClient;

    fetchMock.mockResolvedValue(okCfApiResponse());
    const res = await createClassBatch(
      prisma,
      makeEnv(),
      'class-1',
      1,
      new Date('2026-04-20')
    );
    expect(res.batchId).toBe('batch-1');
    expect(res.skillsToGenerate).toBeGreaterThan(0);

    const qgenCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('qgen-q')
    );
    expect(qgenCalls.length).toBeGreaterThan(0);
    const body = JSON.parse(qgenCalls[0][1]!.body as string);
    expect(body.body.mathSkillId).toBe('A');
    expect(body.body.batchId).toBe('batch-1');
  });

  it('when all skills are stocked, assembles sections and enqueues PDF rendering directly', async () => {
    const prisma = {
      studentClass: {
        findMany: vi.fn().mockResolvedValue([{ studentId: 's1' }]),
      },
      worksheetBatch: {
        create: vi.fn().mockResolvedValue({ id: 'batch-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      worksheetSkillMap: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
      studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
      generatedWorksheet: {
        create: vi.fn().mockResolvedValue({ id: 'ws-1' }),
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'ws-1',
            studentId: 's1',
            newSkillId: 'A',
            reviewSkill1Id: 'A',
            reviewSkill2Id: 'A',
          },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      questionBank: {
        count: vi.fn().mockResolvedValue(100), // enough — skip generation
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      mathSkill: { findUnique: vi.fn().mockResolvedValue({ name: 'Sk' }) },
    } as unknown as PrismaClient;

    fetchMock.mockResolvedValue(okCfApiResponse());
    const res = await createClassBatch(
      prisma,
      makeEnv(),
      'class-1',
      1,
      new Date('2026-04-20')
    );
    expect(res.skillsToGenerate).toBe(0);

    const pdfCalls = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('pdf-q')
    );
    expect(pdfCalls.length).toBe(1);
  });
});
