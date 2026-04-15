import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import users from './users';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/users', users);
  return app;
}

async function tokenAs(role = 'TEACHER', userId = 'u-1') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId, role, exp }, SECRET, 'HS256');
}

describe('GET /api/users', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ user: { findMany: vi.fn() } });
    const res = await app.request('/api/users', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns all users when no role filter', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    const app = mountApp({ user: { findMany } });
    const token = await tokenAs('TEACHER');
    const res = await app.request(
      '/api/users',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([{ id: 'a' }, { id: 'b' }]);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('filters by role when provided', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ user: { findMany } });
    const token = await tokenAs();
    await app.request(
      '/api/users?role=TEACHER',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { role: 'TEACHER' } })
    );
  });

  it('ignores an invalid role filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ user: { findMany } });
    const token = await tokenAs();
    await app.request(
      '/api/users?role=EVIL_ROLE',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });
});

describe('GET /api/users/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the user when found', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'u-1', name: 'Alice' });
    const app = mountApp({ user: { findUnique } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/users/u-1',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'u-1' } })
    );
  });

  it('returns 404 when not found', async () => {
    const app = mountApp({ user: { findUnique: vi.fn().mockResolvedValue(null) } });
    const token = await tokenAs();
    const res = await app.request(
      '/api/users/missing',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
  });
});

describe('GET /api/users/with-details', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ user: { count: vi.fn(), findMany: vi.fn() } });
    const res = await app.request('/api/users/with-details', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-SUPERADMIN', async () => {
    const app = mountApp({ user: { count: vi.fn(), findMany: vi.fn() } });
    const token = await tokenAs('TEACHER');
    const res = await app.request(
      '/api/users/with-details',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(403);
  });

  it('returns paginated users with default page=1 limit=30', async () => {
    const count = vi.fn().mockResolvedValue(65);
    const findMany = vi.fn().mockResolvedValue([{ id: 'u-1' }]);
    const app = mountApp({ user: { count, findMany } });
    const token = await tokenAs('SUPERADMIN');
    const res = await app.request(
      '/api/users/with-details',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: unknown[];
      pagination: { currentPage: number; totalPages: number; totalCount: number; hasNextPage: boolean; hasPrevPage: boolean };
    };
    expect(body.pagination).toEqual({
      currentPage: 1,
      totalPages: 3,
      totalCount: 65,
      hasNextPage: true,
      hasPrevPage: false,
    });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 0, take: 30 })
    );
  });

  it('honors page and limit query params', async () => {
    const count = vi.fn().mockResolvedValue(100);
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ user: { count, findMany } });
    const token = await tokenAs('SUPERADMIN');
    await app.request(
      '/api/users/with-details?page=3&limit=10',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 20, take: 10 }));
  });

  it('filters by isArchived=true', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ user: { count, findMany } });
    const token = await tokenAs('SUPERADMIN');
    await app.request(
      '/api/users/with-details?isArchived=true',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ isArchived: true }) })
    );
  });

  it('applies search across name/username/tokenNumber', async () => {
    const count = vi.fn().mockResolvedValue(0);
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ user: { count, findMany } });
    const token = await tokenAs('SUPERADMIN');
    await app.request(
      '/api/users/with-details?search=ali',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { name: { contains: 'ali', mode: 'insensitive' } },
            { username: { contains: 'ali', mode: 'insensitive' } },
            { tokenNumber: { contains: 'ali', mode: 'insensitive' } },
          ],
        }),
      })
    );
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

const validNewUser = {
  name: 'Alice',
  username: 'alice',
  password: 'secret123',
  role: 'TEACHER',
};

