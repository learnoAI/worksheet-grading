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

  // Fallback URL for routes not yet ported to Hono (Phase 5.13 scope).
  EXPRESS_FALLBACK_URL?: string;

  // Python grading API — used by utility worksheet endpoints that forward
  // to the legacy image/grading service.
  PYTHON_API_URL?: string;

  // Score threshold at which students are recommended the *next* worksheet
  // instead of repeating the current one. Stringly-typed because wrangler
  // passes env vars as strings; parsed in the handler.
  PROGRESSION_THRESHOLD?: string;

  // Cloudflare queue IDs. `CF_QUEUE_ID` is the grading queue; the others
  // are for worksheet generation and PDF rendering (Phase 5.13.D).
  CF_QUEUE_ID?: string;
  QUESTION_GENERATION_QUEUE_ID?: string;
  PDF_RENDERING_QUEUE_ID?: string;

  // Cloudflare account + API token for queue publishing from the worker.
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_API_BASE_URL?: string;

  // URL of the question-generator Cloudflare Worker (used by
  // `/internal/question-bank/generate`).
  QUESTION_GENERATOR_WORKER_URL?: string;

  // PostHog config (adapter reads POSTHOG_API_KEY + optional host).
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
  NODE_ENV?: string;
  GIT_SHA?: string;
  RELEASE?: string;

  // Object storage — native R2 binding (preferred) and S3-compatible
  // endpoint config used by aws4fetch for presigned URLs.
  WORKSHEET_FILES?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_ENDPOINT?: string;
  R2_PUBLIC_BASE_URL?: string;
}

/**
 * Minimal subset of the Cloudflare R2 Bucket binding we actually use. Lets
 * us type-check worker code without dragging in `@cloudflare/workers-types`
 * everywhere.
 */
export interface R2Bucket {
  put(
    key: string,
    value: ArrayBuffer | ArrayBufferView | ReadableStream | Blob | string | null,
    options?: { httpMetadata?: { contentType?: string } }
  ): Promise<unknown>;
  get(key: string): Promise<R2Object | null>;
  delete(key: string | string[]): Promise<void>;
  head(key: string): Promise<R2Object | null>;
}

export interface R2Object {
  key: string;
  size: number;
  etag: string;
  httpMetadata?: { contentType?: string };
  body?: ReadableStream<Uint8Array> | null;
  arrayBuffer(): Promise<ArrayBuffer>;
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
