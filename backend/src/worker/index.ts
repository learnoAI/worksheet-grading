import { Hono } from 'hono';
import type { AppBindings } from './types';
import { corsMiddleware } from './middleware/cors';
import { requestContext } from './middleware/requestContext';
import { withDb } from './middleware/db';
import authRoutes from './routes/auth';
import notificationRoutes from './routes/notifications';
import schoolRoutes from './routes/schools';
import userRoutes from './routes/users';
import classRoutes from './routes/classes';
import {
  worksheetTemplateReadRoutes,
  mathSkillReadRoutes,
  worksheetCurriculumReadRoutes,
} from './routes/worksheetTemplates';
import masteryRoutes from './routes/mastery';
import analyticsRoutes from './routes/analytics';
import internalWorksheetGenerationRoutes from './routes/internalWorksheetGeneration';
import worksheetRoutes from './routes/worksheets';
import worksheetProcessingRoutes from './routes/worksheetProcessing';
import { expressFallback } from './fallback';

const app = new Hono<AppBindings>();

// Ordering matters: requestContext first so the ID is available in CORS/other logs.
app.use('*', requestContext);
app.use('*', corsMiddleware());
app.use('*', withDb);

app.get('/health', (c) => c.json({ status: 'ok' }));

app.get('/', (c) => c.text('AssessWise API (hono worker)'));

app.route('/api/auth', authRoutes);
app.route('/api/notifications', notificationRoutes);
app.route('/api/schools', schoolRoutes);
app.route('/api/users', userRoutes);
app.route('/api/classes', classRoutes);
app.route('/api/worksheet-templates', worksheetTemplateReadRoutes);
app.route('/api/math-skills', mathSkillReadRoutes);
app.route('/api/worksheet-curriculum', worksheetCurriculumReadRoutes);
app.route('/api/mastery', masteryRoutes);
app.route('/api/analytics', analyticsRoutes);
app.route('/internal/worksheet-generation', internalWorksheetGenerationRoutes);
app.route('/api/worksheets', worksheetRoutes);
app.route('/api/worksheet-processing', worksheetProcessingRoutes);

// Catch-all fallback: any path not handled above is proxied to the Express
// service. Must stay LAST. Once Phase 5.13 lands and every route is on
// Hono, unset `EXPRESS_FALLBACK_URL` (the fallback then returns 404 for
// unknown paths, which is the desired terminal behavior).
app.all('*', expressFallback());

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

app.onError((err, c) => {
  console.error('[worker] unhandled error:', err);
  return c.json({ error: 'Internal Server Error' }, 500);
});

export default app;
