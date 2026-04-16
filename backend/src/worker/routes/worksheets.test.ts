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

// ---------- Multipart upload tests ----------

describe('POST /api/worksheets/upload', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeFormDataRequest(
    fields: Record<string, string>,
    files: Array<{ name: string; type: string; size: number }>
  ): RequestInit {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) {
      fd.append('images', new Blob([new Uint8Array(f.size)], { type: f.type }), f.name);
    }
    return { method: 'POST', body: fd };
  }

  function makeR2Bucket() {
    const puts: Array<{ key: string; size: number }> = [];
    const bucket = {
      put: vi.fn(async (key: string, body: ArrayBufferView | ArrayBuffer) => {
        const size = body instanceof Uint8Array ? body.byteLength : (body as ArrayBuffer).byteLength;
        puts.push({ key, size });
        return {};
      }),
      get: vi.fn(async () => null),
      delete: vi.fn(async () => {}),
      head: vi.fn(async () => null),
    };
    return { bucket, puts };
  }

  it('returns 400 when body is not multipart/form-data', async () => {
    const app = mountApp({});
    const token = await tokenAs('TEACHER');
    const res = await app.request(
      '/api/worksheets/upload',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: '{}',
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when no files are provided', async () => {
    const app = mountApp({});
    const token = await tokenAs('TEACHER');
    const init = makeFormDataRequest({ classId: 'c1' }, []);
    const res = await app.request(
      '/api/worksheets/upload',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when a non-image file is sent', async () => {
    const app = mountApp({});
    const token = await tokenAs('TEACHER');
    const init = makeFormDataRequest(
      { classId: 'c1' },
      [{ name: 'a.txt', type: 'text/plain', size: 10 }]
    );
    const res = await app.request(
      '/api/worksheets/upload',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when a file exceeds the 5 MB cap', async () => {
    const app = mountApp({});
    const token = await tokenAs('TEACHER');
    const init = makeFormDataRequest(
      { classId: 'c1' },
      [{ name: 'big.png', type: 'image/png', size: 6 * 1024 * 1024 }]
    );
    const res = await app.request(
      '/api/worksheets/upload',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when class does not exist', async () => {
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const token = await tokenAs('TEACHER');
    const init = makeFormDataRequest(
      { classId: 'missing' },
      [{ name: 'a.png', type: 'image/png', size: 100 }]
    );
    const res = await app.request(
      '/api/worksheets/upload',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET, WORKSHEET_FILES: makeR2Bucket().bucket as never, R2_PUBLIC_BASE_URL: 'https://cdn' }
    );
    expect(res.status).toBe(404);
  });

  it('uploads images and creates a PENDING worksheet with image rows', async () => {
    const { bucket, puts } = makeR2Bucket();
    const worksheetCreate = vi.fn().mockResolvedValue({
      id: 'w-new',
      status: 'PENDING',
    });
    const imageCreate = vi
      .fn()
      .mockResolvedValueOnce({ id: 'img-1', pageNumber: 1 })
      .mockResolvedValueOnce({ id: 'img-2', pageNumber: 2 });
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1' }) },
      worksheet: { create: worksheetCreate },
      worksheetImage: { create: imageCreate },
    });
    const token = await tokenAs('TEACHER');
    const init = makeFormDataRequest(
      { classId: 'c1', notes: 'first try' },
      [
        { name: 'page1.png', type: 'image/png', size: 1024 },
        { name: 'page2.jpg', type: 'image/jpeg', size: 2048 },
      ]
    );
    const res = await app.request(
      '/api/worksheets/upload',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      {
        JWT_SECRET: SECRET,
        WORKSHEET_FILES: bucket as never,
        R2_PUBLIC_BASE_URL: 'https://cdn.example.com',
      }
    );
    expect(res.status).toBe(201);
    expect(worksheetCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          classId: 'c1',
          notes: 'first try',
          status: 'PENDING',
          submittedById: 'u-1',
        }),
      })
    );
    expect(puts.length).toBe(2);
    expect(puts[0].key).toMatch(/^worksheets\/w-new\/\d+-page1-page1\.png$/);
    expect(puts[1].key).toMatch(/^worksheets\/w-new\/\d+-page2-page2\.jpg$/);
    expect(imageCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          pageNumber: 1,
          worksheetId: 'w-new',
        }),
      })
    );
  });

  it('returns 500 when R2_PUBLIC_BASE_URL is unset so image URLs are unresolvable', async () => {
    const { bucket } = makeR2Bucket();
    const worksheetCreate = vi.fn().mockResolvedValue({ id: 'w', status: 'PENDING' });
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1' }) },
      worksheet: { create: worksheetCreate },
      worksheetImage: { create: vi.fn() },
    });
    const token = await tokenAs('TEACHER');
    const init = makeFormDataRequest(
      { classId: 'c1' },
      [{ name: 'a.png', type: 'image/png', size: 100 }]
    );
    const res = await app.request(
      '/api/worksheets/upload',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET, WORKSHEET_FILES: bucket as never }
    );
    expect(res.status).toBe(500);
  });
});

