import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import analytics from './analytics';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/analytics', analytics);
  return app;
}

async function tokenAs(role = 'SUPERADMIN') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId: 'u-1', role, exp }, SECRET, 'HS256');
}

async function sa(app: Hono<AppBindings>, path: string, role = 'SUPERADMIN') {
  const token = await tokenAs(role);
  return app.request(path, { headers: { Authorization: `Bearer ${token}` } }, { JWT_SECRET: SECRET });
}

describe('GET /api/analytics/schools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ school: { findMany: vi.fn() } });
    const res = await app.request('/api/analytics/schools', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns 403 for TEACHER', async () => {
    const app = mountApp({ school: { findMany: vi.fn() } });
    const res = await sa(app, '/api/analytics/schools', 'TEACHER');
    expect(res.status).toBe(403);
  });

  it('filters out archived by default', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ school: { findMany } });
    await sa(app, '/api/analytics/schools');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: false } })
    );
  });

  it('includes archived when includeArchived=true (no filter)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ school: { findMany } });
    await sa(app, '/api/analytics/schools?includeArchived=true');
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe('GET /api/analytics/overall', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when startDate or endDate is missing', async () => {
    const app = mountApp({});
    const res = await sa(app, '/api/analytics/overall?startDate=2026-04-01');
    expect(res.status).toBe(400);
  });

  it('returns aggregated metrics including raw-SQL high-score and excellence counts', async () => {
    const worksheetCount = vi
      .fn()
      .mockResolvedValueOnce(100) // total
      .mockResolvedValueOnce(10) // absent
      .mockResolvedValueOnce(5) // repeated
      .mockResolvedValueOnce(85); // graded

    const queryRaw = vi
      .fn()
      .mockResolvedValueOnce([{ count: BigInt(20) }]) // high score
      .mockResolvedValueOnce([{ count: BigInt(8) }]); // excellence

    const app = mountApp({
      worksheet: { count: worksheetCount },
      $queryRaw: queryRaw,
    });
    const res = await sa(
      app,
      '/api/analytics/overall?startDate=2026-04-01&endDate=2026-04-30'
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalWorksheets: number;
      totalAbsent: number;
      highScoreCount: number;
      excellenceScoreCount: number;
    };
    expect(body.totalWorksheets).toBe(100);
    expect(body.totalAbsent).toBe(10);
    expect(body.highScoreCount).toBe(20);
    expect(body.excellenceScoreCount).toBe(8);
  });
});

describe('GET /api/analytics/students', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns paginated students with analytics', async () => {
    const count = vi.fn().mockResolvedValue(1);
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'st1',
        username: 'alice',
        name: 'Alice',
        tokenNumber: 'A1',
        isArchived: false,
        studentClasses: [
          { class: { name: '5A', school: { name: 'Oak' } } },
        ],
        studentWorksheets: [
          { id: 'w1', submittedOn: new Date('2026-04-10'), isAbsent: false, isRepeated: false, grade: 32 },
          { id: 'w2', submittedOn: new Date('2026-04-11'), isAbsent: true, isRepeated: false, grade: null },
        ],
      },
    ]);
    const app = mountApp({ user: { count, findMany } });
    const res = await sa(app, '/api/analytics/students');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      students: Array<{
        id: string;
        totalWorksheets: number;
        absentCount: number;
        class: string;
        school: string;
      }>;
      total: number;
      page: number;
    };
    expect(body.total).toBe(1);
    expect(body.students[0].totalWorksheets).toBe(1); // 2 total - 1 absent
    expect(body.students[0].absentCount).toBe(1);
    expect(body.students[0].class).toBe('5A');
    expect(body.students[0].school).toBe('Oak');
  });

  it('honors pagination params and search filter', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ user: { count, findMany } });
    await sa(app, '/api/analytics/students?page=2&pageSize=5&search=alice');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 5, take: 5 })
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where.OR).toBeDefined();
    expect(where.OR[0].name.contains).toBe('alice');
  });

  it('returns 403 for TEACHER', async () => {
    const app = mountApp({});
    const res = await sa(app, '/api/analytics/students', 'TEACHER');
    expect(res.status).toBe(403);
  });
});

describe('GET /api/analytics/students/download', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns CSV with correct headers', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'st1',
        username: 'alice',
        name: 'Alice',
        tokenNumber: 'A1',
        isArchived: false,
        studentClasses: [
          { class: { name: '5A', school: { name: 'Oak' } } },
        ],
        studentWorksheets: [
          { id: 'w1', submittedOn: new Date('2026-04-10'), isAbsent: false, isRepeated: false, grade: 32, class: { isArchived: false, school: { isArchived: false } } },
        ],
      },
    ]);
    const app = mountApp({ user: { findMany } });
    const res = await sa(
      app,
      '/api/analytics/students/download?startDate=2026-04-01&endDate=2026-04-30&format=csv'
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('text/csv');
    expect(res.headers.get('content-disposition')).toContain('.csv');
    const text = await res.text();
    expect(text).toContain('Name,Username');
    expect(text).toContain('"Alice"');
    expect(text).toContain('"Oak"');
    expect(text).toContain('"5A"');
  });

  it('returns JSON when format is not csv', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ user: { findMany } });
    const res = await sa(
      app,
      '/api/analytics/students/download?format=json'
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('excludes students without active class/school', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        id: 'st1',
        username: 'orphan',
        name: 'Orphan',
        tokenNumber: null,
        isArchived: false,
        studentClasses: [], // no active class
        studentWorksheets: [],
      },
    ]);
    const app = mountApp({ user: { findMany } });
    const res = await sa(
      app,
      '/api/analytics/students/download?format=json'
    );
    expect(await res.json()).toEqual([]);
  });
});

