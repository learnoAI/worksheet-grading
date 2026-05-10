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
import internalQuestionBankRoutes from './routes/internalQuestionBank';
import internalGradingWorkerRoutes from './routes/internalGradingWorker';
import gradingJobRoutes from './routes/gradingJobs';
import worksheetGenerationRoutes from './routes/worksheetGeneration';
import { expressFallback } from './fallback';
import { capturePosthogException } from './adapters/posthog';
import { safeWaitUntil } from './lib/safeWaitUntil';

/**
 * Hono app. Exported as `app` so tests can call `app.request(...)` without
 * unwrapping the module-syntax `{ fetch, scheduled }` default export that
 * the Workers runtime expects.
 */
export const app = new Hono<AppBindings>();

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
app.route('/internal/question-bank', internalQuestionBankRoutes);
app.route('/internal/grading-worker', internalGradingWorkerRoutes);
app.route('/api/grading-jobs', gradingJobRoutes);
app.route('/api/worksheet-generation', worksheetGenerationRoutes);

// Catch-all fallback: any path not handled above is proxied to the Express
// service. Must stay LAST. Once Phase 5.13 lands and every route is on
// Hono, unset `EXPRESS_FALLBACK_URL` (the fallback then returns 404 for
// unknown paths, which is the desired terminal behavior).
app.all('*', expressFallback());

app.notFound((c) => c.json({ error: 'Not Found' }, 404));

// Match Express's global error middleware response shape so frontend
// code that reads `response.data.message` keeps working after cutover.
// See `backend/src/index.ts`'s `app.use((err, req, res, next) => ...)`.
//
// Also surface the Error to PostHog as a $exception event so 5xxs are
// debuggable end-to-end without grepping `wrangler tail`. Mirrors codex
// 3c23c14 (Express stashes `res.locals.diagnosticsError` and the
// requestDiagnostics middleware logs the stack to app_logs); the Hono
// equivalent lives here because `onError` is the only place we see the
// thrown Error after handler frames unwind.
app.onError((err, c) => {
  console.error('[worker] unhandled error:', err);
  const env = c.env ?? {};
  const requestId = c.get('requestId');
  // capturePosthogException handles its own failures (no rethrow) and
  // no-ops when POSTHOG_API_KEY is unset, so this is safe to leave
  // unawaited — we don't want a slow PostHog hop to delay the 500.
  // `safeWaitUntil` is the workers-runtime-and-test-safe waitUntil
  // wrapper (raw `c.executionCtx?.waitUntil(...)` THROWS in unit tests
  // because reading `executionCtx` itself throws when no Workers ctx is
  // bound — optional chaining doesn't catch it).
  void safeWaitUntil(
    c,
    capturePosthogException(env, err, {
      distinctId: requestId ?? 'unknown',
      stage: 'worker_unhandled_error',
      extra: {
        method: c.req.method,
        path: new URL(c.req.url).pathname,
        requestId,
      },
    })
  );
  return c.json({ message: 'An unexpected error occurred' }, 500);
});

// Default export — HTTP handler only. The grading dispatch loop and its
// cron trigger were removed when the queue path was replaced by
// Cloudflare Workflows: dispatch is synchronous from /finalize via
// `env.GRADING_WORKFLOW.create()`, retries are workflow-managed, and
// orphan-recovery is no longer needed (workflows are durable and report
// back via `/internal/grading-worker/jobs/:id/{complete,fail}`).
export default {
  fetch: app.fetch.bind(app),
};