// ---------- Python utility endpoint tests ----------

const originalFetch = globalThis.fetch;

function installFetchMock(impl: (url: string, init: RequestInit) => Promise<Response>) {
  const fn = vi.fn(impl);
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

describe('POST /api/worksheets/images', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('returns 500 when PYTHON_API_URL is not configured', async () => {
    const app = mountApp({});
    const token = await tokenAs('TEACHER');
    const res = await app.request(
      '/api/worksheets/images',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_no: 'T1', worksheet_name: 'WS-1' }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(500);
  });

  it('forwards to python api and returns its JSON response', async () => {
    const fetchMock = installFetchMock(async () =>
      new Response(JSON.stringify({ images: ['u1'] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const app = mountApp({});
    const token = await tokenAs('TEACHER');
    const res = await app.request(
      '/api/worksheets/images',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_no: 'T1', worksheet_name: 'WS-1' }),
      },
      { JWT_SECRET: SECRET, PYTHON_API_URL: 'https://py.example.com' }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ images: ['u1'] });
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toBe('https://py.example.com/get-worksheet-images');
  });
});

describe('POST /api/worksheets/total-ai-graded', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns count without date filter', async () => {
    const count = vi.fn().mockResolvedValue(42);
    const app = mountApp({ gradingJob: { count } });
    const res = await jsonRequest(
      app,
      '/api/worksheets/total-ai-graded',
      'POST',
      {},
      'SUPERADMIN'
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ total_ai_graded: 42 });
    expect(count).toHaveBeenCalledWith({
      where: { status: 'COMPLETED' },
    });
  });

  it('rejects invalid startDate', async () => {
    const app = mountApp({ gradingJob: { count: vi.fn() } });
    const res = await jsonRequest(
      app,
      '/api/worksheets/total-ai-graded',
      'POST',
      { startDate: 'not-a-date', endDate: '2026-04-10' },
      'SUPERADMIN'
    );
    expect(res.status).toBe(400);
  });

  it('applies date range via AND/OR on submittedOn or createdAt', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const app = mountApp({ gradingJob: { count } });
    await jsonRequest(
      app,
      '/api/worksheets/total-ai-graded',
      'POST',
      { startDate: '2026-04-01', endDate: '2026-04-10' },
      'SUPERADMIN'
    );
    const where = count.mock.calls[0][0].where;
    expect(where.AND[0].OR.length).toBe(2);
  });

  it('returns 403 for non-SUPERADMIN', async () => {
    const app = mountApp({ gradingJob: { count: vi.fn() } });
    const res = await jsonRequest(
      app,
      '/api/worksheets/total-ai-graded',
      'POST',
      {},
      'TEACHER'
    );
    expect(res.status).toBe(403);
  });
});

describe('POST /api/worksheets/student-grading-details', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = originalFetch;
  });

  it('returns 403 for non-SUPERADMIN', async () => {
    const app = mountApp({});
    const res = await jsonRequest(
      app,
      '/api/worksheets/student-grading-details',
      'POST',
      { token_no: 'T1', worksheet_name: 'WS-1' },
      'TEACHER'
    );
    expect(res.status).toBe(403);
  });

  it('includes overall_score in the forwarded body when provided', async () => {
    const fetchMock = installFetchMock(async () =>
      new Response(JSON.stringify({ details: [] }), { status: 200 })
    );
    const app = mountApp({});
    const token = await tokenAs('SUPERADMIN');
    await app.request(
      '/api/worksheets/student-grading-details',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_no: 'T1', worksheet_name: 'WS-1', overall_score: 32 }),
      },
      { JWT_SECRET: SECRET, PYTHON_API_URL: 'https://py.example.com' }
    );
    const init = fetchMock.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);
    expect(body).toEqual({ token_no: 'T1', worksheet_name: 'WS-1', overall_score: 32 });
  });

  it('omits overall_score when not provided', async () => {
    const fetchMock = installFetchMock(async () =>
      new Response(JSON.stringify({ details: [] }), { status: 200 })
    );
    const app = mountApp({});
    const token = await tokenAs('SUPERADMIN');
    await app.request(
      '/api/worksheets/student-grading-details',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token_no: 'T1', worksheet_name: 'WS-1' }),
      },
      { JWT_SECRET: SECRET, PYTHON_API_URL: 'https://py.example.com' }
    );
    const body = JSON.parse(
      (fetchMock.mock.calls[0][1] as RequestInit).body as string
    );
    expect(body).toEqual({ token_no: 'T1', worksheet_name: 'WS-1' });
  });
});

