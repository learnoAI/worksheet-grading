/**
 * Prisma-injectable port of `masteryService.ts` — covers both the
 * recommendation and update paths.
 *
 * `computeRecommendations` serves `GET /api/mastery/student/:id/recommendations`.
 *
 * `updateMasteryForWorksheet` is called by the grading-worker `/complete`
 * route after a worksheet is successfully persisted — it updates the
 * student's FSRS-tracked skill state using the day's grade. Kept 1:1 with
 * the Express implementation so both paths produce identical stability /
 * difficulty / mastery-level progressions during the parallel-run window.
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

// ── Update mastery after grading ──────────────────────────────────────────

export interface UpdateMasteryInput {
  worksheetId: string;
  studentId: string;
  worksheetNumber: number;
  grade: number;
  outOf: number;
  submittedOn: Date | string;
}

function computeNewLevel(
  current: MasteryLevel,
  score: number,
  isTest: boolean
): MasteryLevel {
  switch (current) {
    case MasteryLevel.NOT_STARTED:
      if (score >= 0.75) return MasteryLevel.PROFICIENT;
      if (score >= 0.5) return MasteryLevel.FAMILIAR;
      return MasteryLevel.ATTEMPTED;
    case MasteryLevel.ATTEMPTED:
      if (score >= 0.5) return MasteryLevel.FAMILIAR;
      return MasteryLevel.ATTEMPTED;
    case MasteryLevel.FAMILIAR:
      if (score >= 0.75) return MasteryLevel.PROFICIENT;
      if (score >= 0.5) return MasteryLevel.FAMILIAR;
      return MasteryLevel.ATTEMPTED;
    case MasteryLevel.PROFICIENT:
      if (score >= 0.85 && isTest) return MasteryLevel.MASTERED;
      if (score >= 0.5) return MasteryLevel.PROFICIENT;
      return MasteryLevel.FAMILIAR;
    case MasteryLevel.MASTERED:
      if (score >= 0.5) return MasteryLevel.MASTERED;
      if (score >= 0.3) return MasteryLevel.PROFICIENT;
      return MasteryLevel.FAMILIAR;
    default:
      return current;
  }
}

function scoreToGrade(score: number): number {
  if (score >= 0.9) return 3; // easy
  if (score >= 0.75) return 2; // good
  if (score >= 0.5) return 1; // hard
  return 0; // fail
}

function updateDifficulty(currentD: number, score: number): number {
  const grade = scoreToGrade(score);
  const newD = currentD + 0.1 * (8 - grade * 2 - currentD);
  return Math.max(1, Math.min(10, newD));
}

function updateStability(currentS: number, score: number, difficulty: number): number {
  if (score < 0.5) return Math.max(1, currentS * 0.2);
  const grade = scoreToGrade(score);
  const multipliers: Record<number, number> = { 1: 1.3, 2: 2.5, 3: 3.5 };
  const multiplier = multipliers[grade] ?? 1.3;
  const difficultyFactor = (11 - difficulty) / 10;
  return Math.min(currentS * multiplier * difficultyFactor, 90);
}

/**
 * Recompute a student's `StudentSkillMastery` row based on their grade
 * on a specific worksheet. Also appends a `SkillPracticeLog` entry. Both
 * writes happen in a single `$transaction`.
 *
 * No-ops silently when:
 *   - `worksheetNumber <= 0` or `outOf <= 0` (absent student, bad data)
 *   - The worksheet number is not mapped to a skill in
 *     `WorksheetSkillMap` (not all worksheets are mapped yet)
 *
 * Callers should invoke this *after* the worksheet row has been persisted
 * — the grading-worker `/complete` route does that before calling this.
 */
