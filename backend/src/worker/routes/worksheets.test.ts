import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import worksheets from './worksheets';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/worksheets', worksheets);
  return app;
}

async function tokenAs(role = 'TEACHER') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId: 'u-1', role, exp }, SECRET, 'HS256');
}

async function authed(
  app: Hono<AppBindings>,
  path: string,
  role = 'TEACHER'
): Promise<Response> {
  const token = await tokenAs(role);
  return app.request(
    path,
    { headers: { Authorization: `Bearer ${token}` } },
    { JWT_SECRET: SECRET }
  );
}

describe('GET /api/worksheets/class/:classId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ worksheet: { findMany: vi.fn() } });
    const res = await app.request('/api/worksheets/class/c1', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns worksheets filtered by classId ordered by createdAt desc', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'w1' }, { id: 'w2' }]);
    const app = mountApp({ worksheet: { findMany } });
    const res = await authed(app, '/api/worksheets/class/c1');
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classId: 'c1' },
        orderBy: { createdAt: 'desc' },
      })
    );
  });
});

describe('GET /api/worksheets/student/:studentId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when student does not exist', async () => {
    const app = mountApp({
      user: { findFirst: vi.fn().mockResolvedValue(null) },
      worksheet: { findMany: vi.fn() },
    });
    const res = await authed(app, '/api/worksheets/student/missing');
    expect(res.status).toBe(404);
  });

  it('returns worksheets for the student when found', async () => {
    const userFindFirst = vi.fn().mockResolvedValue({ id: 'st1' });
    const wsFindMany = vi.fn().mockResolvedValue([{ id: 'w1' }]);
    const app = mountApp({
      user: { findFirst: userFindFirst },
      worksheet: { findMany: wsFindMany },
    });
    const res = await authed(app, '/api/worksheets/student/st1');
    expect(res.status).toBe(200);
    expect(userFindFirst).toHaveBeenCalledWith({ where: { id: 'st1', role: 'STUDENT' } });
    expect(wsFindMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { studentId: 'st1' } })
    );
  });
});

describe('GET /api/worksheets/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const app = mountApp({
      worksheet: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const res = await authed(app, '/api/worksheets/missing');
    expect(res.status).toBe(404);
  });

  it('returns the row when found', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'w1' });
    const app = mountApp({ worksheet: { findUnique } });
    const res = await authed(app, '/api/worksheets/w1');
    expect(res.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'w1' } })
    );
  });
});

describe('GET /api/worksheets/find', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing query params with 400', async () => {
    const app = mountApp({ worksheet: { findFirst: vi.fn() } });
    const res = await authed(app, '/api/worksheets/find?classId=c1&studentId=st1');
    expect(res.status).toBe(400);
  });

  it('returns 403 for STUDENT role', async () => {
    const app = mountApp({ worksheet: { findFirst: vi.fn() } });
    const res = await authed(
      app,
      '/api/worksheets/find?classId=c1&studentId=st1&startDate=2026-04-01T00:00:00Z&endDate=2026-04-02T00:00:00Z',
      'STUDENT'
    );
    expect(res.status).toBe(403);
  });

  it('queries by class/student in the given date range', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 'w1' });
    const app = mountApp({ worksheet: { findFirst } });
    const res = await authed(
      app,
      '/api/worksheets/find?classId=c1&studentId=st1&startDate=2026-04-01T00:00:00Z&endDate=2026-04-02T00:00:00Z'
    );
    expect(res.status).toBe(200);
    const call = findFirst.mock.calls[0][0];
    expect(call.where).toMatchObject({
      classId: 'c1',
      studentId: 'st1',
    });
    expect(call.where.submittedOn.gte).toBeInstanceOf(Date);
    expect(call.where.submittedOn.lt).toBeInstanceOf(Date);
  });
});

describe('GET /api/worksheets/find-all', () => {
  it('orders by createdAt asc and includes images ordered by pageNumber', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ worksheet: { findMany } });
    await authed(
      app,
      '/api/worksheets/find-all?classId=c1&studentId=st1&startDate=2026-04-01T00:00:00Z&endDate=2026-04-02T00:00:00Z'
    );
    const call = findMany.mock.calls[0][0];
    expect(call.orderBy).toEqual({ createdAt: 'asc' });
    expect(call.include.images.orderBy).toEqual({ pageNumber: 'asc' });
  });
});

