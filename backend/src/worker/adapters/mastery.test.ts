import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { computeRecommendations } from './mastery';

function mockPrisma(records: unknown[]): PrismaClient {
  return {
    studentSkillMastery: {
      findMany: vi.fn().mockResolvedValue(records),
    },
  } as unknown as PrismaClient;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

describe('computeRecommendations', () => {
  it('calls prisma with the right filter (no NOT_STARTED, must have lastPracticeAt)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const prisma = { studentSkillMastery: { findMany } } as unknown as PrismaClient;
    await computeRecommendations(prisma, 'st1');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          studentId: 'st1',
          lastPracticeAt: { not: null },
          masteryLevel: { not: 'NOT_STARTED' },
        },
      })
    );
  });

  it('returns an empty list when every skill is above the review threshold', async () => {
    // Practiced yesterday with huge stability → retrievability ≈ 1 → skipped.
    const records = [
      {
        mathSkillId: 'sk1',
        masteryLevel: 'MASTERED',
        stability: 1e6,
        lastPracticeAt: daysAgo(1),
        mathSkill: {
          name: 'Fractions',
          mainTopic: { name: 'Numbers' },
          worksheetSkillMaps: [{ worksheetNumber: 1 }],
        },
      },
    ];
    const prisma = mockPrisma(records);
    const recs = await computeRecommendations(prisma, 'st1');
    expect(recs).toEqual([]);
  });

  it('returns recommendations for stale skills and sorts by priority desc', async () => {
    // Two records below the 0.85 retrievability threshold. The one with
    // lower retrievability AND a higher mastery weight wins priority.
    const records = [
      {
        mathSkillId: 'sk-old-familiar', // familiar = 0.8, very stale → high priority
        masteryLevel: 'FAMILIAR',
        stability: 1,
        lastPracticeAt: daysAgo(30),
        mathSkill: {
          name: 'Fractions',
          mainTopic: { name: 'Numbers' },
          worksheetSkillMaps: [{ worksheetNumber: 3 }, { worksheetNumber: 4 }],
        },
      },
      {
        mathSkillId: 'sk-mild-attempted', // attempted = 0.6, less stale → lower priority
        masteryLevel: 'ATTEMPTED',
        stability: 5,
        lastPracticeAt: daysAgo(10),
        mathSkill: {
          name: 'Decimals',
          mainTopic: null,
          worksheetSkillMaps: [{ worksheetNumber: 5 }],
        },
      },
    ];
    const prisma = mockPrisma(records);
    const recs = await computeRecommendations(prisma, 'st1');
    expect(recs.length).toBe(2);
    expect(recs[0].mathSkillId).toBe('sk-old-familiar');
    expect(recs[0].priority).toBeGreaterThan(recs[1].priority);
    expect(recs[0].mainTopicName).toBe('Numbers');
    expect(recs[1].mainTopicName).toBeNull();
    expect(recs[0].worksheetNumbers).toEqual([3, 4]);
  });

  it('caps the list at `limit`', async () => {
    const records = Array.from({ length: 20 }, (_, i) => ({
      mathSkillId: `sk${i}`,
      masteryLevel: 'FAMILIAR',
      stability: 1,
      lastPracticeAt: daysAgo(30),
      mathSkill: {
        name: `Skill ${i}`,
        mainTopic: null,
        worksheetSkillMaps: [{ worksheetNumber: i }],
      },
    }));
    const prisma = mockPrisma(records);
    const recs = await computeRecommendations(prisma, 'st1', 5);
    expect(recs.length).toBe(5);
  });

  it('rounds retrievability, days, and priority for stable display values', async () => {
    const records = [
      {
        mathSkillId: 'sk1',
        masteryLevel: 'PROFICIENT',
        stability: 3,
        lastPracticeAt: daysAgo(20),
        mathSkill: {
          name: 'X',
          mainTopic: null,
          worksheetSkillMaps: [],
        },
      },
    ];
    const prisma = mockPrisma(records);
    const [rec] = await computeRecommendations(prisma, 'st1');
    expect(Number.isFinite(rec.retrievability)).toBe(true);
    expect(Number.isFinite(rec.priority)).toBe(true);
    expect(Number.isFinite(rec.daysSinceLastPractice)).toBe(true);
    // retrievability rounded to 3 decimals
    expect(rec.retrievability.toString().split('.')[1]?.length ?? 0).toBeLessThanOrEqual(3);
  });
});
