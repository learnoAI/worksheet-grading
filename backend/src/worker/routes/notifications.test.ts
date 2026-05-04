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

describe('PUT /api/notifications/:id/read', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({
      notification: { findUnique: vi.fn(), update: vi.fn() },
    });
    const res = await app.request(
      '/api/notifications/n1/read',
      { method: 'PUT' },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
  });

  it('returns 404 when the notification does not exist', async () => {
    const findUnique = vi.fn().mockResolvedValue(null);
    const update = vi.fn();
    const app = mountApp({ notification: { findUnique, update } });
    const token = await validToken();
    const res = await app.request(
      '/api/notifications/missing/read',
      { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
    expect(update).not.toHaveBeenCalled();
  });

  it('returns 403 when the notification belongs to a different user', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'n1', userId: 'other-user' });
    const update = vi.fn();
    const app = mountApp({ notification: { findUnique, update } });
    const token = await validToken('user-1');
    const res = await app.request(
      '/api/notifications/n1/read',
      { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(403);
    expect(update).not.toHaveBeenCalled();
  });

  it('marks the notification as read and returns the updated row', async () => {
    const findUnique = vi.fn().mockResolvedValue({ id: 'n1', userId: 'user-1' });
    const update = vi.fn().mockResolvedValue({ id: 'n1', userId: 'user-1', status: 'READ' });
    const app = mountApp({ notification: { findUnique, update } });
    const token = await validToken('user-1');
    const res = await app.request(
      '/api/notifications/n1/read',
      { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'n1' },
      data: { status: 'READ' },
    });
    expect(await res.json()).toMatchObject({ id: 'n1', status: 'READ' });
  });
});

describe('PUT /api/notifications/read-all', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ notification: { updateMany: vi.fn() } });
    const res = await app.request(
      '/api/notifications/read-all',
      { method: 'PUT' },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
  });

  it('updates only the authenticated user\'s unread notifications', async () => {
    const updateMany = vi.fn().mockResolvedValue({ count: 3 });
    const app = mountApp({ notification: { updateMany } });
    const token = await validToken('user-1');
    const res = await app.request(
      '/api/notifications/read-all',
      { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(updateMany).toHaveBeenCalledWith({
      where: { userId: 'user-1', status: 'UNREAD' },
      data: { status: 'READ' },
    });
    expect(await res.json()).toEqual({ message: 'All notifications marked as read' });
  });

  it('is matched before the /:id/read dynamic route', async () => {
    // Sanity check: requesting /api/notifications/read-all should hit the
    // bulk endpoint, not be interpreted as /:id/read with id="read-all".
    const findUnique = vi.fn();
    const updateMany = vi.fn().mockResolvedValue({ count: 0 });
    const app = mountApp({ notification: { findUnique, updateMany } });
    const token = await validToken('user-1');
    const res = await app.request(
      '/api/notifications/read-all',
      { method: 'PUT', headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(findUnique).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalled();
  });
});
