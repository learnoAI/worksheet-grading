import { describe, expect, it } from 'vitest';
import { app } from './index';

describe('hono worker', () => {
  it('GET /health returns 200 ok', async () => {
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });

  it('GET / returns a greeting', async () => {
    const res = await app.request('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('AssessWise API');
  });

  it('GET /missing falls through to the Express fallback (or 404 when unset)', async () => {
    // No EXPRESS_FALLBACK_URL in env → the fallback responds 404 with a
    // configuration-hint message. This proves the catch-all is wired.
    const res = await app.request('/missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('EXPRESS_FALLBACK_URL');
  });
});
