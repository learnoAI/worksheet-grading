import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { buildSections, assembleAndEnqueuePdfs } from './worksheetSections';

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function mockQuestionRows(
  skillToRows: Record<string, Array<{ id: string; question: string; answer: string; instruction?: string }>>
) {
  const findMany = vi.fn(async (args: { where: { mathSkillId: string }; take: number }) => {
    const rows = skillToRows[args.where.mathSkillId] ?? [];
    return rows.slice(0, args.take);
  });
  const updateMany = vi.fn().mockResolvedValue({ count: 0 });
  return { findMany, updateMany };
}

describe('buildSections', () => {
  beforeEach(() => vi.clearAllMocks());

  it('shapes the output into [newA, review1, newC, review2] with correct counts', async () => {
    const rows = {
      'new-1': Array.from({ length: 20 }, (_, i) => ({
        id: `new-${i}`,
        question: `Q${i}?`,
        answer: `A${i}`,
        instruction: 'Solve.',
      })),
      'rev-1': Array.from({ length: 10 }, (_, i) => ({
        id: `r1-${i}`,
        question: `R1Q${i}?`,
        answer: `R1A${i}`,
        instruction: 'Review.',
      })),
      'rev-2': Array.from({ length: 10 }, (_, i) => ({
        id: `r2-${i}`,
        question: `R2Q${i}?`,
        answer: `R2A${i}`,
      })),
    };
    const { findMany, updateMany } = mockQuestionRows(rows);
    const mathSkillFindUnique = vi.fn(async (args: { where: { id: string } }) => {
      const name = { 'new-1': 'Fractions', 'rev-1': 'Algebra', 'rev-2': 'Decimals' }[
        args.where.id
      ];
      return name ? { name } : null;
    });

    const prisma = {
      questionBank: { findMany, updateMany },
      mathSkill: { findUnique: mathSkillFindUnique },
    } as unknown as PrismaClient;

    const sections = await buildSections(prisma, 'new-1', 'rev-1', 'rev-2');
    expect(sections).toHaveLength(4);
    expect(sections[0].skillName).toBe('Fractions');
    expect(sections[0].questions).toHaveLength(10); // new A
    expect(sections[1].skillName).toBe('Algebra');
    expect(sections[1].questions).toHaveLength(10); // review 1
    expect(sections[2].skillName).toBe('Fractions');
    expect(sections[2].questions).toHaveLength(10); // new C
    expect(sections[3].skillName).toBe('Decimals');
    expect(sections[3].questions).toHaveLength(10); // review 2

    // After drawing, usedCount should be incremented for each skill once.
    expect(updateMany).toHaveBeenCalledTimes(3);
  });

  it('falls back to default instruction when no question row has one', async () => {
    const { findMany, updateMany } = mockQuestionRows({
      's1': [{ id: 'q1', question: 'Q?', answer: 'A' }],
    });
    const prisma = {
      questionBank: { findMany, updateMany },
      mathSkill: { findUnique: vi.fn().mockResolvedValue({ name: 'S' }) },
    } as unknown as PrismaClient;

    const sections = await buildSections(prisma, 's1', 's1', 's1');
    expect(sections[0].instruction).toBe('Solve the following.');
  });

  it('defaults skill name to "Math" when mathSkill lookup returns null', async () => {
    const { findMany, updateMany } = mockQuestionRows({
      's1': [{ id: 'q1', question: 'Q?', answer: 'A' }],
    });
    const prisma = {
      questionBank: { findMany, updateMany },
      mathSkill: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;

    const sections = await buildSections(prisma, 's1', 's1', 's1');
    expect(sections[0].skillName).toBe('Math');
  });

  it('skips usedCount update when no questions drawn', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const updateMany = vi.fn();
    const prisma = {
      questionBank: { findMany, updateMany },
      mathSkill: { findUnique: vi.fn().mockResolvedValue({ name: 'S' }) },
    } as unknown as PrismaClient;

    await buildSections(prisma, 's1', 's2', 's3');
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('threads renderSpec through all four section types', async () => {
    // Long-division spec for new skill, vertical-arithmetic for review1,
    // choice-circle for review2 — exercises the three known render kinds plus
    // a `null` renderSpec to ensure plain rows still pass through.
    const longDivisionSpec = { kind: 'long-division', dividend: 144, divisor: 12 };
    const verticalSpec = { kind: 'vertical-arithmetic', op: '+', operands: [12, 7] };
    const choiceSpec = { kind: 'choice-circle', options: ['A', 'B', 'C'] };

    const newRows = Array.from({ length: 20 }, (_, i) => ({
      id: `new-${i}`,
      question: `Q${i}?`,
      answer: `A${i}`,
      instruction: 'Solve.',
      // Mix of specs across the new-skill rows so slice 0..10 and 10..20
      // both carry a non-null renderSpec.
      renderSpec: i % 2 === 0 ? longDivisionSpec : verticalSpec,
    }));
    const review1Rows = Array.from({ length: 10 }, (_, i) => ({
      id: `r1-${i}`,
      question: `R1Q${i}?`,
      answer: `R1A${i}`,
      instruction: 'Review.',
      renderSpec: verticalSpec,
    }));
    const review2Rows = Array.from({ length: 10 }, (_, i) => ({
      id: `r2-${i}`,
      question: `R2Q${i}?`,
      answer: `R2A${i}`,
      instruction: 'Review.',
      // Half null to confirm null renderSpec is preserved verbatim, not dropped.
      renderSpec: i < 5 ? choiceSpec : null,
    }));

    const findMany = vi.fn(async (args: { where: { mathSkillId: string }; take: number }) => {
      const map: Record<string, Array<Record<string, unknown>>> = {
        'new-1': newRows,
        'rev-1': review1Rows,
        'rev-2': review2Rows,
      };
      return (map[args.where.mathSkillId] ?? []).slice(0, args.take);
    });
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const mathSkillFindUnique = vi.fn(async (args: { where: { id: string } }) => ({
      name: { 'new-1': 'LongDiv', 'rev-1': 'VertAdd', 'rev-2': 'Choice' }[args.where.id] ?? 'Math',
    }));

    const prisma = {
      questionBank: { findMany, updateMany },
      mathSkill: { findUnique: mathSkillFindUnique },
    } as unknown as PrismaClient;

    const sections = await buildSections(prisma, 'new-1', 'rev-1', 'rev-2');

    // findMany should select renderSpec
    const findManyCall = findMany.mock.calls[0][0] as unknown as {
      select: Record<string, boolean>;
    };
    expect(findManyCall.select.renderSpec).toBe(true);

    // Section 0: new A — slice 0..10 of newRows (even indices = longDivision, odd = vertical)
    expect(sections[0].questions).toHaveLength(10);
    expect(sections[0].questions[0].renderSpec).toEqual(longDivisionSpec);
    expect(sections[0].questions[1].renderSpec).toEqual(verticalSpec);

    // Section 1: review 1 — every row carries verticalSpec
    expect(sections[1].questions).toHaveLength(10);
    for (const q of sections[1].questions) {
      expect(q.renderSpec).toEqual(verticalSpec);
    }

    // Section 2: new C — slice 10..20 of newRows (index 10 even, 11 odd, ...)
    expect(sections[2].questions).toHaveLength(10);
    expect(sections[2].questions[0].renderSpec).toEqual(longDivisionSpec);
    expect(sections[2].questions[1].renderSpec).toEqual(verticalSpec);

    // Section 3: review 2 — first 5 carry choiceSpec, last 5 are null and must
    // be preserved as null (not stripped to undefined / missing key).
    expect(sections[3].questions).toHaveLength(10);
    expect(sections[3].questions[0].renderSpec).toEqual(choiceSpec);
    expect(sections[3].questions[4].renderSpec).toEqual(choiceSpec);
    expect(sections[3].questions[5].renderSpec).toBeNull();
    expect(sections[3].questions[9].renderSpec).toBeNull();

    // The renderSpec key should be present on every question even when null,
    // so PDF renderers downstream can rely on its existence.
    for (const section of sections) {
      for (const q of section.questions) {
        expect(q).toHaveProperty('renderSpec');
      }
    }
  });
});

describe('assembleAndEnqueuePdfs', () => {
  const env = {
    CF_ACCOUNT_ID: 'acct',
    CF_API_TOKEN: 'tok',
    CF_API_BASE_URL: 'https://api.cloudflare.com/client/v4',
    PDF_RENDERING_QUEUE_ID: 'pdf-queue',
  };

  beforeEach(() => vi.clearAllMocks());

  function makePrisma(worksheets: Array<Record<string, unknown>>) {
    const generatedWsFindMany = vi.fn().mockResolvedValue(worksheets);
    const generatedWsUpdate = vi.fn().mockResolvedValue({});
    const questionBankFindMany = vi.fn().mockResolvedValue([
      { id: 'q1', question: 'Q?', answer: 'A', instruction: 'Do.' },
    ]);
    const questionBankUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
    const mathSkillFindUnique = vi.fn().mockResolvedValue({ name: 'S' });
    const worksheetBatchUpdate = vi.fn().mockResolvedValue({});

    const prisma = {
      generatedWorksheet: { findMany: generatedWsFindMany, update: generatedWsUpdate },
      questionBank: {
        findMany: questionBankFindMany,
        updateMany: questionBankUpdateMany,
      },
      mathSkill: { findUnique: mathSkillFindUnique },
      worksheetBatch: { update: worksheetBatchUpdate },
    } as unknown as PrismaClient;

    return {
      prisma,
      spies: {
        generatedWsFindMany,
        generatedWsUpdate,
        worksheetBatchUpdate,
      },
    };
  }

  it('assembles sections and publishes one PDF message per worksheet', async () => {
    const fetchMock = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const { prisma, spies } = makePrisma([
      {
        id: 'ws-1',
        batchId: 'b-1',
        newSkillId: 's1',
        reviewSkill1Id: 's2',
        reviewSkill2Id: 's3',
      },
      {
        id: 'ws-2',
        batchId: 'b-1',
        newSkillId: 's1',
        reviewSkill1Id: 's2',
        reviewSkill2Id: 's3',
      },
    ]);

    const result = await assembleAndEnqueuePdfs(prisma, env, 'b-1');

    expect(result.assembled).toBe(2);
    expect(result.failed).toBe(0);
    expect(result.errors).toEqual([]);
    // Each worksheet: one `generatedWorksheet.update` + one fetch to the queue
    expect(spies.generatedWsUpdate).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(firstBody.body).toMatchObject({
      worksheetId: 'ws-1',
      batchId: 'b-1',
      v: 1,
    });
  });

  it('records queue publish failures in errors without throwing', async () => {
    globalThis.fetch = vi.fn(async (..._args: Parameters<typeof fetch>) =>
      new Response('oops', { status: 500 })
    ) as unknown as typeof fetch;

    const { prisma } = makePrisma([
      {
        id: 'ws-1',
        batchId: 'b-1',
        newSkillId: 's1',
        reviewSkill1Id: 's2',
        reviewSkill2Id: 's3',
      },
    ]);

    const result = await assembleAndEnqueuePdfs(prisma, env, 'b-1');
    expect(result.assembled).toBe(0);
    expect(result.failed).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toContain('Queue publish failed');
  });

  it('marks worksheet FAILED + increments batch counter on assemble error', async () => {
    const env2 = { ...env };
    // Force buildSections to throw by having mathSkill.findUnique reject
    const prismaFail = {
      generatedWorksheet: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'ws-1',
            batchId: 'b-1',
            newSkillId: 's1',
            reviewSkill1Id: 's2',
            reviewSkill2Id: 's3',
          },
        ]),
        update: vi.fn().mockResolvedValue({}),
      },
      questionBank: {
        findMany: vi.fn().mockRejectedValue(new Error('db down')),
        updateMany: vi.fn(),
      },
      mathSkill: { findUnique: vi.fn() },
      worksheetBatch: { update: vi.fn().mockResolvedValue({}) },
    } as unknown as PrismaClient;

    const result = await assembleAndEnqueuePdfs(prismaFail, env2, 'b-1');
    expect(result.assembled).toBe(0);
    expect(result.failed).toBe(1);
    expect(result.errors[0]).toContain('Failed to assemble worksheet ws-1');

    // Marked FAILED
    expect((prismaFail.generatedWorksheet.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      where: { id: 'ws-1' },
      data: { status: 'FAILED' },
    });
    // Batch counter incremented
    expect((prismaFail.worksheetBatch.update as ReturnType<typeof vi.fn>).mock.calls[0][0]).toMatchObject({
      where: { id: 'b-1' },
      data: { failedWorksheets: { increment: 1 } },
    });
  });

  it('no-ops when batch has no PENDING worksheets', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    const { prisma } = makePrisma([]);
    const result = await assembleAndEnqueuePdfs(prisma, env, 'b-1');
    expect(result).toEqual({ assembled: 0, failed: 0, errors: [] });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
