import type { Context } from 'hono';

/**
 * Schedule a fire-and-forget side effect tied to the request lifetime.
 *
 * `c.executionCtx` is the Workers `ExecutionContext` whose `waitUntil`
 * extends the request so async work (PostHog ingest, Prisma disconnect,
 * audit logs) can finish after the response is sent without blocking
 * the user. Two gotchas this helper papers over:
 *
 *   1. Reading `c.executionCtx` THROWS a TypeError when no Workers
 *      context is bound (e.g. unit tests via `app.request(...)`).
 *      Optional chaining (`c.executionCtx?.waitUntil(...)`) does NOT
 *      catch that throw — the property access happens before the `?.`.
 *      Use try/catch around the read.
 *   2. When no context is available, fall back to awaiting the promise
 *      so tests still observe completion. In production every request
 *      has a context, so this branch is test-only.
 *
 * Pattern lifted from `worker/middleware/db.ts:40-55` (the disconnect
 * scheduler) — kept identical so behaviour stays uniform across the
 * worker.
 */
export async function safeWaitUntil(
  c: Context,
  p: Promise<unknown>
): Promise<void> {
  try {
    const ctx = c.executionCtx;
    if (ctx && typeof ctx.waitUntil === 'function') {
      ctx.waitUntil(p);
      return;
    }
  } catch {
    // No execution context bound — fall through to await.
  }
  await p;
}
