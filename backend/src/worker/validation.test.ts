import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { z } from 'zod';
import { validateJson, validateParams, validateQuery } from './validation';
import type { AppBindings } from './types';

describe('validateJson', () => {
  const schema = z.object({
    username: z.string().min(1),
    password: z.string().min(1),
  });

  function buildApp() {
    const app = new Hono<AppBindings>();
    app.post('/login', validateJson(schema), (c) => c.json(c.req.valid('json')));
    return app;
  }

  it('returns 400 with structured errors when body is missing required fields', async () => {
    const app = buildApp();
    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: '' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Array<{ path: string; location: string }> };
    expect(body.errors).toBeDefined();
    const paths = body.errors.map((e) => e.path);
    expect(paths).toContain('username');
    expect(paths).toContain('password');
    expect(body.errors[0].location).toBe('json');
  });

  it('returns 400 when JSON is not parseable', async () => {
    const app = buildApp();
    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not json',
    });
    expect(res.status).toBe(400);
  });

  it('passes validated payload to the handler on success', async () => {
    const app = buildApp();
    const res = await app.request('/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'pw' }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ username: 'alice', password: 'pw' });
  });
});

describe('validateQuery', () => {
  const schema = z.object({
    page: z.coerce.number().int().positive(),
  });

  function buildApp() {
    const app = new Hono<AppBindings>();
    app.get('/list', validateQuery(schema), (c) => c.json(c.req.valid('query')));
    return app;
  }

  it('rejects missing required query param', async () => {
    const app = buildApp();
    const res = await app.request('/list');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Array<{ path: string; location: string }> };
    expect(body.errors[0].location).toBe('query');
  });

  it('coerces and passes validated query to handler', async () => {
    const app = buildApp();
    const res = await app.request('/list?page=3');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ page: 3 });
  });

  it('rejects non-numeric query param', async () => {
    const app = buildApp();
    const res = await app.request('/list?page=abc');
    expect(res.status).toBe(400);
  });
});

describe('validateParams', () => {
  const schema = z.object({
    id: z.uuid(),
  });

  function buildApp() {
    const app = new Hono<AppBindings>();
    app.get('/users/:id', validateParams(schema), (c) => c.json(c.req.valid('param')));
    return app;
  }

  it('rejects a non-UUID path param', async () => {
    const app = buildApp();
    const res = await app.request('/users/not-a-uuid');
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errors: Array<{ path: string; location: string }> };
    expect(body.errors[0].location).toBe('param');
    expect(body.errors[0].path).toBe('id');
  });

  it('accepts a valid UUID', async () => {
    const app = buildApp();
    const res = await app.request('/users/550e8400-e29b-41d4-a716-446655440000');
    expect(res.status).toBe(200);
  });
});
