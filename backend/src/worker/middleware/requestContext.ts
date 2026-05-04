import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types';

function makeRequestId(): string {
  // Worker runtime always has Web Crypto (nodejs_compat flag also provides it).
  return crypto.randomUUID();
}

/** Prefix stamped onto every inbound id so external values cannot collide
 * with internally-generated UUIDs. */
const EXTERNAL_REQUEST_ID_PREFIX = 'ext:';

/**
 * Injects a stable request ID for the lifetime of a request.
 *
 * Behavior:
 *   - Every sane inbound `X-Request-Id` is prefixed with `ext:`. There is
 *     no "trusted caller" branch — see WHY below.
 *   - Falls back to a fresh UUID when the header is missing or malformed.
 *   - Stores the chosen ID in `c.var.requestId` for downstream handlers,
 *     on the response as `X-Request-Id` for clients, and on
 *     `c.req.raw.headers` so the fallback proxy forwards the worker-
 *     chosen value rather than the raw inbound one.
 *
 * WHY always prefix: the worker is internet-facing, so any caller can set
 * `X-Request-Id`. Branching on the *presence* of an internal-token header
 * to skip the prefix is bypassable — anyone can include
 * `X-Grading-Worker-Token: anything` and the actual secret check happens
 * later at protected routes. Always prefixing makes the namespacing
 * guarantee unconditional: if a log line shows an id without `ext:`, the
 * worker generated it. Internal callers that want correlation can strip
 * the prefix on receipt.
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
  // Overwrite the inbound header on the *request* too, so any downstream
  // proxy (e.g. `fallback.ts`) that copies request headers forwards the
  // worker-chosen ID rather than the raw external one.
  c.req.raw.headers.set('X-Request-Id', requestId);

  await next();
};

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
