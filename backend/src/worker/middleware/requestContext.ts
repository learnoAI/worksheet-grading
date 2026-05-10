import type { MiddlewareHandler } from 'hono';
import type { AppBindings, WorkerEnv } from '../types';
import { capturePosthogEvent } from '../adapters/posthog';
import { summarizeRequestBodyShape } from '../adapters/gradingDiagnostics';
import { safeWaitUntil } from '../lib/safeWaitUntil';

function makeRequestId(): string {
  // Worker runtime always has Web Crypto (nodejs_compat flag also provides it).
  return crypto.randomUUID();
}

/** Prefix stamped onto every inbound id so external values cannot collide
 * with internally-generated UUIDs. */
const EXTERNAL_REQUEST_ID_PREFIX = 'ext:';

/** Sample rate for 4xx responses — full telemetry on 4xx is noisy in prod
 * because of legitimate client-side validation, so we record a representative
 * slice and rely on PostHog trends to catch spikes from a broken client
 * release. Mirrors Express `requestDiagnostics.ts:12`. */
const CLIENT_ERROR_SAMPLE_RATE = 0.1;

const DEFAULT_SLOW_REQUEST_MS = 1500;

/**
 * Injects a stable request ID for the lifetime of a request, AND emits the
 * `backend_request_diagnostic` / `backend_request_client_error` PostHog
 * events that Express's `requestDiagnostics` middleware fired. Dashboards
 * keyed on these event names keep working post-cutover.
 *
 * Behavior:
 *   - Every sane inbound `X-Request-Id` is prefixed with `ext:`. There is
 *     no "trusted caller" branch — see WHY below.
 *   - Falls back to a fresh UUID when the header is missing or malformed.
 *   - Stores the chosen ID in `c.var.requestId` for downstream handlers
 *     and on the response as `X-Request-Id` for clients.
 *   - After `next()` returns, fires diagnostics events for slow / 5xx /
 *     sampled-4xx responses. Workers can't observe client aborts (no
 *     analogue to Express's `res.on('close')`), so the `aborted=true`
 *     branch is dropped — see `parity-gaps/02-out-of-scope.md`.
 *
 * WHY always prefix request IDs: the worker is internet-facing, so any
 * caller can set `X-Request-Id`. Branching on the *presence* of an
 * internal-token header to skip the prefix is bypassable — anyone can
 * include `X-Grading-Worker-Token: anything` and the actual secret check
 * happens later at protected routes. Always prefixing makes the
 * namespacing guarantee unconditional: if a log line shows an id without
 * `ext:`, the worker generated it. Internal callers that want correlation
 * can strip the prefix on receipt.
 *
 * Unlike the Express version, we do not use `AsyncLocalStorage` here — Hono
 * middleware closes over `c`, and deeper code paths receive the context
 * directly. This keeps the worker bundle small and isolate-friendly.
 */
export const requestContext: MiddlewareHandler<AppBindings> = async (c, next) => {
  const inbound = c.req.header('X-Request-Id');
  const requestId = chooseRequestId(inbound);

  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);
  // NOTE: we deliberately do NOT mutate `c.req.raw.headers` here. In the
  // Cloudflare Workers runtime the inbound `Request.headers` is immutable
  // (per the WHATWG Fetch spec) and `set()` throws. The fallback proxy
  // reads `c.var.requestId` directly — see `fallback.ts`.

  // Clone the body BEFORE next() so the route's `c.req.json()` still has
  // an unconsumed stream. The clone gives us a fresh stream we can read
  // post-next for the body-shape summary on /grading paths.
  const path = new URL(c.req.url).pathname;
  const isGradingPath = path.includes('/grading');
  const bodyClonePromise = isGradingPath
    ? cloneBody(c.req.raw)
    : undefined;

  const startedAt = Date.now();
  await next();
  const durationMs = Date.now() - startedAt;

  await emitDiagnostics(c, requestId, path, durationMs, bodyClonePromise);
};

