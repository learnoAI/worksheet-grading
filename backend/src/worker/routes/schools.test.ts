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