describe('GET /api/worksheets/history', () => {
  beforeEach(() => vi.clearAllMocks());

  it('excludes future filters (no submittedOn) when endDate is in the future', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ worksheet: { findMany } });
    const farFuture = new Date(Date.now() + 10 * 86400000).toISOString();
    await authed(
      app,
      `/api/worksheets/history?classId=c1&studentId=st1&endDate=${farFuture}`
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where.submittedOn).toBeUndefined();
    expect(where.status).toBe('COMPLETED');
  });

  it('applies `submittedOn < endDate` when endDate is in the past', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ worksheet: { findMany } });
    await authed(
      app,
      '/api/worksheets/history?classId=c1&studentId=st1&endDate=2026-01-01T00:00:00Z'
    );
    const where = findMany.mock.calls[0][0].where;
    expect(where.submittedOn.lt).toBeInstanceOf(Date);
  });
});

describe('GET /api/worksheets/templates', () => {
  it('returns [{ id, worksheetNumber }] ordered by worksheetNumber asc', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 't1', worksheetNumber: 1 },
      { id: 't2', worksheetNumber: 2 },
    ]);
    const app = mountApp({ worksheetTemplate: { findMany } });
    const res = await authed(app, '/api/worksheets/templates');
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { worksheetNumber: 'asc' } })
    );
  });
});

describe('GET /api/worksheets/teacher/:teacherId/classes', () => {
  it('transforms rows to { id, name } using school name prefix', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { class: { id: 'c1', name: '5A', school: { name: 'Oak' } } },
      { class: { id: 'c2', name: '5B', school: { name: 'Oak' } } },
    ]);
    const app = mountApp({ teacherClass: { findMany } });
    const res = await authed(app, '/api/worksheets/teacher/t1/classes');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([
      { id: 'c1', name: 'Oak - 5A' },
      { id: 'c2', name: 'Oak - 5B' },
    ]);
  });
});

describe('GET /api/worksheets/class/:classId/students', () => {
  it('transforms rows and excludes archived students via where', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        student: {
          id: 'st1',
          username: 'alice',
          name: 'Alice',
          tokenNumber: 'A1',
        },
      },
    ]);
    const app = mountApp({ studentClass: { findMany } });
    const res = await authed(app, '/api/worksheets/class/c1/students');
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { classId: 'c1', student: { isArchived: false } },
      })
    );
    expect(await res.json()).toEqual([
      { id: 'st1', username: 'alice', name: 'Alice', tokenNumber: 'A1' },
    ]);
  });
});

// ---------- Mutation tests ----------

async function jsonRequest(
  app: Hono<AppBindings>,
  path: string,
  method: string,
  body: unknown,
  role = 'TEACHER'
) {
  const token = await tokenAs(role);
  return app.request(
    path,
    {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { JWT_SECRET: SECRET }
  );
}

describe('POST /api/worksheets/grade — absent students', () => {
  beforeEach(() => vi.clearAllMocks());

  it('upserts an absent record with worksheetNumber=0 and grade=0', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'w1', isAbsent: true });
    const app = mountApp({ worksheet: { upsert, findUnique: vi.fn() } });
    const res = await jsonRequest(app, '/api/worksheets/grade', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      isAbsent: true,
      submittedOn: '2026-04-10T00:00:00Z',
    });
    expect(res.status).toBe(201);
    const call = upsert.mock.calls[0][0];
    expect(call.where.unique_worksheet_per_student_day.worksheetNumber).toBe(0);
    expect(call.create.isAbsent).toBe(true);
    expect(call.create.grade).toBe(0);
  });
});

describe('POST /api/worksheets/grade — non-absent validation', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid worksheetNumber', async () => {
    const app = mountApp({ worksheet: { upsert: vi.fn() } });
    const res = await jsonRequest(app, '/api/worksheets/grade', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 0,
      grade: 10,
    });
    expect(res.status).toBe(400);
  });

  it('rejects grade out of range', async () => {
    const app = mountApp({ worksheet: { upsert: vi.fn() } });
    const res = await jsonRequest(app, '/api/worksheets/grade', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 5,
      grade: 41,
    });
    expect(res.status).toBe(400);
  });

  it('connects template when one matches the worksheetNumber', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'w1' });
    const app = mountApp({
      worksheet: { upsert },
      worksheetTemplate: { findFirst: vi.fn().mockResolvedValue({ id: 't1' }) },
    });
    const res = await jsonRequest(app, '/api/worksheets/grade', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 5,
      grade: 32,
    });
    expect(res.status).toBe(201);
    const call = upsert.mock.calls[0][0];
    expect(call.create.templateId).toBe('t1');
    expect(call.create.worksheetNumber).toBe(5);
    expect(call.create.grade).toBe(32);
  });
});

