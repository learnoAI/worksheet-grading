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

// ---------- Mutation tests ----------

async function postJson(
  app: Hono<AppBindings>,
  path: string,
  body: unknown,
  token: string
) {
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { JWT_SECRET: SECRET }
  );
}

async function putJson(
  app: Hono<AppBindings>,
  path: string,
  body: unknown,
  token: string
) {
  return app.request(
    path,
    {
      method: 'PUT',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { JWT_SECRET: SECRET }
  );
}

describe('POST /api/worksheet-templates', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for TEACHER', async () => {
    const app = mountApp({ worksheetTemplate: { findUnique: vi.fn(), create: vi.fn() } });
    const token = await tokenAs('TEACHER');
    const res = await postJson(app, '/api/worksheet-templates', {}, token);
    expect(res.status).toBe(403);
  });

  it('creates without worksheetNumber', async () => {
    const create = vi.fn().mockResolvedValue({ id: 't-new' });
    const app = mountApp({ worksheetTemplate: { findUnique: vi.fn(), create } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/worksheet-templates', {}, token);
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ data: {} });
  });

  it('returns 400 when worksheetNumber already exists', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'existing' });
    const create = vi.fn();
    const app = mountApp({ worksheetTemplate: { findUnique, create } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/worksheet-templates', { worksheetNumber: 5 }, token);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates with worksheetNumber when unique', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: 't-new', worksheetNumber: 5 });
    const app = mountApp({ worksheetTemplate: { findUnique, create } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/worksheet-templates', { worksheetNumber: 5 }, token);
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ data: { worksheetNumber: 5 } });
  });
});

describe('PUT /api/worksheet-templates/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when template not found', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const app = mountApp({ worksheetTemplate: { findUnique, update: vi.fn() } });
    const token = await tokenAs('SUPERADMIN');
    const res = await putJson(app, '/api/worksheet-templates/missing', { worksheetNumber: 5 }, token);
    expect(res.status).toBe(404);
  });

  it('rejects when new worksheetNumber conflicts with another template', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 't1', worksheetNumber: 1 })
      .mockResolvedValueOnce({ id: 't2', worksheetNumber: 5 });
    const update = vi.fn();
    const app = mountApp({ worksheetTemplate: { findUnique, update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await putJson(app, '/api/worksheet-templates/t1', { worksheetNumber: 5 }, token);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('updates worksheetNumber when unique', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 't1', worksheetNumber: 1 })
      .mockResolvedValueOnce(null);
    const update = vi.fn().mockResolvedValue({ id: 't1', worksheetNumber: 5 });
    const app = mountApp({ worksheetTemplate: { findUnique, update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await putJson(app, '/api/worksheet-templates/t1', { worksheetNumber: 5 }, token);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({ where: { id: 't1' }, data: { worksheetNumber: 5 } });
  });
});

describe('DELETE /api/worksheet-templates/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes images then template', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 't1' });
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const del = vi.fn().mockResolvedValue({});
    const app = mountApp({
      worksheetTemplate: { findUnique, delete: del },
      worksheetTemplateImage: { deleteMany },
    });
    const token = await tokenAs('SUPERADMIN');
    const res = await app.request(
      '/api/worksheet-templates/t1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(deleteMany).toHaveBeenCalledWith({ where: { worksheetTemplateId: 't1' } });
    expect(del).toHaveBeenCalledWith({ where: { id: 't1' } });
  });
});