describe('POST /api/worksheets/recommend-next', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects body without classId/studentId', async () => {
    const app = mountApp({ worksheet: { findMany: vi.fn(), findFirst: vi.fn() } });
    const res = await jsonRequest(
      app,
      '/api/worksheets/recommend-next',
      'POST',
      { classId: 'c1' }
    );
    expect(res.status).toBe(400);
  });

  it('returns 403 for STUDENT role', async () => {
    const app = mountApp({ worksheet: { findMany: vi.fn(), findFirst: vi.fn() } });
    const res = await jsonRequest(
      app,
      '/api/worksheets/recommend-next',
      'POST',
      { classId: 'c1', studentId: 'st1' },
      'STUDENT'
    );
    expect(res.status).toBe(403);
  });

  it('returns "start from worksheet 1" when student has no history anywhere', async () => {
    const app = mountApp({
      worksheet: {
        findMany: vi.fn().mockResolvedValue([]),
        findFirst: vi.fn().mockResolvedValue(null),
      },
    });
    const res = await jsonRequest(app, '/api/worksheets/recommend-next', 'POST', {
      classId: 'c1',
      studentId: 'st1',
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      recommendedWorksheetNumber: 1,
      isRepeated: false,
      lastWorksheetNumber: null,
      lastGrade: null,
      progressionThreshold: 32,
    });
  });

  it('uses current-class history when present and advances past threshold', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        grade: 35,
        worksheetNumber: 5,
        submittedOn: new Date('2026-04-10'),
        createdAt: new Date('2026-04-10T09:00:00Z'),
        template: { worksheetNumber: 5 },
      },
    ]);
    const app = mountApp({ worksheet: { findMany, findFirst: vi.fn() } });
    const res = await jsonRequest(app, '/api/worksheets/recommend-next', 'POST', {
      classId: 'c1',
      studentId: 'st1',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recommendedWorksheetNumber: number;
      lastWorksheetNumber: number | null;
      lastGrade: number | null;
    };
    expect(body.recommendedWorksheetNumber).toBe(6);
    expect(body.lastWorksheetNumber).toBe(5);
    expect(body.lastGrade).toBe(35);
  });

  it('falls back to prior-class latest day when current-class history is empty', async () => {
    // current-class history: empty → triggers prior-class fallback chain.
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([]) // current class
      .mockResolvedValueOnce([
        // latest-day worksheets from any class
        {
          worksheetNumber: 7,
          grade: 35,
          submittedOn: new Date('2026-04-01'),
          createdAt: new Date('2026-04-01T09:00:00Z'),
          template: { worksheetNumber: 7 },
        },
      ]);
    const findFirst = vi.fn().mockResolvedValue({
      submittedOn: new Date('2026-04-01'),
    });
    const app = mountApp({ worksheet: { findMany, findFirst } });
    const res = await jsonRequest(app, '/api/worksheets/recommend-next', 'POST', {
      classId: 'c1',
      studentId: 'st1',
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recommendedWorksheetNumber: number;
      isRepeated: boolean;
      lastWorksheetNumber: number | null;
    };
    // Prior-class fallback: isRepeated always false (student is new to class).
    expect(body.isRepeated).toBe(false);
    expect(body.recommendedWorksheetNumber).toBe(8);
    expect(body.lastWorksheetNumber).toBe(7);
  });

  it('honors PROGRESSION_THRESHOLD env var when set', async () => {
    const findMany = vi.fn().mockResolvedValue([
      {
        grade: 30, // below default 32, but above custom 25
        worksheetNumber: 5,
        submittedOn: new Date('2026-04-10'),
        createdAt: new Date('2026-04-10T09:00:00Z'),
        template: { worksheetNumber: 5 },
      },
    ]);
    const app = mountApp({ worksheet: { findMany, findFirst: vi.fn() } });
    const token = await tokenAs('TEACHER');
    const res = await app.request(
      '/api/worksheets/recommend-next',
      {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: 'c1', studentId: 'st1' }),
      },
      { JWT_SECRET: SECRET, PROGRESSION_THRESHOLD: '25' }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      recommendedWorksheetNumber: number;
      progressionThreshold: number;
    };
    expect(body.progressionThreshold).toBe(25);
    expect(body.recommendedWorksheetNumber).toBe(6); // advanced due to lower threshold
  });

  it('filters history with beforeDate when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const findFirst = vi.fn().mockResolvedValue(null);
    const app = mountApp({ worksheet: { findMany, findFirst } });
    await jsonRequest(app, '/api/worksheets/recommend-next', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      beforeDate: '2026-04-05T00:00:00Z',
    });
    // Both findMany (current class) and findFirst (prior class) should apply the filter.
    const call = findMany.mock.calls[0][0];
    expect(call.where.submittedOn.lt).toBeInstanceOf(Date);
    expect(findFirst.mock.calls[0][0].where.submittedOn.lt).toBeInstanceOf(Date);
  });
});

