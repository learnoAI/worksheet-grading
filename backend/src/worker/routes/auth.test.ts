import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import authRoutes from './auth';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

// Minimal Prisma mock with the shape auth routes expect.
function createMockPrisma(user: unknown) {
  const findUnique = vi.fn().mockResolvedValue(user);
  return {
    client: {
      user: { findUnique },
    },
    findUnique,
  };
}

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/auth', authRoutes);
  return app;
}

const BCRYPT_HASH = bcrypt.hashSync('correct-password', 10);

const BASE_USER = {
  id: 'user-1',
  username: 'alice',
  password: BCRYPT_HASH,
  role: 'TEACHER',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('POST /api/auth/login', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when username is missing', async () => {
    const { client } = createMockPrisma(BASE_USER);
    const app = mountApp(client);

    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'x' }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Array<{ path: string }> };
    expect(body.errors.some((e) => e.path === 'username')).toBe(true);
  });

  it('returns 400 when password is missing', async () => {
    const { client } = createMockPrisma(BASE_USER);
    const app = mountApp(client);
    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice' }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when user is not found', async () => {
    const { client, findUnique } = createMockPrisma(null);
    const app = mountApp(client);
    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'ghost', password: 'x' }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
    expect(findUnique).toHaveBeenCalledWith({ where: { username: 'ghost' } });
  });

  it('returns 401 when password is wrong', async () => {
    const { client } = createMockPrisma(BASE_USER);
    const app = mountApp(client);
    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'bad' }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: 'Invalid credentials' });
  });

  it('returns 200 with user + verifiable JWT on valid credentials', async () => {
    const { client } = createMockPrisma(BASE_USER);
    const app = mountApp(client);
    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'correct-password' }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: Record<string, string>; token: string };
    expect(body.user).toEqual({ id: 'user-1', username: 'alice', role: 'TEACHER' });
    expect(typeof body.token).toBe('string');

    // The issued token must verify under the same secret.
    const { verify } = await import('hono/jwt');
    const payload = (await verify(body.token, SECRET, 'HS256')) as {
      userId: string;
      role: string;
      exp: number;
    };
    expect(payload.userId).toBe('user-1');
    expect(payload.role).toBe('TEACHER');
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('returns 500 when JWT_SECRET is not configured', async () => {
    const { client } = createMockPrisma(BASE_USER);
    const app = mountApp(client);
    const res = await app.request('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'correct-password' }),
    });
    expect(res.status).toBe(500);
  });

  it('returns 500 with a helpful message on PrismaClientInitializationError', async () => {
    const err = new Error('db down');
    err.name = 'PrismaClientInitializationError';
    const findUnique = vi.fn().mockRejectedValue(err);
    const prisma = { user: { findUnique } };
    const app = mountApp(prisma);
    const res = await app.request(
      '/api/auth/login',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'alice', password: 'correct-password' }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(500);
    const body = (await res.json()) as { message: string };
    expect(body.message).toContain('Database connection error');
  });
});

describe('GET /api/auth/me', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 when no Authorization header is sent', async () => {
    const { client } = createMockPrisma(BASE_USER);
    const app = mountApp(client);
    const res = await app.request('/api/auth/me', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is invalid', async () => {
    const { client } = createMockPrisma(BASE_USER);
    const app = mountApp(client);
    const res = await app.request(
      '/api/auth/me',
      { headers: { Authorization: 'Bearer garbage' } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
  });

  it('returns user fields (no password) when token is valid', async () => {
    const { client, findUnique } = createMockPrisma({
      id: 'user-1',
      username: 'alice',
      role: 'TEACHER',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      updatedAt: new Date('2026-01-01T00:00:00Z'),
    });
    const app = mountApp(client);

    const token = await sign(
      { userId: 'user-1', role: 'TEACHER', exp: Math.floor(Date.now() / 1000) + 60 },
      SECRET,
      'HS256'
    );
    const res = await app.request(
      '/api/auth/me',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe('user-1');
    expect(body.username).toBe('alice');
    expect(body.role).toBe('TEACHER');
    expect(body).not.toHaveProperty('password');
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });
  });

  it('returns 404 when user record has been deleted', async () => {
    const { client } = createMockPrisma(null);
    const app = mountApp(client);
    const token = await sign(
      { userId: 'user-1', role: 'TEACHER', exp: Math.floor(Date.now() / 1000) + 60 },
      SECRET,
      'HS256'
    );
    const res = await app.request(
      '/api/auth/me',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
  });
});
