import type { PrismaClient, UserRole } from '@prisma/client';

/**
 * Environment bindings exposed to the Hono worker.
 *
 * Populated from two sources:
 *   - `wrangler.toml` `[vars]` block and `wrangler secret put` secrets.
 *   - Per-request bindings like Hyperdrive.
 *
 * Keep this in sync with `.dev.vars.example` and the production secret set.
 */
export interface WorkerEnv {
  // Database
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };

  // Auth
  JWT_SECRET?: string;

  // CORS
  CORS_ORIGINS?: string;

  // Internal shared-secret tokens
  GRADING_WORKER_TOKEN?: string;
  WORKSHEET_CREATION_WORKER_TOKEN?: string;
}

/**
 * Per-request variables set by middleware and read by route handlers.
 *
 * `c.set('user', ...)` / `c.get('user')` are typed through this.
 */
export interface WorkerVariables {
  user?: {
    userId: string;
    role: UserRole;
  };
  requestId?: string;
  prisma?: PrismaClient;
}

export type AppBindings = { Bindings: WorkerEnv; Variables: WorkerVariables };
