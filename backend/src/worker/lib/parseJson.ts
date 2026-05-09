import type { Context } from 'hono';
import { capturePosthogEvent } from '../adapters/posthog';
import { safeWaitUntil } from './safeWaitUntil';

/**
 * Parse the request JSON body. On SyntaxError, fires
 * `backend_request_body_parse_error` to PostHog and returns `undefined`
 * so the caller can return its own (route-specific) 400 message.
 *
 * Mirrors Express's global error middleware at `backend/src/index.ts:75-105`,
 * where `express.json()` threw `SyntaxError` on malformed input and the
 * middleware caught it and fired this event before responding 400. Hono
 * routes parse JSON locally, so we centralise the event emission here
 * — every route migrating to this helper closes one Express-vs-Hono
 * observability gap. Dashboards keyed on
 * `event = 'backend_request_body_parse_error'` keep populating after
 * cutover.
 *
 * Use ONLY when an unparseable body should result in a 400. Routes that
 * deliberately accept a missing/empty body (e.g. mastery generate, the
 * upload-finalize body) should keep their inline try/catch with an empty
 * catch block so they don't emit false-positive parse-error events.
 *
 * Usage:
 * ```ts
 * const body = await tryParseJsonBody<MyShape>(c);
 * if (body === undefined) {
 *   return c.json({ message: 'Invalid request body' }, 400);
 * }
 * ```
 */
export async function tryParseJsonBody<T = unknown>(
  c: Context
): Promise<T | undefined> {
  try {
    return (await c.req.json()) as T;
  } catch (err) {
    const path = new URL(c.req.url).pathname;
    const errorMessage = err instanceof Error ? err.message : String(err);
    // Dual surface: PostHog event for dashboards/alerts; console.warn
    // for the durable log stream oncall greps in `wrangler tail`. Mirrors
    // Express's logging at the global error middleware in
    // `backend/src/index.ts:75-105`, which emitted both the PostHog
    // event AND wrote to the request-diagnostics log.
    console.warn('[parseJson] malformed body', {
      path,
      method: c.req.method,
      errorMessage,
    });
    const env = c.env;
    if (env) {
      const requestId = c.get('requestId') ?? 'unknown';
      await safeWaitUntil(
        c,
        capturePosthogEvent(env, 'backend_request_body_parse_error', requestId, {
          path,
          method: c.req.method,
          errorMessage,
        })
      );
    }
    return undefined;
  }
}
