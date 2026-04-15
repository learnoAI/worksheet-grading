import type { MiddlewareHandler } from 'hono';
import type { PrismaClient } from '@prisma/client';
import { createPrismaClient } from '../db';
import type { AppBindings, WorkerEnv } from '../types';

/**
 * Per-isolate cache of the Prisma client. A Cloudflare Worker isolate handles
 * many requests; creating a Prisma+pg pool per request would be wasteful, so
 * we lazily initialize once and reuse for the life of the isolate. Each
 * isolate is stateless across deployments — if env changes, a new isolate
 * spins up and this cache starts fresh.
 */
let cachedClient: PrismaClient | undefined;
let cachedSignature: string | undefined;

function envSignature(env: WorkerEnv): string {
  return env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL ?? '';
}

function getOrCreateClient(env: WorkerEnv): PrismaClient {
  const sig = envSignature(env);
  if (cachedClient && cachedSignature === sig) {
    return cachedClient;
  }
  cachedClient = createPrismaClient(env);
  cachedSignature = sig;
  return cachedClient;
}

/**
 * Injects a Prisma client into `c.var.prisma` for downstream handlers.
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
  if (!c.get('prisma')) {
    const env = c.env ?? ({} as WorkerEnv);
    if (env.HYPERDRIVE?.connectionString || env.DATABASE_URL) {
      c.set('prisma', getOrCreateClient(env));
    }
  }
  await next();
};

/**
 * Test helper — resets the isolate-level Prisma cache. Only used by unit
 * tests that rely on module-level mocks of `createPrismaClient`.
 */
export function __resetDbCacheForTests(): void {
  cachedClient = undefined;
  cachedSignature = undefined;
}
