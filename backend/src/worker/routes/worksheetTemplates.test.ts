import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import {
  worksheetTemplateReadRoutes,
  mathSkillReadRoutes,
  worksheetCurriculumReadRoutes,
} from './worksheetTemplates';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/worksheet-templates', worksheetTemplateReadRoutes);
  app.route('/api/math-skills', mathSkillReadRoutes);
  app.route('/api/worksheet-curriculum', worksheetCurriculumReadRoutes);
  return app;
}

async function tokenAs(role = 'TEACHER') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId: 'u-1', role, exp }, SECRET, 'HS256');
}

describe('GET /api/worksheet-templates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ worksheetTemplate: { findMany: vi.fn() } });
    const res = await app.request('/api/worksheet-templates', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns all templates with images and questions.skills included', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 't1' }]);
    const app = mountApp({ worksheetTemplate: { findMany } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/worksheet-templates',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith({
      include: {
        worksheetImages: true,
        questions: { include: { skills: true } },
      },
    });
  });
});

describe('GET /api/worksheet-templates/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const app = mountApp({
      worksheetTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const token = await tokenAs();
    const res = await app.request(
      '/api/worksheet-templates/missing',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
  });

  it('returns the template when found', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 't1' });
    const app = mountApp({ worksheetTemplate: { findUnique } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/worksheet-templates/t1',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 't1' } })
    );
  });
});

describe('GET /api/math-skills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns skills with mainTopic included', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'sk1' }]);
    const app = mountApp({ mathSkill: { findMany } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/math-skills',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith({ include: { mainTopic: true } });
  });
});

describe('GET /api/worksheet-curriculum', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for STUDENT role', async () => {
    const app = mountApp({ worksheetSkillMap: { findMany: vi.fn() } });
    const token = await tokenAs('STUDENT');
    const res = await app.request(
      '/api/worksheet-curriculum',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(403);
  });

  it('returns all mappings when no filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ worksheetSkillMap: { findMany } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/worksheet-curriculum',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: undefined })
    );
  });

  it('filters by comma-separated worksheetNumbers (deduped)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ worksheetSkillMap: { findMany } });
    const token = await tokenAs();
    await app.request(
      '/api/worksheet-curriculum?worksheetNumbers=1,2,2,3',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { worksheetNumber: { in: [1, 2, 3] } } })
    );
  });

  it('returns 400 when worksheetNumbers is non-empty but yields no valid integers', async () => {
    const app = mountApp({ worksheetSkillMap: { findMany: vi.fn() } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/worksheet-curriculum?worksheetNumbers=abc,-1,0',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
  });

  it('shapes response into { worksheetNumber, isTest, learningOutcome, mainTopic }', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        worksheetNumber: 1,
        isTest: false,
        mathSkill: {
          id: 'sk1',
          name: 'Fractions',
          mainTopic: { id: 'mt1', name: 'Math' },
        },
      },
    ]);
    const app = mountApp({ worksheetSkillMap: { findMany } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/worksheet-curriculum',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      {
        worksheetNumber: 1,
        isTest: false,
        learningOutcome: { id: 'sk1', name: 'Fractions' },
        mainTopic: { id: 'mt1', name: 'Math' },
      },
    ]);
  });

  it('returns mainTopic=null when the skill has no main topic', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        worksheetNumber: 5,
        isTest: true,
        mathSkill: { id: 'sk2', name: 'Algebra', mainTopic: null },
      },
    ]);
    const app = mountApp({ worksheetSkillMap: { findMany } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/worksheet-curriculum',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    const body = (await res.json()) as Array<{ mainTopic: unknown }>;
    expect(body[0].mainTopic).toBeNull();
  });
});
