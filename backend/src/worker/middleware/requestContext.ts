import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types';

function makeRequestId(): string {
  // Worker runtime always has Web Crypto (nodejs_compat flag also provides it).
  return crypto.randomUUID();
}

/**
 * Headers that identify a trusted internal caller (another CF worker
 * authenticating with a shared secret). Requests carrying one of these are
 * allowed to dictate `X-Request-Id` verbatim so server-to-server tracing
 * stays clean. Keep in sync with `middleware/workerTokens.ts`.
 */
const INTERNAL_CALLER_HEADERS = ['X-Grading-Worker-Token', 'X-Worksheet-Creation-Token'];

/** Prefix stamped onto inbound IDs from untrusted (external) callers. */
const EXTERNAL_REQUEST_ID_PREFIX = 'ext:';

/**
 * Injects a stable request ID for the lifetime of a request.
 *
 * Behavior:
 *   - From a trusted internal caller (presents a known worker-token header):
 *     honor a sane inbound `X-Request-Id` verbatim for end-to-end tracing.
 *   - From any other caller: prefix a sane inbound `X-Request-Id` with
 *     `ext:` so external IDs cannot collide with — and thereby poison log
 *     correlation for — internally generated UUIDs. Falls back to a fresh
 *     UUID when the header is missing or malformed.
 *   - Stores the chosen ID in `c.var.requestId` for downstream handlers and
 *     on the response as `X-Request-Id` so clients can surface it.
 *
 * WHY prefix instead of dropping: the worker is internet-facing, so any
 * caller can set `X-Request-Id`. Trusting it lets attackers fabricate IDs
 * that look like our internal UUIDs and poison log searches. Dropping it
 * outright loses the legitimate frontend/proxy correlation use case;
 * namespacing keeps that signal while making the trust boundary explicit.
 *
 * Unlike the Express version, we do not use `AsyncLocalStorage` here — Hono
 * middleware closes over `c`, and deeper code paths receive the context
 * directly. This keeps the worker bundle small and isolate-friendly.
 */
export const requestContext: MiddlewareHandler<AppBindings> = async (c, next) => {
  const inbound = c.req.header('X-Request-Id');
  const isInternalCaller = INTERNAL_CALLER_HEADERS.some((h) => Boolean(c.req.header(h)));
  const requestId = chooseRequestId(inbound, isInternalCaller);

  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);
  // Overwrite the inbound header on the *request* too, so any downstream
  // proxy (e.g. `fallback.ts`) that copies request headers forwards the
  // worker-chosen ID rather than the raw external one.
  c.req.raw.headers.set('X-Request-Id', requestId);

  await next();
};

function chooseRequestId(inbound: string | undefined, isInternalCaller: boolean): string {
  // Strip any existing external prefix before validating, so an already
  // namespaced ID arriving via re-entry (e.g. fallback hop) doesn't fail
  // validation just because of the colon.
  const stripped = inbound?.startsWith(EXTERNAL_REQUEST_ID_PREFIX)
    ? inbound.slice(EXTERNAL_REQUEST_ID_PREFIX.length)
    : inbound;
  if (!isLikelyRequestId(stripped)) return makeRequestId();
  if (isInternalCaller) return stripped!;
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
