import { Hono } from 'hono';
import type { AppBindings } from './types';
import { corsMiddleware } from './middleware/cors';
import { requestContext } from './middleware/requestContext';

const app = new Hono<AppBindings>();

// Ordering matters: requestContext first so the ID is available in CORS/other logs.
app.use('*', requestContext);
app.use('*', corsMiddleware());

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/', (c) => c.text('AssessWise API (hono worker)'));

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  console.error('[worker] unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
