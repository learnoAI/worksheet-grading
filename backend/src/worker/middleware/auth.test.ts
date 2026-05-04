import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { authenticate, authorize } from './auth';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function buildApp() {
  const app = new Hono<AppBindings>();
  app.use('/protected', authenticate);
  app.get('/protected', (c) => c.json({ user: c.get('user') }));

  app.use('/admin', authenticate, authorize(['SUPERADMIN']));
  app.get('/admin', (c) => c.json({ ok: true }));
  return app;
}

async function makeToken(payload: Record<string, unknown>, secret = SECRET) {
  return sign(payload, secret, 'HS256');
}

describe('authenticate middleware', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const app = buildApp();
    const res = await app.request('/protected', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: 'Authentication required' });
  });

  it('returns 401 when Authorization is not a Bearer token', async () => {
    const app = buildApp();
    const res = await app.request(
      '/protected',
      { headers: { Authorization: 'Basic abc' } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
  });

  it('returns 401 when token is invalid', async () => {
    const app = buildApp();
    const res = await app.request(
      '/protected',
      { headers: { Authorization: 'Bearer not-a-jwt' } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ message: 'Invalid token' });
  });

  it('returns 401 when token is signed with a different secret', async () => {
    const app = buildApp();
    const badToken = await makeToken({ userId: 'u1', role: 'TEACHER' }, 'wrong-secret');
    const res = await app.request(
      '/protected',
      { headers: { Authorization: `Bearer ${badToken}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
  });

  it('returns 500 when JWT_SECRET is not configured', async () => {
    const app = buildApp();
    const token = await makeToken({ userId: 'u1', role: 'TEACHER' });
    const res = await app.request('/protected', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(500);
  });

  it('passes through and sets user on context when token is valid', async () => {
    const app = buildApp();
    const token = await makeToken({ userId: 'u1', role: 'TEACHER' });
    const res = await app.request(
      '/protected',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ user: { userId: 'u1', role: 'TEACHER' } });
  });
});

describe('authorize middleware', () => {
  it('returns 403 when role is not in allowed list', async () => {
    const app = buildApp();
    const token = await makeToken({ userId: 'u1', role: 'TEACHER' });
    const res = await app.request(
      '/admin',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ message: 'Access denied' });
  });

  it('passes through when role is allowed', async () => {
    const app = buildApp();
    const token = await makeToken({ userId: 'u1', role: 'SUPERADMIN' });
    const res = await app.request(
      '/admin',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
  });

  it('returns 401 when authenticate has not run', async () => {
    // Build an app where authorize runs without authenticate to assert the guard.
    const app = new Hono<AppBindings>();
    app.use('/guarded', authorize(['SUPERADMIN']));
    app.get('/guarded', (c) => c.json({ ok: true }));
    const res = await app.request('/guarded');
    expect(res.status).toBe(401);
  });
});