describe('POST /api/worksheets/check-repeated', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects invalid worksheetNumber with 400', async () => {
    const app = mountApp({
      worksheetTemplate: { findFirst: vi.fn() },
      worksheet: { findFirst: vi.fn() },
    });
    const res = await jsonRequest(app, '/api/worksheets/check-repeated', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 0,
    });
    expect(res.status).toBe(400);
  });

  it('returns isRepeated=false when template not found', async () => {
    const app = mountApp({
      worksheetTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
      worksheet: { findFirst: vi.fn() },
    });
    const res = await jsonRequest(app, '/api/worksheets/check-repeated', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isRepeated: boolean };
    expect(body.isRepeated).toBe(false);
  });

  it('returns isRepeated=true with previous worksheet details when found', async () => {
    const findFirst = vi.fn().mockResolvedValue({
      id: 'w-prev',
      grade: 30,
      submittedOn: new Date('2026-03-01'),
    });
    const app = mountApp({
      worksheetTemplate: { findFirst: vi.fn().mockResolvedValue({ id: 't1' }) },
      worksheet: { findFirst },
    });
    const res = await jsonRequest(app, '/api/worksheets/check-repeated', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 5,
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { isRepeated: boolean; previousWorksheet: { id: string } };
    expect(body.isRepeated).toBe(true);
    expect(body.previousWorksheet.id).toBe('w-prev');
  });

  it('applies beforeDate filter when provided', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const app = mountApp({
      worksheetTemplate: { findFirst: vi.fn().mockResolvedValue({ id: 't1' }) },
      worksheet: { findFirst },
    });
    await jsonRequest(app, '/api/worksheets/check-repeated', 'POST', {
      classId: 'c1',
      studentId: 'st1',
      worksheetNumber: 5,
      beforeDate: '2026-04-10T00:00:00Z',
    });
    const where = findFirst.mock.calls[0][0].where;
    expect(where.submittedOn.lt).toBeInstanceOf(Date);
  });
});

describe('POST /api/worksheets/batch-save', () => {
  beforeEach(() => vi.clearAllMocks());

  it('deletes rows marked with action=delete', async () => {
    const deleteMany = vi.fn().mockResolvedValue({ count: 2 });
    const app = mountApp({ worksheet: { deleteMany } });
    const res = await jsonRequest(app, '/api/worksheets/batch-save', 'POST', {
      classId: 'c1',
      submittedOn: '2026-04-10T00:00:00Z',
      worksheets: [{ studentId: 'st1', action: 'delete' }],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: number };
    expect(body.deleted).toBe(2);
    expect(deleteMany).toHaveBeenCalled();
  });

  it('upserts absent rows with worksheetNumber 0', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const app = mountApp({ worksheet: { upsert } });
    const res = await jsonRequest(app, '/api/worksheets/batch-save', 'POST', {
      classId: 'c1',
      submittedOn: '2026-04-10T00:00:00Z',
      worksheets: [{ studentId: 'st1', isAbsent: true }],
    });
    expect(res.status).toBe(200);
    expect((await res.json() as { saved: number }).saved).toBe(1);
    const call = upsert.mock.calls[0][0];
    expect(call.where.unique_worksheet_per_student_day.worksheetNumber).toBe(0);
  });

  it('captures per-row errors without aborting the batch', async () => {
    const upsert = vi.fn().mockResolvedValue({});
    const findFirst = vi.fn().mockResolvedValue(null);
    const app = mountApp({
      worksheet: { upsert, findFirst },
      worksheetTemplate: { findFirst: vi.fn().mockResolvedValue(null) },
    });
    const res = await jsonRequest(app, '/api/worksheets/batch-save', 'POST', {
      classId: 'c1',
      submittedOn: '2026-04-10T00:00:00Z',
      worksheets: [
        { studentId: 'st1', worksheetNumber: 5, grade: 30 },
        { /* missing studentId */ worksheetNumber: 5, grade: 30 },
        { studentId: 'st2', worksheetNumber: 0, grade: 30 },
        { studentId: 'st3', worksheetNumber: 5, grade: 50 }, // out of range
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      saved: number;
      failed: number;
      errors: Array<{ studentId: string; error: string }>;
    };
    expect(body.saved).toBe(1);
    expect(body.failed).toBe(3);
    expect(body.errors.length).toBe(3);
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
