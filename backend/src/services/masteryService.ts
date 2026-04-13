import { MasteryLevel, Prisma } from '@prisma/client';
import prisma from '../utils/prisma';

// ── Types ──────────────────────────────────────────────────────────────────

export interface UpdateMasteryInput {
    worksheetId: string;
    studentId: string;
    worksheetNumber: number;
    grade: number;
    outOf: number;
    submittedOn: Date | string;
}

interface Recommendation {
    mathSkillId: string;
    skillName: string;
    mainTopicName: string | null;
    masteryLevel: MasteryLevel;
    retrievability: number;
    daysSinceLastPractice: number;
    priority: number;
    worksheetNumbers: number[];
}

interface BackfillStats {
    processed: number;
    skipped: number;
    created: number;
    errors: number;
}

// ── FSRS Constants ─────────────────────────────────────────────────────────

const FSRS_DECAY = -0.154;
const FSRS_FACTOR = 0.9 ** (1 / FSRS_DECAY) - 1; // ≈ 0.982

// ── Mastery Level Transitions ──────────────────────────────────────────────

function computeNewLevel(
    current: MasteryLevel,
    score: number,
    isTest: boolean
): MasteryLevel {
    switch (current) {
        case MasteryLevel.NOT_STARTED:
            if (score >= 0.75) return MasteryLevel.PROFICIENT;
            if (score >= 0.50) return MasteryLevel.FAMILIAR;
            return MasteryLevel.ATTEMPTED;

        case MasteryLevel.ATTEMPTED:
            if (score >= 0.50) return MasteryLevel.FAMILIAR;
            return MasteryLevel.ATTEMPTED;

        case MasteryLevel.FAMILIAR:
            if (score >= 0.75) return MasteryLevel.PROFICIENT;
            if (score >= 0.50) return MasteryLevel.FAMILIAR;
            return MasteryLevel.ATTEMPTED;

        case MasteryLevel.PROFICIENT:
            if (score >= 0.85 && isTest) return MasteryLevel.MASTERED;
            if (score >= 0.50) return MasteryLevel.PROFICIENT;
            return MasteryLevel.FAMILIAR;

        case MasteryLevel.MASTERED:
            if (score >= 0.50) return MasteryLevel.MASTERED;
            if (score >= 0.30) return MasteryLevel.PROFICIENT;
            return MasteryLevel.FAMILIAR;

        default:
            return current;
    }
}

// ── FSRS Parameter Updates ─────────────────────────────────────────────────

function scoreToGrade(score: number): number {
    if (score >= 0.90) return 3; // easy
    if (score >= 0.75) return 2; // good
    if (score >= 0.50) return 1; // hard
    return 0; // fail
}

function updateDifficulty(currentD: number, score: number): number {
    const grade = scoreToGrade(score);
    const newD = currentD + 0.1 * (8 - grade * 2 - currentD);
    return Math.max(1, Math.min(10, newD));
}

function updateStability(currentS: number, score: number, difficulty: number): number {
    if (score < 0.50) {
        // Fail: stability drops sharply
        return Math.max(1, currentS * 0.2);
    }

    const grade = scoreToGrade(score);
    const multipliers: Record<number, number> = { 1: 1.3, 2: 2.5, 3: 3.5 };
    const multiplier = multipliers[grade] ?? 1.3;
    const difficultyFactor = (11 - difficulty) / 10;

    return Math.min(currentS * multiplier * difficultyFactor, 90);
}

// ── Retrievability ─────────────────────────────────────────────────────────

function computeRetrievability(daysSinceLastPractice: number, stability: number): number {
    if (daysSinceLastPractice <= 0) return 1.0;
    return Math.pow(1 + FSRS_FACTOR * daysSinceLastPractice / stability, FSRS_DECAY);
}

// ── Core: Update Mastery After Grading ─────────────────────────────────────

export async function updateMasteryForWorksheet(input: UpdateMasteryInput): Promise<void> {
    const { worksheetId, studentId, worksheetNumber, grade, outOf, submittedOn } = input;

    if (worksheetNumber <= 0 || outOf <= 0) return;

    // Look up skill mapping
    const skillMap = await prisma.worksheetSkillMap.findUnique({
        where: { worksheetNumber }
    });

    if (!skillMap) return; // Not all worksheets are mapped

    const { mathSkillId, isTest } = skillMap;
    const score = Math.max(0, Math.min(1, grade / outOf));
    const practicedAt = new Date(submittedOn);

    // Get or create mastery record
    let mastery = await prisma.studentSkillMastery.findUnique({
        where: { studentId_mathSkillId: { studentId, mathSkillId } }
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
                testCount
            },
            update: {
                masteryLevel: newLevel,
                stability: newStability,
                difficulty: newDifficulty,
                lastPracticeAt: practicedAt,
                lastScore: score,
                practiceCount,
                testCount
            }
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
                practicedAt
            }
        })
    ]);
}

// ── Recommendations ────────────────────────────────────────────────────────

const LEVEL_WEIGHTS: Record<MasteryLevel, number> = {
    [MasteryLevel.NOT_STARTED]: 0,
    [MasteryLevel.ATTEMPTED]: 0.6,
    [MasteryLevel.FAMILIAR]: 0.8,
    [MasteryLevel.PROFICIENT]: 1.0,
    [MasteryLevel.MASTERED]: 1.2
};

