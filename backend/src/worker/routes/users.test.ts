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
