/**
 * Workers-native PostHog event capture.
 *
 * The Express version (`services/posthogService.ts`) adds Node-only bits
 * (`os.hostname()`, module-level counters, retry/backoff tied to the request
 * context ALS). The worker needs a slimmer surface: "POST an event, don't
 * throw, retry on transient failure". Analytics must never break user
 * traffic, so every failure is swallowed and logged to `console`.
 *
 * Mirror shape of Express payload so dashboards see a unified event stream:
 *   { api_key, event, distinct_id, properties, timestamp }
 */

export interface PosthogEnv {
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
  NODE_ENV?: string;
  GIT_SHA?: string;
  RELEASE?: string;
  [k: string]: unknown;
}

export interface PosthogCaptureOptions {
  /** Override the capture host. Defaults to `env.POSTHOG_HOST` or us.i.posthog.com. */
  host?: string;
  /** Total attempts including the first. Defaults to 3. */
  maxRetries?: number;
  /** Base delay for exponential backoff between retries (ms). Defaults to 500. */
  baseDelayMs?: number;
  /** Per-request timeout (ms). Defaults to 5000 — analytics should be fast or skipped. */
  timeoutMs?: number;
}

const DEFAULT_HOST = 'https://us.i.posthog.com';
const CAPTURE_PATH = '/capture/';
const SERVICE_NAME = 'worksheet-grading-backend';

function processMetadata(env: PosthogEnv): Record<string, unknown> {
  return {
    service: SERVICE_NAME,
    environment: env.NODE_ENV || 'production',
    release: env.GIT_SHA || env.RELEASE || 'unknown',
  };
}

function sanitize(properties: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(properties)) {
    if (v === undefined) continue;
    if (v instanceof Date) {
      out[k] = v.toISOString();
    } else {
      out[k] = v;
    }
  }
  return out;
}

function isEnabled(env: PosthogEnv): boolean {
  return Boolean(env.POSTHOG_API_KEY);
}

async function postJsonWithRetry(
  url: string,
  body: unknown,
  options: Required<Pick<PosthogCaptureOptions, 'maxRetries' | 'baseDelayMs' | 'timeoutMs'>>
): Promise<boolean> {
  for (let attempt = 0; attempt < options.maxRetries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (res.ok) return true;

      // 5xx / 429 — retry. 4xx (other) is terminal; no retry.
      if (!(res.status === 408 || res.status === 429 || (res.status >= 500 && res.status < 600))) {
        return false;
      }
    } catch {
      // Network error / timeout — retriable.
      clearTimeout(timer);
    }
    if (attempt < options.maxRetries - 1) {
      await new Promise((r) => setTimeout(r, options.baseDelayMs * 2 ** attempt));
    }
  }
  return false;
}

/**
 * Fire-and-forget event capture. Never throws: callers should pass this
 * into `ctx.waitUntil` so the Worker runtime keeps the request alive until
 * the capture completes. If that is not convenient, awaiting is safe too
 * because errors are swallowed.
 */
export async function capturePosthogEvent(
  env: PosthogEnv,
  event: string,
  distinctId: string,
  properties: Record<string, unknown> = {},
  options: PosthogCaptureOptions = {}
): Promise<void> {
  if (!isEnabled(env)) return;

  const host = (options.host || env.POSTHOG_HOST || DEFAULT_HOST).replace(/\/+$/, '');
  const url = host + CAPTURE_PATH;
  const body = {
    api_key: env.POSTHOG_API_KEY,
    event,
    distinct_id: distinctId,
    properties: sanitize({ ...processMetadata(env), ...properties }),
    timestamp: new Date().toISOString(),
  };

  const opts = {
    maxRetries: options.maxRetries ?? 3,
    baseDelayMs: options.baseDelayMs ?? 500,
    timeoutMs: options.timeoutMs ?? 5000,
  };

  const ok = await postJsonWithRetry(url, body, opts);
  if (!ok) {
    console.warn('[posthog] capture failed after retries:', { event, distinctId });
  }
}

/**
 * Convenience: capture an exception alongside the standard PostHog
 * `$exception` event. Never throws — mirrors the Express helper name.
 */
export async function capturePosthogException(
  env: PosthogEnv,
  error: unknown,
  context: { distinctId: string; stage?: string; extra?: Record<string, unknown> }
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? error.stack : undefined;
  await capturePosthogEvent(env, '$exception', context.distinctId, {
    $exception_message: message,
    $exception_stack_trace_raw: stack,
    stage: context.stage,
    ...(context.extra ?? {}),
  });
}
