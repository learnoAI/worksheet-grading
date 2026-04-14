import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types';

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
    if (!provided || provided !== configured) {
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
