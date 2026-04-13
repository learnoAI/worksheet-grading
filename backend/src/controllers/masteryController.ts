import { Request, Response } from 'express';
import { MasteryLevel } from '@prisma/client';
import prisma from '../utils/prisma';
import { computeRecommendations, backfillMasteryData } from '../services/masteryService';

/**
 * GET /api/mastery/student/:studentId
 * Returns all skill mastery records + summary counts per level.
 */
export async function getStudentMastery(req: Request, res: Response): Promise<Response> {
    const { studentId } = req.params;

    const records = await prisma.studentSkillMastery.findMany({
        where: { studentId },
        include: {
            mathSkill: {
                include: { mainTopic: true }
            }
        },
        orderBy: { updatedAt: 'desc' }
    });

    const summary: Record<MasteryLevel, number> = {
        [MasteryLevel.NOT_STARTED]: 0,
        [MasteryLevel.ATTEMPTED]: 0,
        [MasteryLevel.FAMILIAR]: 0,
        [MasteryLevel.PROFICIENT]: 0,
        [MasteryLevel.MASTERED]: 0
    };

    for (const r of records) {
        summary[r.masteryLevel]++;
    }

    return res.json({
        success: true,
        data: {
            studentId,
            summary,
            totalSkills: records.length,
            skills: records.map(r => ({
                mathSkillId: r.mathSkillId,
                skillName: r.mathSkill.name,
                mainTopicName: r.mathSkill.mainTopic?.name ?? null,
                masteryLevel: r.masteryLevel,
                lastScore: r.lastScore,
                lastPracticeAt: r.lastPracticeAt,
                practiceCount: r.practiceCount,
                testCount: r.testCount,
                stability: r.stability,
                difficulty: r.difficulty
            }))
        }
    });
}

/**
 * GET /api/mastery/student/:studentId/by-topic
 * Groups skills by MainTopic, computes average mastery score per topic.
 */
export async function getStudentMasteryByTopic(req: Request, res: Response): Promise<Response> {
    const { studentId } = req.params;

    const records = await prisma.studentSkillMastery.findMany({
        where: { studentId },
        include: {
            mathSkill: {
                include: { mainTopic: true }
            }
        }
    });

    const LEVEL_SCORES: Record<MasteryLevel, number> = {
        [MasteryLevel.NOT_STARTED]: 0,
        [MasteryLevel.ATTEMPTED]: 1,
        [MasteryLevel.FAMILIAR]: 2,
        [MasteryLevel.PROFICIENT]: 3,
        [MasteryLevel.MASTERED]: 4
    };

    const topicMap = new Map<string, {
        topicName: string;
        skills: typeof records;
        totalScore: number;
    }>();

    for (const r of records) {
        const topicId = r.mathSkill.mainTopicId ?? 'uncategorized';
        const topicName = r.mathSkill.mainTopic?.name ?? 'Uncategorized';

        if (!topicMap.has(topicId)) {
            topicMap.set(topicId, { topicName, skills: [], totalScore: 0 });
        }

        const entry = topicMap.get(topicId)!;
        entry.skills.push(r);
        entry.totalScore += LEVEL_SCORES[r.masteryLevel];
    }

    const topics = Array.from(topicMap.entries()).map(([topicId, data]) => ({
        topicId,
        topicName: data.topicName,
        skillCount: data.skills.length,
        averageMasteryScore: Math.round((data.totalScore / data.skills.length) * 100) / 100,
        skills: data.skills.map(r => ({
            mathSkillId: r.mathSkillId,
            skillName: r.mathSkill.name,
            masteryLevel: r.masteryLevel,
            lastScore: r.lastScore,
            practiceCount: r.practiceCount
        }))
    }));

    return res.json({
        success: true,
        data: { studentId, topics }
    });
}

/**
 * GET /api/mastery/student/:studentId/recommendations
 * Returns priority-ranked review list.
 */
export async function getStudentRecommendations(req: Request, res: Response): Promise<Response> {
    const { studentId } = req.params;
    const limit = parseInt(req.query.limit as string) || 10;

    const recommendations = await computeRecommendations(studentId, limit);

    return res.json({
        success: true,
        data: { studentId, recommendations }
    });
}

/**
 * GET /api/mastery/class/:classId
 * Matrix: students x skills with mastery levels.
 */
export async function getClassMasteryOverview(req: Request, res: Response): Promise<Response> {
    const { classId } = req.params;
    const mainTopicId = req.query.mainTopicId as string | undefined;
    const page = parseInt(req.query.page as string) || 1;
    const pageSize = parseInt(req.query.pageSize as string) || 20;

    // Get students in the class
    const studentClasses = await prisma.studentClass.findMany({
        where: { classId },
        include: { student: { select: { id: true, name: true, tokenNumber: true } } }
    });

    const studentIds = studentClasses.map(sc => sc.studentId);

    // Get relevant skills
    const skillWhere = mainTopicId ? { mainTopicId } : {};
    const skills = await prisma.mathSkill.findMany({
        where: {
            ...skillWhere,
            studentMastery: { some: { studentId: { in: studentIds } } }
        },
        include: { mainTopic: true },
        orderBy: { name: 'asc' }
    });

    // Paginate skills
    const totalSkills = skills.length;
    const paginatedSkills = skills.slice((page - 1) * pageSize, page * pageSize);
    const skillIds = paginatedSkills.map(s => s.id);

    // Get mastery records for these students x skills
    const masteryRecords = await prisma.studentSkillMastery.findMany({
        where: {
            studentId: { in: studentIds },
            mathSkillId: { in: skillIds }
        }
    });

    // Build matrix
    const masteryMap = new Map<string, MasteryLevel>();
    for (const r of masteryRecords) {
        masteryMap.set(`${r.studentId}:${r.mathSkillId}`, r.masteryLevel);
    }

    const students = studentClasses.map(sc => ({
        studentId: sc.student.id,
        studentName: sc.student.name,
        tokenNumber: sc.student.tokenNumber,
        skills: paginatedSkills.map(skill => ({
            mathSkillId: skill.id,
            masteryLevel: masteryMap.get(`${sc.student.id}:${skill.id}`) ?? MasteryLevel.NOT_STARTED
        }))
    }));

    return res.json({
        success: true,
        data: {
            classId,
            skills: paginatedSkills.map(s => ({
                id: s.id,
                name: s.name,
                mainTopicName: s.mainTopic?.name ?? null
            })),
            students,
            pagination: {
                page,
                pageSize,
                totalSkills,
                totalPages: Math.ceil(totalSkills / pageSize)
            }
        }
    });
}

/**
 * POST /api/mastery/backfill
 * Body: { studentIds?: string[], dryRun?: boolean }
 */
export async function backfillMastery(req: Request, res: Response): Promise<Response> {
    const { studentIds, dryRun } = req.body ?? {};

    const stats = await backfillMasteryData(studentIds, dryRun ?? false);

    return res.json({
        success: true,
        data: {
            dryRun: dryRun ?? false,
            ...stats
        }
    });
}
