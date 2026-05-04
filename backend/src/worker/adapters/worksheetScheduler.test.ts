import { describe, expect, it, vi } from 'vitest';
import { planWorksheets } from './worksheetScheduler';
import type { PrismaClient } from '@prisma/client';

function makePrisma(overrides: Record<string, unknown> = {}): PrismaClient {
  return {
    worksheetSkillMap: { findMany: vi.fn().mockResolvedValue([]) },
    skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
    studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
    ...overrides,
  } as unknown as PrismaClient;
}

describe('planWorksheets', () => {
  const START = new Date('2026-04-20T00:00:00Z');

  it('returns an error when the curriculum is empty', async () => {
    const prisma = makePrisma();
    const res = await planWorksheets(prisma, 'student-1', 3, START);
    expect(res.plans).toEqual([]);
    expect(res.errors).toEqual(['No skills mapped in curriculum']);
  });

  it('walks the curriculum forward by day, deduplicating repeated skills', async () => {
    const prisma = makePrisma({
      worksheetSkillMap: {
        findMany: vi.fn().mockResolvedValue([
          { worksheetNumber: 1, mathSkillId: 'A' },
          { worksheetNumber: 2, mathSkillId: 'B' },
          { worksheetNumber: 3, mathSkillId: 'A' }, // duplicate — should be deduped
          { worksheetNumber: 4, mathSkillId: 'C' },
        ]),
      },
    });
    const res = await planWorksheets(prisma, 'student-1', 3, START);
    expect(res.plans.map((p) => p.newSkillId)).toEqual(['A', 'B', 'C']);
  });

  it('starts after the last practiced skill when found in curriculum', async () => {
    const prisma = makePrisma({
      worksheetSkillMap: {
        findMany: vi.fn().mockResolvedValue([
          { worksheetNumber: 1, mathSkillId: 'A' },
          { worksheetNumber: 2, mathSkillId: 'B' },
          { worksheetNumber: 3, mathSkillId: 'C' },
        ]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue({ mathSkillId: 'A' }) },
    });
    const res = await planWorksheets(prisma, 'student-1', 2, START);
    expect(res.plans.map((p) => p.newSkillId)).toEqual(['B', 'C']);
  });

  it('picks review skills by (1-R) × level weight, highest first', async () => {
    // Two candidates — one has much lower retrievability (stale), should win.
    const stale = new Date(START.getTime() - 30 * 24 * 60 * 60 * 1000); // 30d old
    const recent = new Date(START.getTime() - 1 * 24 * 60 * 60 * 1000); // 1d old

    const prisma = makePrisma({
      worksheetSkillMap: {
        findMany: vi.fn().mockResolvedValue([
          { worksheetNumber: 1, mathSkillId: 'NEW' },
          { worksheetNumber: 2, mathSkillId: 'STALE' },
          { worksheetNumber: 3, mathSkillId: 'RECENT' },
        ]),
      },
      studentSkillMastery: {
        findMany: vi.fn().mockResolvedValue([
          {
            mathSkillId: 'STALE',
            lastPracticeAt: stale,
            stability: 1,
            masteryLevel: 'FAMILIAR',
          },
          {
            mathSkillId: 'RECENT',
            lastPracticeAt: recent,
            stability: 1,
            masteryLevel: 'FAMILIAR',
          },
        ]),
      },
    });

    const res = await planWorksheets(prisma, 'student-1', 1, START);
    expect(res.plans[0].newSkillId).toBe('NEW');
    expect(res.plans[0].reviewSkill1Id).toBe('STALE');
    expect(res.plans[0].reviewSkill2Id).toBe('RECENT');
  });

  it('skips NOT_STARTED skills from review candidates', async () => {
    const prisma = makePrisma({
      worksheetSkillMap: {
        findMany: vi.fn().mockResolvedValue([
          { worksheetNumber: 1, mathSkillId: 'NEW' },
          { worksheetNumber: 2, mathSkillId: 'NS' },
          { worksheetNumber: 3, mathSkillId: 'PROF' },
        ]),
      },
      studentSkillMastery: {
        findMany: vi.fn().mockResolvedValue([
          {
            mathSkillId: 'NS',
            lastPracticeAt: new Date(START.getTime() - 10 * 86400_000),
            stability: 1,
            masteryLevel: 'NOT_STARTED',
          },
          {
            mathSkillId: 'PROF',
            lastPracticeAt: new Date(START.getTime() - 10 * 86400_000),
            stability: 1,
            masteryLevel: 'PROFICIENT',
          },
        ]),
      },
    });
    const res = await planWorksheets(prisma, 'student-1', 1, START);
    // Only PROF is eligible; second review falls back to curriculum neighbor
    expect(res.plans[0].reviewSkill1Id).toBe('PROF');
  });

  it('falls back to curriculum neighbors when no mastery history exists', async () => {
    const prisma = makePrisma({
      worksheetSkillMap: {
        findMany: vi.fn().mockResolvedValue([
          { worksheetNumber: 1, mathSkillId: 'A' },
          { worksheetNumber: 2, mathSkillId: 'B' },
          { worksheetNumber: 3, mathSkillId: 'C' },
        ]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue({ mathSkillId: 'B' }) },
    });
    const res = await planWorksheets(prisma, 'student-1', 1, START);
    // newIdx = 2 (C). review1 falls back to curriculum[1] = B, review2 to curriculum[0] = A.
    expect(res.plans[0].newSkillId).toBe('C');
    expect(res.plans[0].reviewSkill1Id).toBe('B');
    expect(res.plans[0].reviewSkill2Id).toBe('A');
  });

  it('schedules days in ascending order from startDate', async () => {
    const prisma = makePrisma({
      worksheetSkillMap: {
        findMany: vi
          .fn()
          .mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
    });
    const res = await planWorksheets(prisma, 'student-1', 3, START);
    expect(res.plans.map((p) => p.scheduledDate.toISOString())).toEqual([
      '2026-04-20T00:00:00.000Z',
      '2026-04-21T00:00:00.000Z',
      '2026-04-22T00:00:00.000Z',
    ]);
  });
});
