import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import mastery from './mastery';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/mastery', mastery);
  return app;
}

async function tokenAs(role = 'TEACHER') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId: 'u-1', role, exp }, SECRET, 'HS256');
}

async function authed(app: Hono<AppBindings>, path: string, role = 'TEACHER') {
  const token = await tokenAs(role);
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET: SECRET });
}

describe('GET /api/mastery/student/:studentId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ studentSkillMastery: { findMany: vi.fn() } });
    const res = await app.request('/api/mastery/student/s1', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns 403 for STUDENT role', async () => {
    const app = mountApp({ studentSkillMastery: { findMany: vi.fn() } });
    const res = await authed(app, '/api/mastery/student/s1', 'STUDENT');
    expect(res.status).toBe(403);
  });

  it('summarizes records by mastery level and shapes each skill', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        mathSkillId: 'sk1',
        masteryLevel: 'MASTERED',
        lastScore: 95,
        lastPracticeAt: new Date('2026-04-01T00:00:00Z'),
        practiceCount: 5,
        testCount: 1,
        stability: 0.9,
        difficulty: 0.2,
        mathSkill: { name: 'Fractions', mainTopic: { name: 'Numbers' } },
      },
      {
        mathSkillId: 'sk2',
        masteryLevel: 'ATTEMPTED',
        lastScore: 40,
        lastPracticeAt: null,
        practiceCount: 1,
        testCount: 0,
        stability: 0,
        difficulty: 0.5,
        mathSkill: { name: 'Algebra', mainTopic: null },
      },
    ]);
    const app = mountApp({ studentSkillMastery: { findMany } });
    const res = await authed(app, '/api/mastery/student/s1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        summary: Record<string, number>;
        totalSkills: number;
        skills: Array<{ mathSkillId: string; mainTopicName: string | null }>;
      };
    };
    expect(body.data.totalSkills).toBe(2);
    expect(body.data.summary.MASTERED).toBe(1);
    expect(body.data.summary.ATTEMPTED).toBe(1);
    expect(body.data.summary.NOT_STARTED).toBe(0);
    expect(body.data.skills[1].mainTopicName).toBeNull();
  });
});

describe('GET /api/mastery/student/:studentId/by-topic', () => {
  beforeEach(() => vi.clearAllMocks());

  it('groups skills by main topic and computes average level score', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        mathSkillId: 'sk1',
        masteryLevel: 'MASTERED', // score 4
        lastScore: 95,
        practiceCount: 5,
        mathSkill: {
          name: 'Fractions',
          mainTopicId: 'mt1',
          mainTopic: { name: 'Numbers' },
        },
      },
      {
        mathSkillId: 'sk2',
        masteryLevel: 'ATTEMPTED', // score 1
        lastScore: 40,
        practiceCount: 1,
        mathSkill: {
          name: 'Decimals',
          mainTopicId: 'mt1',
          mainTopic: { name: 'Numbers' },
        },
      },
      {
        mathSkillId: 'sk3',
        masteryLevel: 'FAMILIAR', // score 2
        lastScore: 70,
        practiceCount: 2,
        mathSkill: {
          name: 'Orphan',
          mainTopicId: null,
          mainTopic: null,
        },
      },
    ]);
    const app = mountApp({ studentSkillMastery: { findMany } });
    const res = await authed(app, '/api/mastery/student/s1/by-topic');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { topics: Array<{ topicId: string; topicName: string; skillCount: number; averageMasteryScore: number }> };
    };
    const numbers = body.data.topics.find((t) => t.topicId === 'mt1')!;
    expect(numbers.topicName).toBe('Numbers');
    expect(numbers.skillCount).toBe(2);
    expect(numbers.averageMasteryScore).toBe(2.5);

    const uncategorized = body.data.topics.find((t) => t.topicId === 'uncategorized')!;
    expect(uncategorized.topicName).toBe('Uncategorized');
  });
});