describe('POST /api/worksheet-templates/:id/images', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when template missing', async () => {
    const app = mountApp({
      worksheetTemplate: { findUnique: vi.fn().mockResolvedValue(null) },
      worksheetTemplateImage: { create: vi.fn() },
    });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/worksheet-templates/missing/images',
      { imageUrl: 'http://x', pageNumber: 1 },
      token
    );
    expect(res.status).toBe(404);
  });

  it('rejects body without imageUrl', async () => {
    const app = mountApp({});
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/worksheet-templates/t1/images',
      { pageNumber: 1 },
      token
    );
    expect(res.status).toBe(400);
  });

  it('creates the image with numeric pageNumber', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'i1' });
    const app = mountApp({
      worksheetTemplate: { findUnique: vi.fn().mockResolvedValue({ id: 't1' }) },
      worksheetTemplateImage: { create },
    });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/worksheet-templates/t1/images',
      { imageUrl: 'http://x.png', pageNumber: '3' },
      token
    );
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      data: { imageUrl: 'http://x.png', pageNumber: 3, worksheetTemplateId: 't1' },
    });
  });
});

describe('DELETE /api/worksheet-templates/images/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const app = mountApp({
      worksheetTemplateImage: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn() },
    });
    const token = await tokenAs('SUPERADMIN');
    const res = await app.request(
      '/api/worksheet-templates/images/i1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
  });

  it('deletes', async () => {
    const del = vi.fn().mockResolvedValue({});
    const app = mountApp({
      worksheetTemplateImage: {
        findUnique: vi.fn().mockResolvedValue({ id: 'i1' }),
        delete: del,
      },
    });
    const token = await tokenAs('SUPERADMIN');
    const res = await app.request(
      '/api/worksheet-templates/images/i1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: 'i1' } });
  });
});

describe('Template question routes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('POST /api/worksheet-templates/:id/questions creates with skills + connect', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'q1' });
    const app = mountApp({
      worksheetTemplate: { findUnique: vi.fn().mockResolvedValue({ id: 't1' }) },
      worksheetTemplateQuestion: { create },
    });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/worksheet-templates/t1/questions',
      {
        question: '2+2?',
        answer: '4',
        outOf: 2,
        skillIds: ['sk1', 'sk2'],
      },
      token
    );
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          question: '2+2?',
          answer: '4',
          outOf: 2,
          worksheetTemplateId: 't1',
          worksheetTemplates: { connect: { id: 't1' } },
          skills: { connect: [{ id: 'sk1' }, { id: 'sk2' }] },
        }),
      })
    );
  });

  it('PUT /api/worksheet-templates/questions/:id updates with skills.set', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'q1', skills: [] });
    const update = vi.fn().mockResolvedValue({ id: 'q1' });
    const app = mountApp({ worksheetTemplateQuestion: { findUnique, update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await putJson(
      app,
      '/api/worksheet-templates/questions/q1',
      { question: 'new?', skillIds: ['sk3'] },
      token
    );
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          question: 'new?',
          skills: { set: [{ id: 'sk3' }] },
        }),
      })
    );
  });

  it('DELETE /api/worksheet-templates/questions/:id removes the question', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'q1' });
    const del = vi.fn().mockResolvedValue({});
    const app = mountApp({ worksheetTemplateQuestion: { findUnique, delete: del } });
    const token = await tokenAs('SUPERADMIN');
    const res = await app.request(
      '/api/worksheet-templates/questions/q1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: 'q1' } });
  });
});

describe('POST /api/math-skills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for non-SUPERADMIN', async () => {
    const app = mountApp({ mathSkill: { create: vi.fn() } });
    const token = await tokenAs('TEACHER');
    const res = await postJson(app, '/api/math-skills', { name: 'X' }, token);
    expect(res.status).toBe(403);
  });

  it('rejects empty name', async () => {
    const app = mountApp({ mathSkill: { create: vi.fn() } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/math-skills', { name: '' }, token);
    expect(res.status).toBe(400);
  });

  it('creates the skill', async () => {
    const create = vi.fn().mockResolvedValue({ id: 'sk1', name: 'Algebra' });
    const app = mountApp({ mathSkill: { create } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/math-skills',
      { name: 'Algebra', description: 'fun', mainTopicId: 'mt1' },
      token
    );
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({
      data: { name: 'Algebra', description: 'fun', mainTopicId: 'mt1' },
    });
  });
});