describe('POST /api/users', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for STUDENT/TEACHER (only ADMIN/SUPERADMIN allowed)', async () => {
    const app = mountApp({ user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() } });
    const token = await tokenAs('TEACHER');
    const res = await postJson(app, '/api/users', validNewUser, token);
    expect(res.status).toBe(403);
  });

  it('rejects body missing required fields', async () => {
    const app = mountApp({ user: { findUnique: vi.fn(), findFirst: vi.fn(), create: vi.fn() } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users', { name: 'A' }, token);
    expect(res.status).toBe(400);
  });

  it('returns 400 when username is taken', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'existing' });
    const create = vi.fn();
    const app = mountApp({ user: { findUnique, findFirst: vi.fn(), create } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users', validNewUser, token);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns 400 when tokenNumber is taken', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const findFirst = vi.fn().mockResolvedValue({ id: 'token-owner' });
    const create = vi.fn();
    const app = mountApp({ user: { findUnique, findFirst, create } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users', { ...validNewUser, tokenNumber: 'T1' }, token);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('creates a teacher with hashed password and returns 201', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({
      id: 'u-new',
      name: 'Alice',
      username: 'alice',
      role: 'TEACHER',
      tokenNumber: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const app = mountApp({ user: { findUnique, findFirst: vi.fn(), create } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users', validNewUser, token);
    expect(res.status).toBe(201);
    const callData = create.mock.calls[0][0].data;
    expect(callData.password).not.toBe(validNewUser.password);
    expect(callData.password.length).toBeGreaterThan(40); // bcrypt hash
  });

  it('creates STUDENT and adds class+school join rows when classId provided', async () => {
    const findUnique = vi.fn().mockResolvedValue(null); // username free
    const userCreate = vi.fn().mockResolvedValue({
      id: 'st1',
      name: 'Bob',
      username: 'bob',
      role: 'STUDENT',
      tokenNumber: 'T1',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const studentClassCreate = vi.fn().mockResolvedValue({});
    const classFindUnique = vi.fn().mockResolvedValue({ schoolId: 's1' });
    const studentSchoolFindUnique = vi.fn().mockResolvedValue(null);
    const studentSchoolCreate = vi.fn().mockResolvedValue({});
    const app = mountApp({
      user: { findUnique, findFirst: vi.fn().mockResolvedValue(null), create: userCreate },
      class: { findUnique: classFindUnique },
      studentClass: { create: studentClassCreate },
      studentSchool: {
        findUnique: studentSchoolFindUnique,
        create: studentSchoolCreate,
      },
    });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/users',
      {
        name: 'Bob',
        username: 'bob',
        password: 'secret123',
        role: 'STUDENT',
        tokenNumber: 'T1',
        classId: 'c1',
      },
      token
    );
    expect(res.status).toBe(201);
    expect(studentClassCreate).toHaveBeenCalledWith({
      data: { studentId: 'st1', classId: 'c1' },
    });
    expect(studentSchoolCreate).toHaveBeenCalledWith({
      data: { studentId: 'st1', schoolId: 's1' },
    });
  });
});

describe('PUT /api/users/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when user does not exist', async () => {
    const app = mountApp({
      user: { findUnique: vi.fn().mockResolvedValue(null), findFirst: vi.fn(), update: vi.fn() },
    });
    const token = await tokenAs('SUPERADMIN');
    const res = await putJson(app, '/api/users/missing', { name: 'New' }, token);
    expect(res.status).toBe(404);
  });

  it('rejects role changes with 400', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'u1', role: 'TEACHER' });
    const update = vi.fn();
    const app = mountApp({ user: { findUnique, findFirst: vi.fn(), update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await putJson(app, '/api/users/u1', { role: 'ADMIN' }, token);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 400 when new username is taken by another user', async () => {
    // findUnique called twice: first by id (existing), then by username (taken)
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ id: 'u1', username: 'old' })
      .mockResolvedValueOnce({ id: 'u2', username: 'new' });
    const update = vi.fn();
    const app = mountApp({ user: { findUnique, findFirst: vi.fn(), update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await putJson(app, '/api/users/u1', { username: 'new' }, token);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('updates name when only name is provided', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'u1', username: 'alice', role: 'TEACHER' });
    const update = vi.fn().mockResolvedValue({ id: 'u1', name: 'Alice2' });
    const app = mountApp({ user: { findUnique, findFirst: vi.fn(), update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await putJson(app, '/api/users/u1', { name: 'Alice2' }, token);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'u1' },
        data: { name: 'Alice2' },
      })
    );
  });
});

describe('POST /api/users/:id/reset-password', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when user does not exist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    const app = mountApp({ user: { findUnique, update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/users/missing/reset-password',
      { newPassword: 'secret123' },
      token
    );
    expect(res.status).toBe(404);
  });

  it('rejects passwords shorter than 6 characters', async () => {
    const app = mountApp({ user: { findUnique: vi.fn(), update: vi.fn() } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/users/u1/reset-password',
      { newPassword: 'abc' },
      token
    );
    expect(res.status).toBe(400);
  });

  it('hashes password and updates the user', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'u1' });
    const update = vi.fn().mockResolvedValue({});
    const app = mountApp({ user: { findUnique, update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/users/u1/reset-password',
      { newPassword: 'newpass1' },
      token
    );
    expect(res.status).toBe(200);
    const data = update.mock.calls[0][0].data;
    expect(data.password).not.toBe('newpass1');
    expect(data.password.length).toBeGreaterThan(40);
  });
});

describe('POST /api/users/:id/archive and unarchive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 403 for non-SUPERADMIN', async () => {
    const app = mountApp({ user: { findUnique: vi.fn(), update: vi.fn() } });
    const token = await tokenAs('ADMIN');
    const res = await postJson(app, '/api/users/u1/archive', {}, token);
    expect(res.status).toBe(403);
  });

  it('returns 404 when user not found', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const app = mountApp({ user: { findUnique, update: vi.fn() } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users/missing/archive', {}, token);
    expect(res.status).toBe(404);
  });

  it('archives a student', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'u1' });
    const update = vi.fn().mockResolvedValue({});
    const app = mountApp({ user: { findUnique, update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users/u1/archive', {}, token);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isArchived: true },
    });
  });

  it('unarchives a student', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'u1' });
    const update = vi.fn().mockResolvedValue({});
    const app = mountApp({ user: { findUnique, update } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users/u1/unarchive', {}, token);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'u1' },
      data: { isArchived: false },
    });
  });
});

describe('POST /api/users/upload-csv', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when students array is empty', async () => {
    const app = mountApp({});
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users/upload-csv', { students: [] }, token);
    expect(res.status).toBe(400);
  });

  it('returns 400 when payload is malformed (missing students)', async () => {
    const app = mountApp({});
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(app, '/api/users/upload-csv', {}, token);
    expect(res.status).toBe(400);
  });

  it('returns 403 for non-SUPERADMIN', async () => {
    const app = mountApp({});
    const token = await tokenAs('ADMIN');
    const res = await postJson(app, '/api/users/upload-csv', { students: [] }, token);
    expect(res.status).toBe(403);
  });

  it('reports missing required fields per row without aborting batch', async () => {
    const findFirst = vi.fn();
    const app = mountApp({ school: { findFirst }, class: { findFirst: vi.fn() } });
    const token = await tokenAs('SUPERADMIN');
    const res = await postJson(
      app,
      '/api/users/upload-csv',
      {
        students: [
          { name: 'A', tokenNumber: 'T1' }, // missing className/schoolName
          { name: 'B', tokenNumber: 'T2', className: 'C1', schoolName: 'S1' },
        ],
      },
      token
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { results: { errors: string[] } };
    expect(body.results.errors.length).toBe(2); // first missing, second school not found (mock returns undefined)
  });
});