describe('GET /api/mastery/class/:classId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns a student × skill mastery matrix with default NOT_STARTED when missing', async () => {
    const studentClassFindMany = vi.fn().mockResolvedValue([
      { studentId: 'st1', student: { id: 'st1', name: 'Alice', tokenNumber: 'A1' } },
      { studentId: 'st2', student: { id: 'st2', name: 'Bob', tokenNumber: 'B1' } },
    ]);
    const mathSkillFindMany = vi.fn().mockResolvedValue([
      { id: 'sk1', name: 'Fractions', mainTopic: { name: 'Numbers' } },
      { id: 'sk2', name: 'Algebra', mainTopic: null },
    ]);
    const masteryFindMany = vi.fn().mockResolvedValue([
      { studentId: 'st1', mathSkillId: 'sk1', masteryLevel: 'MASTERED' },
    ]);
    const app = mountApp({
      studentClass: { findMany: studentClassFindMany },
      mathSkill: { findMany: mathSkillFindMany },
      studentSkillMastery: { findMany: masteryFindMany },
    });

    const res = await authed(app, '/api/mastery/class/c1');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: {
        students: Array<{ studentId: string; skills: Array<{ mathSkillId: string; masteryLevel: string }> }>;
        skills: Array<{ id: string }>;
        pagination: { totalSkills: number; totalPages: number };
      };
    };
    expect(body.data.students.length).toBe(2);
    const alice = body.data.students.find((s) => s.studentId === 'st1')!;
    expect(alice.skills.find((s) => s.mathSkillId === 'sk1')!.masteryLevel).toBe('MASTERED');
    expect(alice.skills.find((s) => s.mathSkillId === 'sk2')!.masteryLevel).toBe('NOT_STARTED');
    const bob = body.data.students.find((s) => s.studentId === 'st2')!;
    expect(bob.skills.every((s) => s.masteryLevel === 'NOT_STARTED')).toBe(true);
    expect(body.data.pagination.totalSkills).toBe(2);
    expect(body.data.pagination.totalPages).toBe(1);
  });

  it('honors pagination and mainTopicId filter', async () => {
    const studentClassFindMany = vi.fn().mockResolvedValue([]);
    const mathSkillFindMany = vi.fn().mockResolvedValue([]);
    const masteryFindMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({
      studentClass: { findMany: studentClassFindMany },
      mathSkill: { findMany: mathSkillFindMany },
      studentSkillMastery: { findMany: masteryFindMany },
    });

    const res = await authed(
      app,
      '/api/mastery/class/c1?mainTopicId=mt1&page=2&pageSize=5'
    );
    expect(res.status).toBe(200);
    expect(mathSkillFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ mainTopicId: 'mt1' }),
      })
    );
  });
});

describe('GET /api/mastery/student/:studentId/recommendations', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns an empty list when the student has no eligible skills', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ studentSkillMastery: { findMany } });
    const res = await authed(app, '/api/mastery/student/st1/recommendations');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { studentId: 'st1', recommendations: [] },
    });
  });

  it('returns ranked recommendations from the adapter', async () => {
    const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);
    const findMany = vi.fn().mockResolvedValue([
      {
        mathSkillId: 'sk1',
        masteryLevel: 'FAMILIAR',
        stability: 1,
        lastPracticeAt: daysAgo(30),
        mathSkill: {
          name: 'Fractions',
          mainTopic: { name: 'Numbers' },
          worksheetSkillMaps: [{ worksheetNumber: 3 }],
        },
      },
    ]);
    const app = mountApp({ studentSkillMastery: { findMany } });
    const res = await authed(app, '/api/mastery/student/st1/recommendations?limit=5');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { recommendations: Array<{ mathSkillId: string; worksheetNumbers: number[] }> };
    };
    expect(body.data.recommendations.length).toBe(1);
    expect(body.data.recommendations[0]).toMatchObject({
      mathSkillId: 'sk1',
      worksheetNumbers: [3],
    });
  });

  it('returns 403 for STUDENT role', async () => {
    const app = mountApp({ studentSkillMastery: { findMany: vi.fn() } });
    const res = await authed(app, '/api/mastery/student/st1/recommendations', 'STUDENT');
    expect(res.status).toBe(403);
  });
});