describe('GET /api/analytics/schools/:schoolId/classes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('scopes to schoolId and excludes archived by default', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ class: { findMany } });
    await sa(app, '/api/analytics/schools/s1/classes');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          schoolId: 's1',
          isArchived: false,
          school: { isArchived: false },
        },
      })
    );
  });

  it('does not exclude archived when includeArchived=true', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ class: { findMany } });
    await sa(app, '/api/analytics/schools/s1/classes?includeArchived=true');
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { schoolId: 's1' } })
    );
  });
});

describe('POST /api/analytics/students/:studentId/classes/:classId', () => {
  beforeEach(() => vi.clearAllMocks());

  function prismaWith(overrides: Record<string, unknown> = {}) {
    return {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'st1' }) },
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', schoolId: 'sch1' }) },
      studentClass: {
        create: vi.fn().mockResolvedValue({ studentId: 'st1', classId: 'c1', createdAt: new Date() }),
      },
      studentSchool: {
        create: vi.fn().mockResolvedValue({}),
      },
      ...overrides,
    };
  }

  async function postAs(app: Hono<AppBindings>, role = 'SUPERADMIN') {
    const token = await tokenAs(role);
    return app.request(
      '/api/analytics/students/st1/classes/c1',
      { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
  }

  it('returns 401 without a token', async () => {
    const app = mountApp(prismaWith());
    const res = await app.request(
      '/api/analytics/students/st1/classes/c1',
      { method: 'POST' },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-SUPERADMIN', async () => {
    const app = mountApp(prismaWith());
    const res = await postAs(app, 'TEACHER');
    expect(res.status).toBe(403);
  });

  it('returns 404 when student not found', async () => {
    const app = mountApp(prismaWith({ user: { findUnique: vi.fn().mockResolvedValue(null) } }));
    const res = await postAs(app);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/Student not found/);
  });

  it('returns 404 when class not found', async () => {
    const app = mountApp(prismaWith({ class: { findUnique: vi.fn().mockResolvedValue(null) } }));
    const res = await postAs(app);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { message: string };
    expect(body.message).toMatch(/Class not found/);
  });

  it('returns 400 when StudentClass create hits a unique constraint (already in class)', async () => {
    const prisma = prismaWith({
      studentClass: {
        create: vi.fn().mockRejectedValue({ code: 'P2002', message: 'unique constraint' }),
      },
    });
    const app = mountApp(prisma);
    const res = await postAs(app);
    expect(res.status).toBe(400);
  });

  it('creates StudentClass and StudentSchool when both are missing', async () => {
    const prisma = prismaWith();
    const app = mountApp(prisma);
    const res = await postAs(app);
    expect(res.status).toBe(201);
    expect(prisma.studentClass.create).toHaveBeenCalledWith({ data: { studentId: 'st1', classId: 'c1' } });
    expect(prisma.studentSchool.create).toHaveBeenCalledWith({ data: { studentId: 'st1', schoolId: 'sch1' } });
  });

  it('swallows P2002 from the StudentSchool create when student is already in the school', async () => {
    const prisma = prismaWith({
      studentSchool: {
        create: vi.fn().mockRejectedValue({ code: 'P2002', message: 'unique constraint' }),
      },
    });
    const app = mountApp(prisma);
    const res = await postAs(app);
    expect(res.status).toBe(201);
    expect(prisma.studentSchool.create).toHaveBeenCalledWith({ data: { studentId: 'st1', schoolId: 'sch1' } });
  });
});

describe('DELETE /api/analytics/students/:studentId/classes/:classId', () => {
  beforeEach(() => vi.clearAllMocks());

  async function delAs(prisma: unknown, role = 'SUPERADMIN') {
    const app = mountApp(prisma);
    const token = await tokenAs(role);
    return app.request(
      '/api/analytics/students/st1/classes/c1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
  }

  it('returns 401 without a token', async () => {
    const app = mountApp({ studentClass: { delete: vi.fn() } });
    const res = await app.request(
      '/api/analytics/students/st1/classes/c1',
      { method: 'DELETE' },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-SUPERADMIN', async () => {
    const res = await delAs({ studentClass: { delete: vi.fn() } }, 'TEACHER');
    expect(res.status).toBe(403);
  });

  it('returns 404 when prisma.delete reports P2025 (record not found)', async () => {
    const prisma = {
      studentClass: {
        delete: vi.fn().mockRejectedValue({ code: 'P2025', message: 'not found' }),
      },
    };
    const res = await delAs(prisma);
    expect(res.status).toBe(404);
  });

  it('deletes the link and returns 200 on success', async () => {
    const prisma = {
      studentClass: {
        delete: vi.fn().mockResolvedValue({}),
      },
    };
    const res = await delAs(prisma);
    expect(res.status).toBe(200);
    expect(prisma.studentClass.delete).toHaveBeenCalledWith({
      where: { studentId_classId: { studentId: 'st1', classId: 'c1' } },
    });
  });
});
