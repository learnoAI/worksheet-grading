import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import schools from './schools';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/schools', schools);
  return app;
}

async function superadminToken() {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId: 'u-1', role: 'SUPERADMIN', exp }, SECRET, 'HS256');
}

async function teacherToken() {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId: 'u-2', role: 'TEACHER', exp }, SECRET, 'HS256');
}

describe('GET /api/schools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ school: { findMany: vi.fn() } });
    const res = await app.request('/api/schools', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-SUPERADMIN roles', async () => {
    const app = mountApp({ school: { findMany: vi.fn() } });
    const token = await teacherToken();
    const res = await app.request(
      '/api/schools',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(403);
  });

  it('returns only active schools by default', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ school: { findMany } });
    const token = await superadminToken();
    const res = await app.request(
      '/api/schools',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: false } })
    );
  });

  it('returns archived schools when includeArchived=true', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ school: { findMany } });
    const token = await superadminToken();
    await app.request(
      '/api/schools?includeArchived=true',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: true } })
    );
  });

  it('orders schools by name asc', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const app = mountApp({ school: { findMany } });
    const token = await superadminToken();
    await app.request(
      '/api/schools',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: { name: 'asc' } })
    );
  });

  it('returns 500 on prisma failure', async () => {
    const findMany = vi.fn().mockRejectedValue(new Error('boom'));
    const app = mountApp({ school: { findMany } });
    const token = await superadminToken();
    const res = await app.request(
      '/api/schools',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(500);
  });
});

describe('GET /api/schools/archived', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always filters to isArchived: true', async () => {
    const findMany = vi.fn().mockResolvedValue([{ id: 's1' }]);
    const app = mountApp({ school: { findMany } });
    const token = await superadminToken();
    const res = await app.request(
      '/api/schools/archived',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: true } })
    );
    expect(await res.json()).toEqual([{ id: 's1' }]);
  });

  it('rejects non-SUPERADMIN', async () => {
    const app = mountApp({ school: { findMany: vi.fn() } });
    const token = await teacherToken();
    const res = await app.request(
      '/api/schools/archived',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(403);
  });
});

describe('GET /api/schools/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns the school with classes and counts', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 's1',
      name: 'A',
      classes: [],
      _count: { classes: 0, studentSchools: 0, teacherSchools: 0 },
    });
    const app = mountApp({ school: { findUnique } });
    const token = await superadminToken();
    const res = await app.request(
      '/api/schools/s1',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 's1' } })
    );
  });

  it('returns 404 when school not found', async () => {
    const app = mountApp({ school: { findUnique: vi.fn().mockResolvedValue(null) } });
    const token = await superadminToken();
    const res = await app.request(
      '/api/schools/missing',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
  });
});

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

describe('POST /api/schools', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects empty name with 400', async () => {
    const findFirst = vi.fn();
    const create = vi.fn();
    const app = mountApp({ school: { findFirst, create } });
    const token = await superadminToken();
    const res = await postJson(app, '/api/schools', { name: '' }, token);
    expect(res.status).toBe(400);
    expect(create).not.toHaveBeenCalled();
  });

  it('returns 400 when school name already exists (case-insensitive)', async () => {
    const findFirst = vi.fn().mockResolvedValue({ id: 's-existing', name: 'A' });
    const create = vi.fn();
    const app = mountApp({ school: { findFirst, create } });
    const token = await superadminToken();
    const res = await postJson(app, '/api/schools', { name: 'a' }, token);
    expect(res.status).toBe(400);
    expect(findFirst).toHaveBeenCalledWith({
      where: { name: { equals: 'a', mode: 'insensitive' } },
    });
    expect(create).not.toHaveBeenCalled();
  });

  it('creates and returns 201 on success', async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const create = vi.fn().mockResolvedValue({ id: 's-new', name: 'New School' });
    const app = mountApp({ school: { findFirst, create } });
    const token = await superadminToken();
    const res = await postJson(app, '/api/schools', { name: '  New School  ' }, token);
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith({ data: { name: 'New School' } });
  });

  it('returns 403 for TEACHER', async () => {
    const app = mountApp({ school: { findFirst: vi.fn(), create: vi.fn() } });
    const token = await teacherToken();
    const res = await postJson(app, '/api/schools', { name: 'X' }, token);
    expect(res.status).toBe(403);
  });
});

