import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import notifications from './notifications';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/notifications', notifications);
  return app;
}

async function validToken(userId = 'user-1', role = 'TEACHER') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId, role, exp }, SECRET, 'HS256');
}

describe('GET /api/notifications', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when no Authorization header is sent', async () => {
    const app = mountApp({ notification: { findMany: vi.fn() } });
    const res = await app.request('/api/notifications', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns the authenticated user\'s notifications ordered by createdAt desc', async () => {
    const findMany = vi.fn().mockResolvedValue([
      { id: 'n1', userId: 'user-1', status: 'UNREAD', createdAt: new Date('2026-04-10T10:00:00Z') },
      { id: 'n2', userId: 'user-1', status: 'READ', createdAt: new Date('2026-04-09T10:00:00Z') },
    ]);
    const app = mountApp({ notification: { findMany } });

    const token = await validToken();
    const res = await app.request(
      '/api/notifications',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(findMany).toHaveBeenCalledWith({
      where: { userId: 'user-1' },
      orderBy: { createdAt: 'desc' },
    });
  });

  it('returns an empty array when user has no notifications', async () => {
    const app = mountApp({ notification: { findMany: vi.fn().mockResolvedValue([]) } });
    const token = await validToken();
    const res = await app.request(
      '/api/notifications',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('returns 500 when the prisma query throws', async () => {
    const app = mountApp({
      notification: { findMany: vi.fn().mockRejectedValue(new Error('boom')) },
    });
    const token = await validToken();
    const res = await app.request(
      '/api/notifications',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      message: 'Server error while retrieving notifications',
    });
  });

  it('returns 500 when no prisma client is on the context', async () => {
    // Mount without setting c.var.prisma
    const app = new Hono<AppBindings>();
    app.route('/api/notifications', notifications);
    const token = await validToken();
    const res = await app.request(
      '/api/notifications',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(500);
  });
});
