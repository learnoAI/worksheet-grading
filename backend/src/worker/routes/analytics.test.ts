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