export async function updateMasteryForWorksheet(
  prisma: PrismaClient,
  input: UpdateMasteryInput
): Promise<void> {
  const { worksheetId, studentId, worksheetNumber, grade, outOf, submittedOn } = input;

  if (worksheetNumber <= 0 || outOf <= 0) return;

  const skillMap = await prisma.worksheetSkillMap.findUnique({
    where: { worksheetNumber },
  });
  if (!skillMap) return;

  const { mathSkillId, isTest } = skillMap;
  const score = Math.max(0, Math.min(1, grade / outOf));
  const practicedAt = new Date(submittedOn);

  const mastery = await prisma.studentSkillMastery.findUnique({
    where: { studentId_mathSkillId: { studentId, mathSkillId } },
  });

  const previousLevel = mastery?.masteryLevel ?? MasteryLevel.NOT_STARTED;
  const currentStability = mastery?.stability ?? 1.0;
  const currentDifficulty = mastery?.difficulty ?? 5.0;

  const newLevel = computeNewLevel(previousLevel, score, isTest);
  const newDifficulty = updateDifficulty(currentDifficulty, score);
  const newStability = updateStability(currentStability, score, newDifficulty);

  const practiceCount = (mastery?.practiceCount ?? 0) + 1;
  const testCount = (mastery?.testCount ?? 0) + (isTest ? 1 : 0);

  await prisma.$transaction([
    prisma.studentSkillMastery.upsert({
      where: { studentId_mathSkillId: { studentId, mathSkillId } },
      create: {
        studentId,
        mathSkillId,
        masteryLevel: newLevel,
        stability: newStability,
        difficulty: newDifficulty,
        lastPracticeAt: practicedAt,
        lastScore: score,
        practiceCount,
        testCount,
      },
      update: {
        masteryLevel: newLevel,
        stability: newStability,
        difficulty: newDifficulty,
        lastPracticeAt: practicedAt,
        lastScore: score,
        practiceCount,
        testCount,
      },
    }),
    prisma.skillPracticeLog.create({
      data: {
        studentId,
        mathSkillId,
        worksheetId,
        worksheetNumber,
        isTest,
        score,
        rawGrade: grade,
        rawOutOf: outOf,
        previousLevel,
        newLevel,
        stabilityAfter: newStability,
        difficultyAfter: newDifficulty,
        practicedAt,
      },
    }),
  ]);
}

// ── Backfill ──────────────────────────────────────────────────────────────

export interface BackfillStats {
  processed: number;
  skipped: number;
  created: number;
  errors: number;
}

interface InMemoryMastery {
  studentId: string;
  mathSkillId: string;
  masteryLevel: MasteryLevel;
  stability: number;
  difficulty: number;
  lastPracticeAt: Date;
  lastScore: number;
  practiceCount: number;
  testCount: number;
}

interface InMemoryLog {
  studentId: string;
  mathSkillId: string;
  worksheetId: string;
  worksheetNumber: number;
  isTest: boolean;
  score: number;
  rawGrade: number;
  rawOutOf: number;
  previousLevel: MasteryLevel;
  newLevel: MasteryLevel;
  stabilityAfter: number;
  difficultyAfter: number;
  practicedAt: Date;
}

/**
 * Recomputes `StudentSkillMastery` and `SkillPracticeLog` from scratch by
 * replaying every graded worksheet through the same FSRS state machine
 * `updateMasteryForWorksheet` uses. Mirrors the Express `backfillMasteryData`
 * 1:1 so output is byte-identical.
 *
 * Worker caveat: this loads all matching worksheets into memory at once.
 * On the 128 MB Worker isolate that's fine for staging-sized data and for
 * scoped backfills (a list of `studentIds`), but a full-table backfill on
 * production-scale data may hit the limit. If that ever happens, switch to a
 * batched/cursor-paginated load — the per-student state is independent so
 * we can shard by `studentId` easily.
 */
