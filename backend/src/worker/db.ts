import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import pg from 'pg';

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
 *
 * Caching note: an earlier version cached this client at module scope to
 * amortize Prisma init across requests. That broke under deployed load —
 * Workers freezes idle isolates and Hyperdrive silently drops idle TCP
 * sockets, so the cached pool would hand out dead clients on the next wake,
 * causing ~50% of requests to fail with "Workers runtime canceled this
 * request". A fresh client per request avoids that entirely; Hyperdrive
 * multiplexes connections on its side so the underlying database does not
 * see the extra connection setup. See `middleware/db.ts` for the request
 * lifecycle and cleanup via `ctx.waitUntil`.
 *
 * Pool sizing: each request gets its own pool, and a Hono request handler is
 * single-flow within an isolate — the only reason to allow more than one
 * connection is `Promise.all([...prisma queries])` style fan-out. A handful
 * of routes do exactly that (count+rows pagination in `users`/`analytics`,
 * the 6-way count fan-out in the analytics dashboard, per-row recovery in
 * `gradingJobs`), so we keep `max: 3` — enough to actually run those in
 * parallel against Hyperdrive without burning extra connection slots in
 * Hyperdrive's connection cache for the common 1-2 query path. We do not
 * set `allowExitOnIdle`: it's a Node-process flag (lets the Node process
 * exit when all pool connections go idle) and is meaningless in Workers,
 * where the runtime owns isolate lifecycle.
 */
export function createPrismaClient(env: WorkerEnv): PrismaClient {
  const connectionString = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      'No database connection string available. Set DATABASE_URL or bind HYPERDRIVE.'
    );
  }
  const pool = new pg.Pool({
    connectionString,
    max: 3,
    idleTimeoutMillis: 0,
  });
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}
