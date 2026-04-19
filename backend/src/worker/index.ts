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
import { expressFallback } from './fallback';
import { createPrismaClient } from './db';
import { dispatchPendingJobs } from './dispatch';
import { capturePosthogEvent, capturePosthogException } from './adapters/posthog';
import type { WorkerEnv } from './types';

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

/**
 * Minimal shape of the `scheduled` event + execution context the Workers
 * runtime passes in. Kept inline to avoid a hard dependency on
 * `@cloudflare/workers-types` — the runtime supplies whatever fields the
 * underlying spec requires, and we only use `waitUntil`.
 */
interface ScheduledEvent {
  cron?: string;
  scheduledTime: number;
}

interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Cron-triggered tick: runs the grading dispatch loop every minute (see
 * `[triggers] crons` in `wrangler.toml`). Replaces the in-process
 * `setInterval` loop the Express backend used. Any structural failure
 * fires a `dispatch_loop_crashed` PostHog event so a silently-dead loop
 * is alertable.
 */
async function runScheduledDispatch(env: WorkerEnv): Promise<void> {
  let prisma;
  try {
    prisma = createPrismaClient(env);
  } catch (error) {
    console.error('[dispatch-loop] cannot build prisma client:', error);
    await capturePosthogEvent(env, 'dispatch_loop_crashed', 'dispatch-loop', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
      stage: 'prisma_init',
    });
    return;
  }

  try {
    const result = await dispatchPendingJobs(prisma, env);
    await capturePosthogEvent(env, 'dispatch_loop_tick', 'dispatch-loop', {
      staleRequeued: result.staleRequeued,
      attempted: result.attempted,
      dispatched: result.dispatched,
      failed: result.failed,
      skippedByBackoff: result.skippedByBackoff,
    });
  } catch (error) {
    // A silently-dead dispatch loop is the worst failure mode in this
    // queue system — every queued job stalls. Emit an explicit event so
    // the first crash is alertable, not just a buried log line.
    console.error('[dispatch-loop] tick crashed:', error);
    await capturePosthogEvent(env, 'dispatch_loop_crashed', 'dispatch-loop', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      errorMessage: error instanceof Error ? error.message : String(error),
    });
    await capturePosthogException(env, error, {
      distinctId: 'dispatch-loop',
      stage: 'dispatch_loop_crashed',
    });
  }
}

// Default export combines the HTTP handler (Hono) with the Cron handler.
// Workers routes HTTP requests through `fetch` and scheduled events
// through `scheduled`. Keeping both in the same worker lets us reuse the
// Prisma + adapter stack without spinning up a second deployment.
export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: WorkerEnv, ctx: ExecutionContext) {
    ctx.waitUntil(runScheduledDispatch(env));
  },
};
