import { describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { corsMiddleware } from './cors';
import type { AppBindings } from '../types';

function buildApp() {
  const app = new Hono<AppBindings>();
  app.use('*', corsMiddleware());
  app.get('/ping', (c) => c.json({ ok: true }));
  return app;
}

describe('corsMiddleware', () => {
  it('reflects origin when CORS_ORIGINS=*', async () => {
    const app = buildApp();
    const res = await app.request(
      '/ping',
      { headers: { Origin: 'https://example.com' } },
      { CORS_ORIGINS: '*' }
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('https://example.com');
    expect(res.headers.get('access-control-allow-credentials')).toBe('true');
  });

  it('allows listed origin when CORS_ORIGINS is an allowlist', async () => {
    const app = buildApp();
    const res = await app.request(
      '/ping',
      { headers: { Origin: 'https://good.com' } },
      { CORS_ORIGINS: 'https://good.com,https://other.com' }
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('https://good.com');
  });

  it('rejects origins not in allowlist', async () => {
    const app = buildApp();
    const res = await app.request(
      '/ping',
      { headers: { Origin: 'https://bad.com' } },
      { CORS_ORIGINS: 'https://good.com' }
    );
    expect(res.headers.get('access-control-allow-origin')).not.toBe('https://bad.com');
  });

  it('responds to OPTIONS preflight with allowed methods and headers', async () => {
    const app = buildApp();
    const res = await app.request(
      '/ping',
      {
        method: 'OPTIONS',
        headers: {
          Origin: 'https://example.com',
          'Access-Control-Request-Method': 'POST',
          'Access-Control-Request-Headers': 'Authorization,Content-Type',
        },
      },
      { CORS_ORIGINS: '*' }
    );
    expect(res.status).toBe(204);
    const allowedMethods = res.headers.get('access-control-allow-methods');
    expect(allowedMethods).toContain('POST');
    expect(allowedMethods).toContain('PATCH');
    const allowedHeaders = res.headers.get('access-control-allow-headers');
    expect(allowedHeaders?.toLowerCase()).toContain('authorization');
    expect(allowedHeaders).toContain('X-Grading-Worker-Token');
  });

  it('uses default allowlist when CORS_ORIGINS is unset', async () => {
    const app = buildApp();
    const res = await app.request(
      '/ping',
      { headers: { Origin: 'http://localhost:3000' } },
      {}
    );
    expect(res.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
  });
});
