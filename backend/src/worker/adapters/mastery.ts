/**
 * Prisma-injectable copy of the recommendation half of `masteryService.ts`.
 *
 * The Express service reads Prisma from a module singleton AND imports
 * `os`-free Node modules indirectly, but the algorithm itself is pure — it
 * loads `studentSkillMastery` rows once, runs FSRS math over them in
 * memory, and sorts the result. That makes it trivial to lift into an
 * adapter so the Hono `/api/mastery/student/:id/recommendations` endpoint
 * (deferred in Phase 5.6) can finally ship.
 *
 * Kept 1:1 with the Express version so both paths produce identical
 * ordering during the parallel-run window. When the Express side is
 * decommissioned, this becomes the canonical copy.
 */

import { MasteryLevel } from '@prisma/client';
import type { PrismaClient } from '@prisma/client';

export interface Recommendation {
  mathSkillId: string;
  skillName: string;
  mainTopicName: string | null;
  masteryLevel: MasteryLevel;
  retrievability: number;
  daysSinceLastPractice: number;
  priority: number;
  worksheetNumbers: number[];
}

// ── FSRS constants (mirrors `services/masteryService.ts`) ────────────────

const FSRS_DECAY = -0.154;
const FSRS_FACTOR = 0.9 ** (1 / FSRS_DECAY) - 1; // ≈ 0.982

const LEVEL_WEIGHTS: Record<MasteryLevel, number> = {
  [MasteryLevel.NOT_STARTED]: 0,
  [MasteryLevel.ATTEMPTED]: 0.6,
  [MasteryLevel.FAMILIAR]: 0.8,
  [MasteryLevel.PROFICIENT]: 1.0,
  [MasteryLevel.MASTERED]: 1.2,
};

/**
 * Don't surface skills the student still has a strong grip on — the
 * threshold matches the Express version so recommendations align.
 */
const REVIEW_THRESHOLD = 0.85;

function computeRetrievability(daysSinceLastPractice: number, stability: number): number {
  if (daysSinceLastPractice <= 0) return 1.0;
  return Math.pow(1 + (FSRS_FACTOR * daysSinceLastPractice) / stability, FSRS_DECAY);
}

/**
 * Produces a priority-ranked review list for the given student. Returns an
 * empty array when the student has no practiced skills below threshold.
 */
export async function computeRecommendations(
  prisma: PrismaClient,
  studentId: string,
  limit = 10
): Promise<Recommendation[]> {
  const records = await prisma.studentSkillMastery.findMany({
    where: {
      studentId,
      lastPracticeAt: { not: null },
      masteryLevel: { not: MasteryLevel.NOT_STARTED },
    },
    include: {
      mathSkill: {
        include: {
          mainTopic: true,
          worksheetSkillMaps: { select: { worksheetNumber: true } },
        },
      },
    },
  });

  const now = new Date();
  const recs: Recommendation[] = [];

  for (const record of records) {
    if (!record.lastPracticeAt) continue;
    const daysSince = (now.getTime() - record.lastPracticeAt.getTime()) / (1000 * 60 * 60 * 24);
    const retrievability = computeRetrievability(daysSince, record.stability);
    if (retrievability >= REVIEW_THRESHOLD) continue;

    const weight = LEVEL_WEIGHTS[record.masteryLevel];
    const priority = (1 - retrievability) * weight;

    recs.push({
      mathSkillId: record.mathSkillId,
      skillName: record.mathSkill.name,
      mainTopicName: record.mathSkill.mainTopic?.name ?? null,
      masteryLevel: record.masteryLevel,
      retrievability: Math.round(retrievability * 1000) / 1000,
      daysSinceLastPractice: Math.round(daysSince * 10) / 10,
      priority: Math.round(priority * 1000) / 1000,
      worksheetNumbers: record.mathSkill.worksheetSkillMaps.map((m) => m.worksheetNumber),
    });
  }

  recs.sort((a, b) => b.priority - a.priority);
  return recs.slice(0, limit);
}
