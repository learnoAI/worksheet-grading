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
 * Tests can bypass this middleware by setting `c.set('prisma', mockClient)`
 * in an earlier middleware — this handler is a no-op when a prisma client
 * is already present.
 */
export const withDb: MiddlewareHandler<AppBindings> = async (c, next) => {
  if (!c.get('prisma')) {
    c.set('prisma', getOrCreateClient(c.env ?? ({} as WorkerEnv)));
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
