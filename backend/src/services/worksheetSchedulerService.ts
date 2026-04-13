import { MasteryLevel } from '@prisma/client';
import prisma from '../utils/prisma';

interface DayPlan {
    scheduledDate: Date;
    newSkillId: string;
    reviewSkill1Id: string;
    reviewSkill2Id: string;
}

interface SchedulerResult {
    plans: DayPlan[];
    errors: string[];
}

const FSRS_DECAY = -0.154;
const FSRS_FACTOR = 0.9 ** (1 / FSRS_DECAY) - 1;

const LEVEL_WEIGHTS: Record<MasteryLevel, number> = {
    NOT_STARTED: 0,
    ATTEMPTED: 0.6,
    FAMILIAR: 0.8,
    PROFICIENT: 1.0,
    MASTERED: 1.2
};

function computeRetrievability(daysSince: number, stability: number): number {
    if (daysSince <= 0) return 1.0;
    return Math.pow(1 + FSRS_FACTOR * daysSince / stability, FSRS_DECAY);
}

export async function planWorksheets(
    studentId: string,
    days: number,
    startDate: Date
): Promise<SchedulerResult> {
    const errors: string[] = [];

    // 1. Get all curriculum skills in order (via WorksheetSkillMap)
    const allSkillMaps = await prisma.worksheetSkillMap.findMany({
        orderBy: { worksheetNumber: 'asc' },
        select: { worksheetNumber: true, mathSkillId: true }
    });

    if (allSkillMaps.length === 0) {
        return { plans: [], errors: ['No skills mapped in curriculum'] };
    }

    // 2. Find student's last practiced skill to determine curriculum position
    const lastPractice = await prisma.skillPracticeLog.findFirst({
        where: { studentId },
        orderBy: { practicedAt: 'desc' },
        select: { mathSkillId: true }
    });

    // Deduplicate curriculum skills (same skill may appear multiple times)
    const seen = new Set<string>();
    const curriculumSkills: string[] = [];
    for (const m of allSkillMaps) {
        if (!seen.has(m.mathSkillId)) {
            seen.add(m.mathSkillId);
            curriculumSkills.push(m.mathSkillId);
        }
    }

    // Find the index in curriculum of the last practiced skill
    let startIdx = 0;
    if (lastPractice) {
        const idx = curriculumSkills.indexOf(lastPractice.mathSkillId);
        if (idx >= 0) startIdx = idx + 1;
    }

    // 3. Load student's mastery state for review simulation
    const masteryRecords = await prisma.studentSkillMastery.findMany({
        where: { studentId, lastPracticeAt: { not: null } }
    });

    // Build simulated state (mutable copy)
    const simState = new Map<string, { lastPracticeAt: Date; stability: number; level: MasteryLevel }>();
    for (const r of masteryRecords) {
        if (r.lastPracticeAt) {
            simState.set(r.mathSkillId, {
                lastPracticeAt: r.lastPracticeAt,
                stability: r.stability,
                level: r.masteryLevel
            });
        }
    }

    // 4. Plan each day
    const plans: DayPlan[] = [];
    for (let d = 0; d < days; d++) {
        const scheduledDate = new Date(startDate);
        scheduledDate.setDate(scheduledDate.getDate() + d);

        // New skill: next in curriculum
        const newIdx = (startIdx + d) % curriculumSkills.length;
        const newSkillId = curriculumSkills[newIdx];

        // Review skills: top 2 by priority, excluding the new skill
        const now = scheduledDate;
        const candidates: { skillId: string; priority: number }[] = [];

        for (const [skillId, state] of simState) {
            if (skillId === newSkillId) continue;
            if (state.level === MasteryLevel.NOT_STARTED) continue;

            const daysSince = (now.getTime() - state.lastPracticeAt.getTime()) / (1000 * 60 * 60 * 24);
            const R = computeRetrievability(daysSince, state.stability);
            const priority = (1 - R) * LEVEL_WEIGHTS[state.level];
            candidates.push({ skillId, priority });
        }

        candidates.sort((a, b) => b.priority - a.priority);

        const review1 = candidates[0]?.skillId ?? curriculumSkills[Math.max(0, newIdx - 1)];
        const review2 = candidates[1]?.skillId ?? curriculumSkills[Math.max(0, newIdx - 2)];

        plans.push({ scheduledDate, newSkillId, reviewSkill1Id: review1, reviewSkill2Id: review2 });

        // Simulate refresh for picked skills
        const refreshDate = scheduledDate;
        for (const skillId of [newSkillId, review1, review2]) {
            const existing = simState.get(skillId);
            if (existing) {
                existing.lastPracticeAt = refreshDate;
            } else {
                simState.set(skillId, {
                    lastPracticeAt: refreshDate,
                    stability: 1.0,
                    level: MasteryLevel.ATTEMPTED
                });
            }
        }
    }

    return { plans, errors };
}
