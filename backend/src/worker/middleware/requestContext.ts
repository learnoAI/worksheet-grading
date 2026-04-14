import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types';

function makeRequestId(): string {
  // Worker runtime always has Web Crypto (nodejs_compat flag also provides it).
  return crypto.randomUUID();
}

/**
 * Injects a stable request ID for the lifetime of a request.
 *
 * Behavior:
 *   - Honors an inbound `X-Request-Id` header (callers can correlate across
 *     services) if it looks sane; otherwise generates a fresh UUID.
 *   - Stores it in `c.var.requestId` for downstream handlers and on the
 *     response as `X-Request-Id` so clients can surface it in bug reports.
 *
 * Unlike the Express version, we do not use `AsyncLocalStorage` here — Hono
 * middleware closes over `c`, and deeper code paths receive the context
 * directly. This keeps the worker bundle small and isolate-friendly.
 */
export const requestContext: MiddlewareHandler<AppBindings> = async (c, next) => {
  const inbound = c.req.header('X-Request-Id');
  const requestId = isLikelyRequestId(inbound) ? inbound! : makeRequestId();

  c.set('requestId', requestId);
  c.header('X-Request-Id', requestId);

  await next();
};

function isLikelyRequestId(value: string | undefined): boolean {
  if (!value) return false;
  if (value.length > 128) return false;
  // Allow UUIDs, ULIDs, nanoid-style IDs — anything alphanumeric with dashes/underscores.
  return /^[A-Za-z0-9_-]+$/.test(value);
}
