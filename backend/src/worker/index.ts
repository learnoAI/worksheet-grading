import { Hono } from 'hono';

type Bindings = Record<string, unknown>;

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/', (c) => c.text('AssessWise API (hono worker)'));

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  console.error('[worker] unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
