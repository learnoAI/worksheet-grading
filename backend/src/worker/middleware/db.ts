import type { MiddlewareHandler } from 'hono';
import { createPrismaClient } from '../db';
import type { AppBindings, WorkerEnv } from '../types';

/**
 * Injects a fresh Prisma client into `c.var.prisma` for downstream handlers,
 * and schedules its disposal after the response is sent.
 *
 * Why fresh-per-request: see the comment in `../db.ts`. Caching across
 * requests broke under deployed load because Workers freezes idle isolates
 * and Hyperdrive silently drops idle TCP sockets, leaving cached pools with
 * dead connections.
 *
 * Behavior:
 *   - If a prisma client is already on the context (e.g. set by tests), skip.
 *   - Otherwise, attempt to build one from `env`. If the env lacks a
 *     connection string (e.g. the /health endpoint running in a smoke test),
 *     leave `c.var.prisma` unset and let downstream handlers decide — routes
 *     that need the DB check for its presence and return 500 with a clear
 *     message. Health / readiness endpoints that don't need a DB still work.
 */
export const withDb: MiddlewareHandler<AppBindings> = async (c, next) => {
  let createdHere: ReturnType<typeof createPrismaClient> | undefined;
  if (!c.get('prisma')) {
    const env = c.env ?? ({} as WorkerEnv);
    if (env.HYPERDRIVE?.connectionString || env.DATABASE_URL) {
      createdHere = createPrismaClient(env);
      c.set('prisma', createdHere);
    }
  }
  try {
    await next();
  } finally {
    // Only dispose clients we created here — tests set their own and manage
    // disposal themselves. `executionCtx.waitUntil` extends the request
    // lifetime so disconnect can finish after the response is sent without
    // blocking the user.
    if (createdHere) {
      const disconnect = createdHere.$disconnect().catch(() => {});
      // `c.executionCtx` throws when no Workers ctx is bound (e.g. in unit
      // tests via `app.request()`), so try/catch instead of a truthy check.
      let scheduled = false;
      try {
        const ctx = c.executionCtx;
        if (ctx && typeof ctx.waitUntil === 'function') {
          ctx.waitUntil(disconnect);
          scheduled = true;
        }
      } catch {
        // No execution context — fall through to await.
      }
      if (!scheduled) {
        await disconnect;
      }
    }
  }
};
