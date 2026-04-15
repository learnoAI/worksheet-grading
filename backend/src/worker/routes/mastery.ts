import { Hono } from 'hono';
import { MasteryLevel, UserRole } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { computeRecommendations } from '../adapters/mastery';
import type { AppBindings } from '../types';

/**
 * Mastery routes — port of `backend/src/routes/masteryRoutes.ts` (read-only).
 *
 * Mounted under `/api/mastery`. Covers:
 *   GET /student/:studentId                  — full skill mastery list
 *   GET /student/:studentId/by-topic         — rolled up by main topic
 *   GET /student/:studentId/recommendations  — FSRS-ranked review list
 *   GET /class/:classId                      — student × skill matrix
 *
 * `POST /backfill` (SUPERADMIN) is still on the Express side — it's a
 * one-shot admin job that doesn't need to move to the worker.
 */
const mastery = new Hono<AppBindings>();

mastery.use('*', authenticate);
mastery.use('*', authorize([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]));

const LEVEL_SCORES: Record<MasteryLevel, number> = {
  [MasteryLevel.NOT_STARTED]: 0,
  [MasteryLevel.ATTEMPTED]: 1,
  [MasteryLevel.FAMILIAR]: 2,
  [MasteryLevel.PROFICIENT]: 3,
  [MasteryLevel.MASTERED]: 4,
};

mastery.get('/student/:studentId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const studentId = c.req.param('studentId');

  const records = await prisma.studentSkillMastery.findMany({
    where: { studentId },
    include: { mathSkill: { include: { mainTopic: true } } },
    orderBy: { updatedAt: 'desc' },
  });

  const summary: Record<MasteryLevel, number> = {
    [MasteryLevel.NOT_STARTED]: 0,
    [MasteryLevel.ATTEMPTED]: 0,
    [MasteryLevel.FAMILIAR]: 0,
    [MasteryLevel.PROFICIENT]: 0,
    [MasteryLevel.MASTERED]: 0,
  };
  for (const r of records) summary[r.masteryLevel]++;

  return c.json(
    {
      success: true,
      data: {
        studentId,
        summary,
        totalSkills: records.length,
        skills: records.map((r) => ({
          mathSkillId: r.mathSkillId,
          skillName: r.mathSkill.name,
          mainTopicName: r.mathSkill.mainTopic?.name ?? null,
          masteryLevel: r.masteryLevel,
          lastScore: r.lastScore,
          lastPracticeAt: r.lastPracticeAt,
          practiceCount: r.practiceCount,
          testCount: r.testCount,
          stability: r.stability,
          difficulty: r.difficulty,
        })),
      },
    },
    200
  );
});

mastery.get('/student/:studentId/recommendations', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const studentId = c.req.param('studentId');
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '', 10);
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 10;

  const recommendations = await computeRecommendations(prisma, studentId, limit);
  return c.json({ success: true, data: { studentId, recommendations } }, 200);
});

mastery.get('/student/:studentId/by-topic', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const studentId = c.req.param('studentId');

  const records = await prisma.studentSkillMastery.findMany({
    where: { studentId },
    include: { mathSkill: { include: { mainTopic: true } } },
  });

  type Record = (typeof records)[number];
  const topicMap = new Map<
    string,
    { topicName: string; skills: Record[]; totalScore: number }
  >();

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
    averageMasteryScore:
      Math.round((data.totalScore / data.skills.length) * 100) / 100,
    skills: data.skills.map((r) => ({
      mathSkillId: r.mathSkillId,
      skillName: r.mathSkill.name,
      masteryLevel: r.masteryLevel,
      lastScore: r.lastScore,
      practiceCount: r.practiceCount,
    })),
  }));

  return c.json({ success: true, data: { studentId, topics } }, 200);
});

mastery.get('/class/:classId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('classId');
  const mainTopicId = c.req.query('mainTopicId');
  const page = Math.max(1, Number.parseInt(c.req.query('page') ?? '', 10) || 1);
  const pageSize = Math.max(1, Number.parseInt(c.req.query('pageSize') ?? '', 10) || 20);

  const studentClasses = await prisma.studentClass.findMany({
    where: { classId },
    include: {
      student: { select: { id: true, name: true, tokenNumber: true } },
    },
  });
  const studentIds = studentClasses.map((sc) => sc.studentId);

  const skillWhere = mainTopicId ? { mainTopicId } : {};
  const skills = await prisma.mathSkill.findMany({
    where: {
      ...skillWhere,
      studentMastery: { some: { studentId: { in: studentIds } } },
    },
    include: { mainTopic: true },
    orderBy: { name: 'asc' },
  });

  const totalSkills = skills.length;
  const paginatedSkills = skills.slice((page - 1) * pageSize, page * pageSize);
  const skillIds = paginatedSkills.map((s) => s.id);

  const masteryRecords = await prisma.studentSkillMastery.findMany({
    where: {
      studentId: { in: studentIds },
      mathSkillId: { in: skillIds },
    },
  });

  const masteryMap = new Map<string, MasteryLevel>();
  for (const r of masteryRecords) {
    masteryMap.set(`${r.studentId}:${r.mathSkillId}`, r.masteryLevel);
  }

  const students = studentClasses.map((sc) => ({
    studentId: sc.student.id,
    studentName: sc.student.name,
    tokenNumber: sc.student.tokenNumber,
    skills: paginatedSkills.map((skill) => ({
      mathSkillId: skill.id,
      masteryLevel:
        masteryMap.get(`${sc.student.id}:${skill.id}`) ?? MasteryLevel.NOT_STARTED,
    })),
  }));

  return c.json(
    {
      success: true,
      data: {
        classId,
        skills: paginatedSkills.map((s) => ({
          id: s.id,
          name: s.name,
          mainTopicName: s.mainTopic?.name ?? null,
        })),
        students,
        pagination: {
          page,
          pageSize,
          totalSkills,
          totalPages: Math.ceil(totalSkills / pageSize),
        },
      },
    },
    200
  );
});

export default mastery;
