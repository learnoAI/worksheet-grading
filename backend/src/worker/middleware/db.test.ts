import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import type { AppBindings } from '../types';

// Mock createPrismaClient so this test doesn't need the generated client.
const clientsMade: string[] = [];
vi.mock('../db', () => ({
  createPrismaClient: vi.fn((env: { DATABASE_URL?: string }) => {
    clientsMade.push(env.DATABASE_URL ?? '');
    return { __mockClient: true, __createdFrom: env.DATABASE_URL } as unknown;
  }),
}));

import { withDb, __resetDbCacheForTests } from './db';

beforeEach(() => {
  clientsMade.length = 0;
  __resetDbCacheForTests();
});

function buildApp() {
  const app = new Hono<AppBindings>();
  app.use('*', withDb);
  app.get('/ping', (c) => {
    const prisma = c.get('prisma') as unknown as { __mockClient: boolean } | undefined;
    return c.json({ hasPrisma: !!prisma?.__mockClient });
  });
  return app;
}

describe('withDb middleware', () => {
  it('injects a prisma client into c.var when not already set', async () => {
    const app = buildApp();
    const res = await app.request('/ping', {}, { DATABASE_URL: 'postgres://x' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ hasPrisma: true });
    expect(clientsMade).toEqual(['postgres://x']);
  });

  it('reuses the cached client across requests with the same env', async () => {
    const app = buildApp();
    await app.request('/ping', {}, { DATABASE_URL: 'postgres://x' });
    await app.request('/ping', {}, { DATABASE_URL: 'postgres://x' });
    await app.request('/ping', {}, { DATABASE_URL: 'postgres://x' });
    expect(clientsMade.length).toBe(1);
  });

  it('recreates the client when the env signature changes', async () => {
    const app = buildApp();
    await app.request('/ping', {}, { DATABASE_URL: 'postgres://a' });
    await app.request('/ping', {}, { DATABASE_URL: 'postgres://b' });
    expect(clientsMade).toEqual(['postgres://a', 'postgres://b']);
  });

  it('is a no-op when a prisma client is already set on the context', async () => {
    const app = new Hono<AppBindings>();
    const fakePrisma = { __fromTest: true } as unknown;
    app.use('*', async (c, next) => {
      c.set('prisma', fakePrisma as never);
      await next();
    });
    app.use('*', withDb);
    app.get('/ping', (c) => c.json(c.get('prisma') as never));
    const res = await app.request('/ping', {}, { DATABASE_URL: 'postgres://x' });
    expect(await res.json()).toEqual({ __fromTest: true });
    expect(clientsMade).toEqual([]); // factory never called
  });
});
