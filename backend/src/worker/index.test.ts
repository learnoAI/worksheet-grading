import { describe, expect, it } from 'vitest';
import app from './index';

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

  it('GET /missing returns 404 json', async () => {
    const res = await app.request('/missing');
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not Found' });
  });
});