async function cloneBody(req: Request): Promise<unknown> {
  // Best-effort clone — fails open. GET/HEAD requests have no body, but
  // .clone() handles that gracefully (returns a Request with null body).
  try {
    const cloned = req.clone();
    if (cloned.body === null) return undefined;
    return await cloned.json().catch(() => undefined);
  } catch {
    return undefined;
  }
}

async function emitDiagnostics(
  c: Parameters<MiddlewareHandler<AppBindings>>[0],
  requestId: string,
  path: string,
  durationMs: number,
  bodyClonePromise: Promise<unknown> | undefined
): Promise<void> {
  const env = (c.env ?? {}) as WorkerEnv;
  // Express defaults to enabled; honor the `'false'` literal as the only
  // off-switch (matches `parseBoolean` in `backend/src/config/env.ts`).
  if (env.REQUEST_DIAGNOSTICS_ENABLED === 'false') return;

  const slowMs = parsePositiveInt(env.REQUEST_DIAGNOSTICS_SLOW_MS, DEFAULT_SLOW_REQUEST_MS);
  const statusCode = c.res.status;

  const isSlow = durationMs >= slowMs;
  const isServerError = statusCode >= 500;
  const isClientError = statusCode >= 400 && statusCode < 500;

  if (!isSlow && !isServerError && !isClientError) return;

  const payload: Record<string, unknown> = {
    requestId,
    method: c.req.method,
    path,
    statusCode,
    durationMs,
    aborted: false, // Workers can't detect client aborts — see middleware comment.
    category: getCategory(path),
    contentLength: c.req.header('content-length'),
  };

  // Surface route params if the matched route exposes them. `c.req.param`
  // returns the parsed value or undefined; matches Express's `req.params`
  // lookup at requestDiagnostics.ts:75-81.
  const jobId = c.req.param('jobId');
  if (typeof jobId === 'string') payload.jobId = jobId;
  const classId = c.req.param('classId');
  if (typeof classId === 'string') payload.classId = classId;

  if (bodyClonePromise) {
    const body = await bodyClonePromise;
    if (body !== undefined) {
      payload.requestBodySummary = summarizeRequestBodyShape(body);
    }
  }

  if (isClientError) {
    // 10% sample so legitimate client-side validation errors don't drown
    // the telemetry, while spikes from a broken client release stay visible.
    if (Math.random() < CLIENT_ERROR_SAMPLE_RATE) {
      await safeWaitUntil(
        c,
        capturePosthogEvent(env, 'backend_request_client_error', requestId, {
          ...payload,
          sampleRate: CLIENT_ERROR_SAMPLE_RATE,
        })
      );
    }
    return;
  }

  await safeWaitUntil(
    c,
    capturePosthogEvent(env, 'backend_request_diagnostic', requestId, {
      ...payload,
      diagnosticType: isServerError ? 'server_error' : 'slow_request',
    })
  );
}

function getCategory(path: string): string {
  if (path.startsWith('/internal/grading-worker/')) return 'internal_grading_worker';
  if (path.startsWith('/api/grading-jobs/')) return 'grading_jobs_api';
  if (path.startsWith('/api/worksheet-processing/')) return 'worksheet_processing_api';
  if (path.startsWith('/api/analytics/')) return 'analytics_api';
  return 'other';
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function chooseRequestId(inbound: string | undefined): string {
  // Strip any existing external prefix before validating, so an already
  // namespaced ID arriving via re-entry (e.g. fallback hop) doesn't fail
  // validation just because of the colon.
  const stripped = inbound?.startsWith(EXTERNAL_REQUEST_ID_PREFIX)
    ? inbound.slice(EXTERNAL_REQUEST_ID_PREFIX.length)
    : inbound;
  if (!isLikelyRequestId(stripped)) return makeRequestId();
  return `${EXTERNAL_REQUEST_ID_PREFIX}${stripped!}`;
}

function isLikelyRequestId(value: string | undefined): boolean {
  if (!value) return false;
  // 128 leaves comfortable headroom under typical 8KB header-line limits
  // even after the `ext:` prefix is added.
  if (value.length > 128) return false;
  // Allow UUIDs, ULIDs, nanoid-style IDs — anything alphanumeric with dashes/underscores.
  return /^[A-Za-z0-9_-]+$/.test(value);
}
