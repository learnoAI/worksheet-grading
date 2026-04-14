import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

export interface WorkerEnv {
  DATABASE_URL?: string;
  HYPERDRIVE?: { connectionString: string };
}

/**
 * Builds a Prisma client backed by the node-postgres adapter so it can run
 * inside a Cloudflare Worker (with the `nodejs_compat` flag).
 *
 * Resolution order for the connection string:
 *   1. `env.HYPERDRIVE.connectionString` — set when the Worker has a Hyperdrive binding
 *   2. `env.DATABASE_URL`               — set via `.dev.vars` or secrets
 *
 * Throws if neither source yields a connection string so misconfiguration is
 * surfaced eagerly rather than at the first query.
 */
export function createPrismaClient(env: WorkerEnv): PrismaClient {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'No database connection string available. Set DATABASE_URL or bind HYPERDRIVE.'
    );
  }
  const adapter = new PrismaPg({ connectionString });
  return new PrismaClient({ adapter });
}
