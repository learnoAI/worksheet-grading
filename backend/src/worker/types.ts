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

  // Cloudflare queue IDs.
  //   CF_QUEUE_ID — legacy grading queue. No longer published to from
  //                 the Hono worker (grading is now driven by
  //                 Cloudflare Workflows via GRADING_WORKFLOW); kept
  //                 typed for the Express in-process loop in
  //                 `src/workers/gradingDispatchLoop.ts`.
  //                 TODO(2026-08): remove once Express path retires.
  //   QUESTION_GENERATION_QUEUE_ID / PDF_RENDERING_QUEUE_ID — still
  //                 used by worksheet-generation paths.
  CF_QUEUE_ID?: string;
  QUESTION_GENERATION_QUEUE_ID?: string;
  PDF_RENDERING_QUEUE_ID?: string;

  // Cloudflare Workflows binding. Cross-script binding to the
  // grading-consumer worker's `GradingWorkflow` class. Backend dispatch
  // creates an instance per grading job; the workflow then drives the
  // 3-tier LLM fallback chain and reports back via /complete or /fail.
  GRADING_WORKFLOW?: GradingWorkflowBinding;

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

  // Request-diagnostics middleware tunables. Mirror the Express
  // `config.diagnostics.*` shape so dashboards stay portable. When
  // REQUEST_DIAGNOSTICS_ENABLED is the literal string 'false' the
  // middleware skips all PostHog emissions; any other value (or unset)
  // keeps it on. Threshold defaults: slow=1500ms.
  REQUEST_DIAGNOSTICS_ENABLED?: string;
  REQUEST_DIAGNOSTICS_SLOW_MS?: string;

  // Object storage — native R2 binding (preferred) and S3-compatible
  // endpoint config used by aws4fetch for presigned URLs.
  WORKSHEET_FILES?: R2Bucket;
  R2_ACCOUNT_ID?: string;
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  R2_BUCKET_NAME?: string;
  R2_ENDPOINT?: string;
  R2_PUBLIC_BASE_URL?: string;

  // Dispatch-loop tunables (read by `dispatch.ts`; all stringly-typed
  // because wrangler `[vars]` always serializes to string).
  GRADING_STALE_PROCESSING_MS?: string;
  GRADING_QUEUE_POLL_BATCH_SIZE?: string;
  // Threshold for treating a QUEUED job as orphaned (CF Queue exhausted
  // its retry cycle without the worker handler ever running). Must exceed
  // the worst-case CF Queue retry cycle (max_retries × max retry-after);
  // 30 min default is comfortably past CF's defaults.
  GRADING_DISPATCH_ORPHAN_MS?: string;
  // How long an UPLOADING batch can sit idle before a new
  // /upload-session for the same teacher/class/date supersedes its
  // PENDING items as abandoned (default 5 min). See `b9a3303`.
  GRADING_STALE_UPLOAD_BATCH_MS?: string;

  // Index signature so `WorkerEnv` is structurally assignable to adapter
  // env contracts that read dynamic keys (e.g. `QueuePublishEnv` does
  // `env[queueIdEnvKey]` to look up `CF_QUEUE_ID` /
  // `QUESTION_GENERATION_QUEUE_ID` / `PDF_RENDERING_QUEUE_ID` by name).
  // Named fields above remain typed; dynamic accesses return `unknown`.
  [k: string]: unknown;
}

/**
 * Minimal subset of the Cloudflare Workflows binding we use from backend
 * dispatch. The full surface lives in `@cloudflare/workers-types`; this
 * mirrors only the methods the dispatch + reset paths invoke.
 */
export interface GradingWorkflowBinding {
  create(options: {
    id: string;
    params: { jobId: string };
  }): Promise<GradingWorkflowInstance>;
  get(id: string): Promise<GradingWorkflowInstance>;
}

export interface GradingWorkflowInstance {
  id: string;
  status(): Promise<{ status: string; error?: string; output?: unknown }>;
  restart(): Promise<void>;
  terminate(): Promise<void>;
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