describe('PUT /api/worksheets/grade/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when the worksheet does not exist', async () => {
    const app = mountApp({
      worksheet: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    const res = await jsonRequest(app, '/api/worksheets/grade/missing', 'PUT', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 5,
      grade: 30,
    });
    expect(res.status).toBe(404);
  });

  it('clears grade state when flipping to absent', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'w1', isAbsent: true });
    const app = mountApp({
      worksheet: {
        findUnique: vi.fn().mockResolvedValue({ id: 'w1' }),
        update,
      },
    });
    const res = await jsonRequest(app, '/api/worksheets/grade/w1', 'PUT', {
      classId: 'c1',
      studentId: 'st1',
      isAbsent: true,
    });
    expect(res.status).toBe(200);
    const call = update.mock.calls[0][0];
    expect(call.data.grade).toBe(0);
    expect(call.data.isAbsent).toBe(true);
    expect(call.data.isRepeated).toBe(false);
    expect(call.data.isIncorrectGrade).toBe(false);
  });

  it('returns 400 on invalid grade when not absent', async () => {
    const app = mountApp({
      worksheet: {
        findUnique: vi.fn().mockResolvedValue({ id: 'w1' }),
        update: vi.fn(),
      },
    });
    const res = await jsonRequest(app, '/api/worksheets/grade/w1', 'PUT', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 5,
      grade: 100,
    });
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/worksheets/:id', () => {
  it('deletes by id', async () => {
    const del = vi.fn().mockResolvedValue({});
    const app = mountApp({ worksheet: { delete: del } });
    const token = await tokenAs('TEACHER');
    const res = await app.request(
      '/api/worksheets/w1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: 'w1' } });
  });

  it('returns 403 for STUDENT', async () => {
    const app = mountApp({ worksheet: { delete: vi.fn() } });
    const token = await tokenAs('STUDENT');
    const res = await app.request(
      '/api/worksheets/w1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(403);
  });
});

describe('PATCH /api/worksheets/:id/admin-comments', () => {
  it('returns 403 for non-SUPERADMIN', async () => {
    const app = mountApp({ worksheet: { findUnique: vi.fn(), update: vi.fn() } });
    const res = await jsonRequest(
      app,
      '/api/worksheets/w1/admin-comments',
      'PATCH',
      { adminComments: 'hi' },
      'TEACHER'
    );
    expect(res.status).toBe(403);
  });

  it('updates adminComments when SUPERADMIN', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'w1', adminComments: 'ok' });
    const app = mountApp({
      worksheet: {
        findUnique: vi.fn().mockResolvedValue({ id: 'w1' }),
        update,
      },
    });
    const res = await jsonRequest(
      app,
      '/api/worksheets/w1/admin-comments',
      'PATCH',
      { adminComments: 'ok' },
      'SUPERADMIN'
    );
    expect(res.status).toBe(200);
    const call = update.mock.calls[0][0];
    expect(call.data.adminComments).toBe('ok');
  });

  it('normalizes empty string to null', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'w1' });
    const app = mountApp({
      worksheet: {
        findUnique: vi.fn().mockResolvedValue({ id: 'w1' }),
        update,
      },
    });
    await jsonRequest(
      app,
      '/api/worksheets/w1/admin-comments',
      'PATCH',
      { adminComments: '' },
      'SUPERADMIN'
    );
    expect(update.mock.calls[0][0].data.adminComments).toBeNull();
  });
});

describe('PATCH /api/worksheets/:id/mark-correct', () => {
  it('returns 404 when worksheet missing', async () => {
    const app = mountApp({
      worksheet: {
        findUnique: vi.fn().mockResolvedValue(null),
        update: vi.fn(),
      },
    });
    const res = await jsonRequest(
      app,
      '/api/worksheets/w1/mark-correct',
      'PATCH',
      {},
      'SUPERADMIN'
    );
    expect(res.status).toBe(404);
  });

  it('sets isIncorrectGrade=false', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'w1' });
    const app = mountApp({
      worksheet: {
        findUnique: vi.fn().mockResolvedValue({ id: 'w1' }),
        update,
      },
    });
    const res = await jsonRequest(
      app,
      '/api/worksheets/w1/mark-correct',
      'PATCH',
      {},
      'SUPERADMIN'
    );
    expect(res.status).toBe(200);
    expect(update.mock.calls[0][0].data.isIncorrectGrade).toBe(false);
  });
});