describe('PUT /api/schools/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const app = mountApp({ school: { findUnique, findFirst: vi.fn(), update: vi.fn() } });
    const token = await superadminToken();
    const res = await putJson(app, '/api/schools/missing', { name: 'X' }, token);
    expect(res.status).toBe(404);
  });

  it('returns 400 when new name conflicts with another school', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1', name: 'Old' });
    const findFirst = vi.fn().mockResolvedValue({ id: 's2', name: 'New' });
    const update = vi.fn();
    const app = mountApp({ school: { findUnique, findFirst, update } });
    const token = await superadminToken();
    const res = await putJson(app, '/api/schools/s1', { name: 'New' }, token);
    expect(res.status).toBe(400);
    expect(update).not.toHaveBeenCalled();
  });

  it('updates the name and returns the row', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1' });
    const findFirst = vi.fn().mockResolvedValue(null);
    const update = vi.fn().mockResolvedValue({ id: 's1', name: 'Renamed' });
    const app = mountApp({ school: { findUnique, findFirst, update } });
    const token = await superadminToken();
    const res = await putJson(app, '/api/schools/s1', { name: '  Renamed  ' }, token);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { name: 'Renamed' },
    });
  });

  it('returns existing row when no fields are provided', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1', name: 'Same' });
    const update = vi.fn();
    const app = mountApp({ school: { findUnique, findFirst: vi.fn(), update } });
    const token = await superadminToken();
    const res = await putJson(app, '/api/schools/s1', {}, token);
    expect(res.status).toBe(200);
    expect(update).not.toHaveBeenCalled();
  });
});

describe('POST /api/schools/:id/archive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const app = mountApp({ school: { findUnique } });
    const token = await superadminToken();
    const res = await postJson(app, '/api/schools/missing/archive', {}, token);
    expect(res.status).toBe(404);
  });

  it('archives school + classes; archives students with no other active school', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1' });
    const txOps = {
      school: { update: vi.fn().mockResolvedValue({}) },
      class: { updateMany: vi.fn().mockResolvedValue({ count: 2 }) },
      studentSchool: {
        findMany: vi.fn().mockResolvedValue([{ studentId: 'st1' }, { studentId: 'st2' }]),
        // st1 has another active school, st2 does not
        count: vi.fn()
          .mockResolvedValueOnce(1) // st1 -> 1 active elsewhere
          .mockResolvedValueOnce(0), // st2 -> 0 active elsewhere
      },
      user: { update: vi.fn().mockResolvedValue({}) },
    };
    const app = mountApp({
      school: { findUnique },
      $transaction: vi.fn(async (cb: (tx: typeof txOps) => Promise<unknown>) => cb(txOps)),
    });
    const token = await superadminToken();
    const res = await postJson(app, '/api/schools/s1/archive', {}, token);
    expect(res.status).toBe(200);
    expect(txOps.school.update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { isArchived: true },
    });
    expect(txOps.class.updateMany).toHaveBeenCalledWith({
      where: { schoolId: 's1' },
      data: { isArchived: true },
    });
    // Only st2 should be archived (st1 has another active school)
    expect(txOps.user.update).toHaveBeenCalledTimes(1);
    expect(txOps.user.update).toHaveBeenCalledWith({
      where: { id: 'st2' },
      data: { isArchived: true },
    });
  });
});

describe('POST /api/schools/:id/unarchive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const app = mountApp({ school: { findUnique } });
    const token = await superadminToken();
    const res = await postJson(app, '/api/schools/missing/unarchive', {}, token);
    expect(res.status).toBe(404);
  });

  it('unarchives the school', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 's1' });
    const update = vi.fn().mockResolvedValue({ id: 's1' });
    const app = mountApp({ school: { findUnique, update } });
    const token = await superadminToken();
    const res = await postJson(app, '/api/schools/s1/unarchive', {}, token);
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 's1' },
      data: { isArchived: false },
    });
  });
});

describe('DELETE /api/schools/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const del = vi.fn();
    const app = mountApp({ school: { findUnique, delete: del } });
    const token = await superadminToken();
    const res = await app.request(
      '/api/schools/missing',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
  });

  it('rejects deletion when school has any associations', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 's1',
      _count: { classes: 1, studentSchools: 0, teacherSchools: 0, adminSchools: 0 },
    });
    const del = vi.fn();
    const app = mountApp({ school: { findUnique, delete: del } });
    const token = await superadminToken();
    const res = await app.request(
      '/api/schools/s1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
    expect(del).not.toHaveBeenCalled();
  });

  it('deletes when there are no associations', async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: 's1',
      _count: { classes: 0, studentSchools: 0, teacherSchools: 0, adminSchools: 0 },
    });
    const del = vi.fn().mockResolvedValue({ id: 's1' });
    const app = mountApp({ school: { findUnique, delete: del } });
    const token = await superadminToken();
    const res = await app.request(
      '/api/schools/s1',
      { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({ where: { id: 's1' } });
  });
});