const REVIEW_THRESHOLD = 0.85;

export async function computeRecommendations(
    studentId: string,
    limit: number = 10
): Promise<Recommendation[]> {
    const masteryRecords = await prisma.studentSkillMastery.findMany({
        where: {
            studentId,
            lastPracticeAt: { not: null },
            masteryLevel: { not: MasteryLevel.NOT_STARTED }
        },
        include: {
            mathSkill: {
                include: {
                    mainTopic: true,
                    worksheetSkillMaps: {
                        select: { worksheetNumber: true }
                    }
                }
            }
        }
    });

    const now = new Date();
    const recommendations: Recommendation[] = [];

    for (const record of masteryRecords) {
        if (!record.lastPracticeAt) continue;

        const daysSince = (now.getTime() - record.lastPracticeAt.getTime()) / (1000 * 60 * 60 * 24);
        const retrievability = computeRetrievability(daysSince, record.stability);

        if (retrievability >= REVIEW_THRESHOLD) continue;

        const weight = LEVEL_WEIGHTS[record.masteryLevel];
        const priority = (1 - retrievability) * weight;

        recommendations.push({
            mathSkillId: record.mathSkillId,
            skillName: record.mathSkill.name,
            mainTopicName: record.mathSkill.mainTopic?.name ?? null,
            masteryLevel: record.masteryLevel,
            retrievability: Math.round(retrievability * 1000) / 1000,
            daysSinceLastPractice: Math.round(daysSince * 10) / 10,
            priority: Math.round(priority * 1000) / 1000,
            worksheetNumbers: record.mathSkill.worksheetSkillMaps.map(m => m.worksheetNumber)
        });
    }

    recommendations.sort((a, b) => b.priority - a.priority);
    return recommendations.slice(0, limit);
}

// ── Backfill ───────────────────────────────────────────────────────────────

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

export async function backfillMasteryData(
    studentIds?: string[],
    dryRun: boolean = false
): Promise<BackfillStats> {
    const stats: BackfillStats = { processed: 0, skipped: 0, created: 0, errors: 0 };

    // Pre-load all skill mappings
    const skillMaps = await prisma.worksheetSkillMap.findMany();
    const skillMapByNumber = new Map(skillMaps.map(m => [m.worksheetNumber, m]));

    if (skillMapByNumber.size === 0) {
        return stats;
    }

    // Query all graded worksheets in chronological order
    const worksheetWhere: Prisma.WorksheetWhereInput = {
        isAbsent: false,
        worksheetNumber: { gt: 0 },
        grade: { not: null },
        studentId: { not: null },
        ...(studentIds ? { studentId: { in: studentIds } } : {})
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
            submittedOn: true
        }
    });

    console.log(`[mastery] backfill: ${worksheets.length} worksheets loaded, computing in-memory...`);

    // Compute all mastery state in-memory
    const masteryMap = new Map<string, InMemoryMastery>(); // key: studentId:mathSkillId
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
            testCount
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
            practicedAt
        });

        stats.created++;
    }

    console.log(`[mastery] backfill: ${masteryMap.size} mastery records, ${logs.length} log entries computed`);

    if (dryRun) {
        return stats;
    }

    // Delete existing data
    const deleteWhere: Prisma.SkillPracticeLogWhereInput = studentIds
        ? { studentId: { in: studentIds } }
        : {};
    await prisma.skillPracticeLog.deleteMany({ where: deleteWhere });

    const masteryDeleteWhere: Prisma.StudentSkillMasteryWhereInput = studentIds
        ? { studentId: { in: studentIds } }
        : {};
    await prisma.studentSkillMastery.deleteMany({ where: masteryDeleteWhere });

    console.log('[mastery] backfill: existing data deleted, inserting mastery records...');

    // Batch insert mastery records
    const masteryRows = Array.from(masteryMap.values());
    const MASTERY_BATCH = 500;
    for (let i = 0; i < masteryRows.length; i += MASTERY_BATCH) {
        const batch = masteryRows.slice(i, i + MASTERY_BATCH);
        await prisma.studentSkillMastery.createMany({
            data: batch.map(r => ({
                studentId: r.studentId,
                mathSkillId: r.mathSkillId,
                masteryLevel: r.masteryLevel,
                stability: r.stability,
                difficulty: r.difficulty,
                lastPracticeAt: r.lastPracticeAt,
                lastScore: r.lastScore,
                practiceCount: r.practiceCount,
                testCount: r.testCount
            }))
        });
        if ((i / MASTERY_BATCH) % 20 === 0) {
            console.log(`[mastery] backfill: mastery ${Math.min(i + MASTERY_BATCH, masteryRows.length)}/${masteryRows.length}`);
        }
    }

    console.log('[mastery] backfill: mastery records done, inserting practice logs...');

    // Batch insert practice logs
    const LOG_BATCH = 1000;
    for (let i = 0; i < logs.length; i += LOG_BATCH) {
        const batch = logs.slice(i, i + LOG_BATCH);
        await prisma.skillPracticeLog.createMany({
            data: batch.map(l => ({
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
                practicedAt: l.practicedAt
            }))
        });
        if ((i / LOG_BATCH) % 20 === 0) {
            console.log(`[mastery] backfill: logs ${Math.min(i + LOG_BATCH, logs.length)}/${logs.length}`);
        }
    }

    console.log('[mastery] backfill: complete');
    return stats;
}