export async function backfillMasteryData(
  prisma: PrismaClient,
  studentIds?: string[],
  dryRun = false
): Promise<BackfillStats> {
  const stats: BackfillStats = { processed: 0, skipped: 0, created: 0, errors: 0 };

  const skillMaps = await prisma.worksheetSkillMap.findMany();
  const skillMapByNumber = new Map(skillMaps.map((m) => [m.worksheetNumber, m]));

  if (skillMapByNumber.size === 0) {
    return stats;
  }

  const worksheetWhere = {
    isAbsent: false,
    worksheetNumber: { gt: 0 },
    grade: { not: null },
    studentId: { not: null },
    ...(studentIds ? { studentId: { in: studentIds } } : {}),
  };

  const worksheets = await prisma.worksheet.findMany({
    where: worksheetWhere,
    orderBy: [{ studentId: 'asc' }, { submittedOn: 'asc' }],
    select: {
      id: true,
      studentId: true,
      worksheetNumber: true,
      grade: true,
      outOf: true,
      submittedOn: true,
    },
  });

  const masteryMap = new Map<string, InMemoryMastery>();
  const logs: InMemoryLog[] = [];

  for (const ws of worksheets) {
    if (!ws.studentId || ws.grade === null || !ws.submittedOn) {
      stats.skipped++;
      continue;
    }
    const skillMap = skillMapByNumber.get(ws.worksheetNumber);
    if (!skillMap) {
      stats.skipped++;
      continue;
    }
    stats.processed++;

    const { mathSkillId, isTest } = skillMap;
    const outOf = ws.outOf ?? 40;
    const score = Math.max(0, Math.min(1, ws.grade / outOf));
    const practicedAt = new Date(ws.submittedOn);
    const key = `${ws.studentId}:${mathSkillId}`;

    const existing = masteryMap.get(key);
    const previousLevel = existing?.masteryLevel ?? MasteryLevel.NOT_STARTED;
    const currentStability = existing?.stability ?? 1.0;
    const currentDifficulty = existing?.difficulty ?? 5.0;

    const newLevel = computeNewLevel(previousLevel, score, isTest);
    const newDifficulty = updateDifficulty(currentDifficulty, score);
    const newStability = updateStability(currentStability, score, newDifficulty);

    const practiceCount = (existing?.practiceCount ?? 0) + 1;
    const testCount = (existing?.testCount ?? 0) + (isTest ? 1 : 0);

    masteryMap.set(key, {
      studentId: ws.studentId,
      mathSkillId,
      masteryLevel: newLevel,
      stability: newStability,
      difficulty: newDifficulty,
      lastPracticeAt: practicedAt,
      lastScore: score,
      practiceCount,
      testCount,
    });

    logs.push({
      studentId: ws.studentId,
      mathSkillId,
      worksheetId: ws.id,
      worksheetNumber: ws.worksheetNumber,
      isTest,
      score,
      rawGrade: ws.grade,
      rawOutOf: outOf,
      previousLevel,
      newLevel,
      stabilityAfter: newStability,
      difficultyAfter: newDifficulty,
      practicedAt,
    });

    stats.created++;
  }

  if (dryRun) return stats;

  const scopeWhere = studentIds ? { studentId: { in: studentIds } } : {};
  await prisma.skillPracticeLog.deleteMany({ where: scopeWhere });
  await prisma.studentSkillMastery.deleteMany({ where: scopeWhere });

  const masteryRows = Array.from(masteryMap.values());
  const MASTERY_BATCH = 500;
  for (let i = 0; i < masteryRows.length; i += MASTERY_BATCH) {
    await prisma.studentSkillMastery.createMany({
      data: masteryRows.slice(i, i + MASTERY_BATCH).map((r) => ({
        studentId: r.studentId,
        mathSkillId: r.mathSkillId,
        masteryLevel: r.masteryLevel,
        stability: r.stability,
        difficulty: r.difficulty,
        lastPracticeAt: r.lastPracticeAt,
        lastScore: r.lastScore,
        practiceCount: r.practiceCount,
        testCount: r.testCount,
      })),
    });
  }

  const LOG_BATCH = 1000;
  for (let i = 0; i < logs.length; i += LOG_BATCH) {
    await prisma.skillPracticeLog.createMany({
      data: logs.slice(i, i + LOG_BATCH).map((l) => ({
        studentId: l.studentId,
        mathSkillId: l.mathSkillId,
        worksheetId: l.worksheetId,
        worksheetNumber: l.worksheetNumber,
        isTest: l.isTest,
        score: l.score,
        rawGrade: l.rawGrade,
        rawOutOf: l.rawOutOf,
        previousLevel: l.previousLevel,
        newLevel: l.newLevel,
        stabilityAfter: l.stabilityAfter,
        difficultyAfter: l.difficultyAfter,
        practicedAt: l.practicedAt,
      })),
    });
  }

  return stats;
}
