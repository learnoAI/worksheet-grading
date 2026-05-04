import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types';

/**
 * Constant-time equality check for two strings.
 *
 * Prefers Cloudflare Workers' non-standard `crypto.subtle.timingSafeEqual`
 * when available, and otherwise falls back to a manual XOR-fold over the
 * UTF-8 bytes. The pre-length check is intentionally not constant-time:
 * for fixed-length shared secrets, length itself is not a meaningful
 * secret-derived signal, and `timingSafeEqual` requires equal lengths.
 */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const ab = enc.encode(a);
  const bb = enc.encode(b);
  if (ab.byteLength !== bb.byteLength) {
    return false;
  }

  const subtle: unknown = (globalThis as { crypto?: { subtle?: unknown } }).crypto?.subtle;
  const tse = (subtle as { timingSafeEqual?: (x: ArrayBufferView, y: ArrayBufferView) => boolean })
    ?.timingSafeEqual;
  if (typeof tse === 'function') {
    return tse.call(subtle, ab, bb);
  }

  // Manual fold: scan every byte, never early-return.
  let diff = 0;
  for (let i = 0; i < ab.byteLength; i++) {
    diff |= ab[i] ^ bb[i];
  }
  return diff === 0;
}

/**
 * Factory that produces a shared-secret header auth middleware.
 *
 * @param headerName  HTTP header that carries the caller's shared secret.
 * @param envKey      Key on `c.env` that holds the server-side expected secret.
 */
function shareSecretAuth(
  headerName: string,
  envKey: keyof AppBindings['Bindings']
): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const configured = (c.env ? (c.env[envKey] as unknown) : undefined) as string | undefined;
    if (!configured) {
      return c.json({ success: false, error: `${String(envKey)} is not configured` }, 500);
    }

    const provided = c.req.header(headerName);
    if (!provided || !constantTimeEqual(provided, configured)) {
      return c.json({ success: false, error: 'Unauthorized' }, 401);
    }

    await next();
  };
}

/**
 * Auth for Cloudflare grading worker → backend internal endpoints.
 * Header: `X-Grading-Worker-Token`.
 */
export const requireGradingWorkerToken = shareSecretAuth('X-Grading-Worker-Token', 'GRADING_WORKER_TOKEN');

/**
 * Auth for worksheet creation CF worker → backend internal endpoints.
 * Header: `X-Worksheet-Creation-Token`.
 */
export const requireWorksheetCreationToken = shareSecretAuth(
  'X-Worksheet-Creation-Token',
  'WORKSHEET_CREATION_WORKER_TOKEN'
);
