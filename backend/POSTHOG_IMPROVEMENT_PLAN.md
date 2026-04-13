# PostHog Observability Improvement Plan

Phased rollout to improve error visibility, request correlation, and alerting
across the worksheet-grading backend. Every phase is independently deployable
and non-breaking.

**Branch:** `feat/posthog_logs_improvements`
**Core module:** `backend/src/services/posthogService.ts`

---

## Architecture Overview

### Current PostHog integration

The backend uses a hand-rolled HTTP wrapper (no official SDK) to send events
to PostHog's `/capture/` endpoint. Two helpers are exported:

- `capturePosthogEvent(event, distinctId, properties)` — generic async capture
- `captureGradingPipelineEvent(stage, distinctId, properties)` — fires the
  canonical `grading_pipeline` event keyed by a `stage` string property

All calls are fire-and-forget (wrapped in `void`). Transport errors are logged
but never block the grading flow. Config is read from `POSTHOG_API_KEY` and
`POSTHOG_HOST` environment variables.

### Design principles

1. **Additive only** — new events and properties; never rename or remove existing ones.
2. **Same fire-and-forget pattern** — telemetry must never block grading.
3. **Caller-provided values win** — spread order ensures explicit properties override automatic ones.
4. **Tests use module-boundary mocks** (`vi.mock('./posthogService')`) — internal changes are invisible to callers.
5. **Each phase is one `git revert`** — small, focused commits.

---

## Phase 0 — Harden telemetry transport [COMPLETED]

**Commit:** `93254e9`
**Files:** `services/posthogService.ts`

### What changed

1. **Transport failure logging:** Replaced the silent `catch {}` (previously
   line 69) with `apiLogger.warn('posthog_capture_failed', { event, error,
   transportErrorCount })`. Telemetry is still best-effort.
2. **Transport error counter:** Module-level `transportErrorCount` with a
   public getter `getPosthogTransportErrorCount()` — ready for `/health`
   endpoint exposure.
3. **Process metadata stamping:** Every event is auto-stamped with:
   - `service: 'worksheet-grading-backend'`
   - `environment: process.env.NODE_ENV || 'unknown'`
   - `release: process.env.GIT_SHA || process.env.RELEASE || 'unknown'`
   - `hostname: os.hostname()`

   Computed once at module load via `PROCESS_METADATA` constant. Caller values
   still override via spread precedence:
   `{ runtime, ...PROCESS_METADATA, ...callerProperties }`.

### Why it's safe

- Zero signature changes to exported functions.
- Tests mock at module boundary — internal property enrichment is invisible.
- Logging a warn on failure is strictly better than swallowing silently.

---

## Phase 1 — `capturePosthogException` helper [COMPLETED]

**Commit:** `7ed6f11`
**Files:** `services/posthogService.ts`, `services/posthogService.test.ts` (new)

### What changed

New exports (purely additive — no existing callers rewired):

- **`capturePosthogException(error, ctx)`** — emits PostHog's reserved
  `$exception` event. Accepts `{ distinctId, stage?, fingerprint?, extra? }`.
- **`buildExceptionProperties(error, ctx)`** — pure function (no HTTP) that
  builds the `$exception_list` payload. Exported for unit testing.
- **`parseStackFrames(stack)`** — parses V8 stack strings into
  `{ filename, function, lineno, colno, in_app }` frames.
- **`PosthogExceptionContext`** — TypeScript interface for the context bag.

### PostHog `$exception` payload structure

```json
{
  "$exception_list": [{
    "type": "TypeError",
    "value": "Cannot read property 'x' of undefined",
    "mechanism": { "type": "generic", "handled": true, "synthetic": false },
    "stacktrace": {
      "type": "resolved",
      "frames": [
        { "filename": "/app/src/foo.ts", "function": "doThing", "lineno": 42, "colno": 15, "in_app": true },
        { "filename": "/app/node_modules/bar/index.js", "function": "bar", "lineno": 10, "colno": 3, "in_app": false }
      ]
    }
  }],
  "$exception_type": "TypeError",
  "$exception_message": "Cannot read property 'x' of undefined",
  "$exception_source": "worker_failed",
  "$exception_fingerprint": "optional-override"
}
```

### Frame classification

- `in_app: false` for frames under `/node_modules/`, `node:`, or `internal/`.
- Non-Error throws (strings, objects) are wrapped and marked
  `mechanism.synthetic = true`.

### Test coverage (11 tests)

- Error with stack, TypeError subclass, non-Error string throw, object throw,
  missing stack, fingerprint override, in_app classification for node_modules
  and node: frames.

---

## Phase 2 — Request correlation via AsyncLocalStorage [COMPLETED]

**Commit:** `fca8b63`
**Files:** `middleware/requestContext.ts` (new), `middleware/requestDiagnostics.ts`, `services/posthogService.ts`

### What changed

1. **`middleware/requestContext.ts`** — thin wrapper around Node's built-in
   `AsyncLocalStorage`. Exports:
   - `requestContextStore` — the shared ALS instance
   - `runWithRequestContext(ctx, fn)` — runs `fn` inside a new context
   - `getRequestContext()` — reads the current context (or `undefined`)
   - `RequestContext` type: `{ requestId, sessionId?, userId? }`

2. **`middleware/requestDiagnostics.ts`** — wraps `next()` inside
   `runWithRequestContext({ requestId }, next)` so all downstream async code
   inherits the request ID.

3. **`services/posthogService.ts`** — `capturePosthogEvent` reads the ALS
   store and merges `requestId`, `sessionId`, `userId` into event properties
   before caller props (so caller props still win). `undefined` fields are
   filtered by `sanitizeProperties`.

### Behaviour outside a request

Workers, dispatch loop, and any code running outside Express middleware will
see `requestContextStore.getStore() === undefined` — the merge block is a
no-op, and events are identical to before Phase 2.

### When `config.diagnostics.enabled` is `false`

The middleware short-circuits without wrapping. No `requestId` is generated or
injected. Behaviour is identical to pre-Phase 2.

---

## Phase 3 — Fill in missing error stages [COMPLETED]

Six sub-commits, one per file area. All new events use new `stage` names —
zero modifications to existing event names or properties (except 3c which
adds optional fields).

### Phase 3a — `services/gradingExecutionService.ts`

**Commit:** `011c12b`

| New stage | Location | Purpose |
|---|---|---|
| `load_job_not_found` | `loadJobWithImages` | Job ID doesn't exist in DB |
| `load_job_missing_metadata` | `loadJobWithImages` | Job exists but `tokenNo` or `worksheetName` is null |
| `load_job_no_images` | `loadJobWithImages` | Job exists but has zero images |
| `image_download_failed` | `executeGradingJob` for-loop | S3/R2 download error (carries `s3Key`, `storageProvider`, `pageNumber`) |
| `python_call_invalid_json` | `callPythonApi` | `response.json()` parse failure (common when Python returns HTML error) |
| `python_call_rate_limited` | `callPythonApi` | HTTP 429 — records `retryAfter` header |
| `python_call_server_error` | `callPythonApi` | HTTP 5xx — distinct from 429 for independent alerting |

All events fire before existing `throw` statements. Control flow and retry
behaviour are unchanged.

### Phase 3b — `middleware/requestDiagnostics.ts` + `index.ts`

**Commit:** `0405a51`

| New event / stage | Location | Purpose |
|---|---|---|
| `backend_request_client_error` | `requestDiagnostics` finalize | 4xx responses, **sampled at 10%** (`CLIENT_ERROR_SAMPLE_RATE = 0.1`) |
| `backend_request_body_parse_error` | `index.ts` Express error middleware | JSON body-parser `SyntaxError` (detected via `'body' in err`) |
| `$exception` (stage: `express_error_middleware`) | `index.ts` Express error middleware | Any other error reaching the global error handler |
| `$exception` (stage: `unhandled_rejection`) | `index.ts` `process.on` | Unhandled promise rejections |
| `$exception` (stage: `uncaught_exception`) | `index.ts` `process.on` | Uncaught exceptions |

Process-level handlers are best-effort and never block Node's default crash
handling.

### Phase 3c — `services/gradingWorksheetPersistenceService.ts`

**Commit:** `c911d52`

Enriches the existing `worksheet_persist_failed` and
`worksheet_persist_fallback_missing_unique_index` events with two new
**optional** properties when the error is a `Prisma.PrismaClientKnownRequestError`:

- `prismaErrorCode` — e.g. `P2002`, `P2003`, `P1008`, `P2021`
- `prismaMeta` — Prisma's error metadata bag

This lets PostHog group failures by root cause (unique-constraint vs
foreign-key vs connection timeout) instead of lumping into one alert.

**Note:** `persist_transaction_rolled_back` was deferred because this file
doesn't open its own `$transaction`. That event belongs upstream in the
controllers that wrap the call.

### Phase 3d — `controllers/worksheetProcessingController.ts` + `routes/worksheetProcessingRoutes.ts`

**Commit:** `b0e8be5`

| New stage / event | Location | Purpose |
|---|---|---|
| `request_rejected_ownership` (reason: `student_role`) | `assertDirectUploadAccess` | Student attempted upload |
| `request_rejected_ownership` (reason: `teacher_not_assigned_to_class`) | `assertDirectUploadAccess` | Teacher not in class roster |
| `request_rejected_ownership` (reason: `students_not_in_class`) | `assertDirectUploadAccess` | Students not assigned to class |
| `direct_upload_presign_failed` | `createDirectUploadSession` | R2 URL signing failure (carries `keysRequested`) |
| `image_upload_rejected` | `worksheetProcessingRoutes.ts` `withUploadTelemetry` | Multer rejection classified as `size` / `count` / `mime` / `multer_other` / `unknown` |

`withUploadTelemetry` wraps `upload.array()` so multer errors are captured
before they reach the global Express error handler. On success, `next()` runs
exactly once — no behaviour change.

### Phase 3e — `workers/gradingDispatchLoop.ts` + `workers/gradingWorker.ts`

**Commit:** `18e9da7`

| New stage | Location | Purpose |
|---|---|---|
| `dispatch_loop_crashed` | `startGradingDispatchLoop` `tick()` catch | Silently-dead dispatch loop — worst failure mode in the queue system |
| `pull_worker_lag_detected` | `processMessage` after parse | `Date.now() - enqueuedAt >= 60s` — earliest backpressure signal |
| `pull_worker_poison_message` | `processMessage` after parse | `message.attempts >= 3` — splits "flaky once" from "will never succeed" |

The existing `pull_worker_message_processing_started` event now also carries
`attempts` for per-message timeline queries.

**Threshold constants** (top of `gradingWorker.ts`):
- `LAG_DETECTED_THRESHOLD_MS = 60_000`
- `POISON_MESSAGE_ATTEMPTS_THRESHOLD = 3`

### Phase 3f — `controllers/internalGradingWorkerController.ts`

**Commit:** `313fb72`

| New stage | Location | Purpose |
|---|---|---|
| `worker_heartbeat_drift` | `heartbeat` handler | Gap between beats > `heartbeatIntervalMs * 2` — detects GC pauses / network stalls |
| `worker_clock_skew` | `acquireJob` handler | `|workerNow - dbNow| > 30s` — detects NTP drift affecting lease calculations |

Both are best-effort: a failed pre-read or `SELECT NOW()` is swallowed so
heartbeats and acquires remain resilient.

**Constants** (top of file):
- `HEARTBEAT_DRIFT_MULTIPLIER = 2`
- `CLOCK_SKEW_THRESHOLD_MS = 30_000`

---

## Phase 4 — Dual-write `$exception` alongside `*_failed` events [COMPLETED]

**Goal:** Activate PostHog Error Tracking without removing any existing event.

### Implementation

For each `catch` block that already emits `captureGradingPipelineEvent('*_failed', ...)`,
add a **second call** to `capturePosthogException(error, { distinctId, stage, extra })`.

Gate behind a boolean env flag so prod can verify before enabling:

```
POSTHOG_EXCEPTIONS_ENABLED=true   # default: false
```

Add `isExceptionsEnabled()` check in `capturePosthogException` that reads
this flag and short-circuits when `false`.

### Target call sites

| File | Existing `*_failed` stage | `$exception` stage |
|---|---|---|
| `services/gradingExecutionService.ts` | `python_call_non_retryable_failed` | `python_call_non_retryable_failed` |
| `services/gradingExecutionService.ts` | `python_call_retry_exhausted` | `python_call_retry_exhausted` |
| `services/gradingExecutionService.ts` | `image_download_failed` | `image_download_failed` |
| `services/gradingWorksheetPersistenceService.ts` | `worksheet_persist_failed` | `worksheet_persist_failed` |
| `services/gradingJobRunner.ts` | `runner_failed` | `runner_failed` |
| `controllers/internalGradingWorkerController.ts` | `worker_acquire_failed` | `worker_acquire_failed` |
| `controllers/internalGradingWorkerController.ts` | `worker_heartbeat_failed` | `worker_heartbeat_failed` |
| `controllers/internalGradingWorkerController.ts` | `worker_complete_failed` | `worker_complete_failed` |
| `controllers/internalGradingWorkerController.ts` | `worker_fail_failed` | `worker_fail_failed` |
| `controllers/internalGradingWorkerController.ts` | `worker_requeue_failed` | `worker_requeue_failed` |
| `workers/gradingDispatchLoop.ts` | `dispatch_loop_retry_failed` | `dispatch_loop_retry_failed` |
| `workers/gradingDispatchLoop.ts` | `dispatch_loop_crashed` | `dispatch_loop_crashed` |

### Verification

- In PostHog staging, confirm Error Tracking UI groups stacks correctly.
- Compare counts: `$exception` events should approximately equal the sum of
  `*_failed` pipeline events.
- Flip `POSTHOG_EXCEPTIONS_ENABLED=false` to confirm kill-switch works.

### Rollback

Flip env flag to `false`, or revert the commits.

---

## Phase 5 — Migrate to `posthog-node` SDK [PENDING]

**Goal:** Get batching, retry, and graceful shutdown without changing any caller.

### Implementation

Rewrite the internals of `posthogService.ts` to use the `posthog-node` npm
package, **preserving all exported function signatures**:

```
capturePosthogEvent(event, distinctId, properties)
  → client.capture({ distinctId, event, properties })

captureGradingPipelineEvent(stage, distinctId, properties)
  → same wrapper, unchanged

capturePosthogException(error, ctx)
  → client.captureException(error, ctx.distinctId, ...)
```

On shutdown (`process.on('SIGTERM'/'SIGINT'/'beforeExit')`) call
`client.shutdown()` to flush the in-memory batch.

Keep the `isEnabled()` guard so missing API key is still a no-op.

### What it unlocks

- **Batching** — reduces outbound HTTP calls by ~10x under burst.
- **Retry with backoff** — no more silently dropped events on network blips.
- **Exit flush** — in-flight events flushed before process dies.
- **Feature flags** — needed for Phase 7 kill-switch.
- **Groups API** — needed for Phase 6 school/teacher grouping.

### Verification

- Full test suite passes unchanged (mocks are at module boundary).
- Load test: confirm batch flush reduces outbound HTTP calls.
- Kill process mid-flight; confirm in-flight events flushed in PostHog.
- Canary: one instance on new SDK for 24h before full rollout.

### Rollback

Revert single file; re-pin `posthog-node` removal in `package.json`.

---

## Phase 6 — Identity + Groups [PENDING]

**Goal:** Turn per-job distinct IDs into per-school / per-teacher timelines.

### Implementation

1. Extend `RequestContext` (from Phase 2) with `userId` and
   `groups: { school?, batch?, worksheet? }`.

2. In `requestDiagnostics.ts`: if the request is authenticated, call
   `client.identify({ distinctId: userId, properties: { ... } })` once per
   request and store `userId` in ALS.

3. In `posthogService.ts` `sanitizeProperties`: if ALS has `groups`, merge
   into `$groups`.

4. In `worksheetProcessingController.ts`: set `groups.batch`,
   `groups.worksheet` into the store before firing events.

### What it unlocks

- **Person page** — a single teacher's failed uploads collapse into one
  timeline in PostHog, not 50 orphaned job-ID "people".
- **Group analytics** — aggregate grading failures per school or per
  worksheet batch.

### Verification

- Staging: confirm a single teacher's events are one person in PostHog.
- Unit test: jobs without auth still emit events (no `userId` required).

---

## Phase 7 — Sampling + kill-switch [PENDING]

**Goal:** Control telemetry volume without a code release.

### Implementation

Add `config.posthog.verboseEnabled` (default `true` staging, `false` prod)
or a PostHog feature flag (`posthog_verbose_telemetry`) and check it for
high-volume stages:

**Stages to gate (verbose):**
- `python_call_retry_scheduled`
- `worker_heartbeat_initial`
- `pull_worker_message_processing_started`
- `request_received` (sample 10%)

**Stages that always fire (100%):**
- All `*_failed` stages
- All `$exception` events
- `dispatch_loop_crashed`
- `pull_worker_poison_message`

### Verification

- Toggle the flag; confirm verbose events disappear within 1 minute.
- Confirm failing-path events remain fully sampled.

---

## Phase 8 — PostHog UI configuration [PENDING]

No code changes. Configure in PostHog web UI once events are flowing.

### Assets to create

| Asset | Configuration |
|---|---|
| **Funnel** | `request_received` -> `job_created` -> `dispatch_succeeded` -> `execution_started` -> `execution_persisted` |
| **Error Tracking alerts** | New `$exception` group with > 5 occurrences in 10 min -> Slack |
| **Event alerts** | `worksheet_persist_failed > 5/min`, `python_call_retry_exhausted > 0`, `dispatch_loop_crashed >= 1` |
| **Dashboard** | "Grading pipeline health" — stage-by-stage conversion + failure breakdown by `prismaErrorCode` |
| **Person page** | Confirm `$identify` + `$groups` light up school/teacher timelines |

---

## Phase dependency graph

```
Phase 0 ──┬── Phase 1 ──┬── Phase 4 ──┐
           │             │             │
           └── Phase 2 ──┴── Phase 6 ──┤
                         │             │
                         └── Phase 3   ├── Phase 5 ── Phase 7 ── Phase 8
                             (a-f)     │
                                       │
```

- Phases 0, 1, 2 are independent and can ship in any order.
- Phase 3 sub-phases are independent of each other.
- Phase 4 depends on Phase 1 (needs the helper).
- Phase 5 should come after Phases 0-4 so the migration diff is clean.
- Phase 6 depends on Phase 2 (needs the ALS context).
- Phase 7 depends on Phase 5 (feature-flag variant needs `posthog-node`).
- Phase 8 depends on Phase 3 (events must exist before dashboards chart them).

---

## Complete event catalog

### `grading_pipeline` stages (via `captureGradingPipelineEvent`)

| Stage | File | Added in |
|---|---|---|
| `request_received` | worksheetProcessingController | pre-existing |
| `request_rejected_validation` | worksheetProcessingController | pre-existing |
| `request_rejected_ownership` | worksheetProcessingController | Phase 3d |
| `request_accepted` | worksheetProcessingController | pre-existing |
| `request_failed` | worksheetProcessingController | pre-existing |
| `job_created` | worksheetProcessingController | pre-existing |
| `images_stored` | worksheetProcessingController | pre-existing |
| `image_upload_rejected` | worksheetProcessingRoutes | Phase 3d (as `capturePosthogEvent`) |
| `dispatch_attempt` | worksheetProcessingController | pre-existing |
| `dispatch_succeeded` | worksheetProcessingController | pre-existing |
| `dispatch_failed` | worksheetProcessingController | pre-existing |
| `direct_upload_session_created` | worksheetProcessingController | pre-existing |
| `direct_upload_session_finalized` | worksheetProcessingController | pre-existing |
| `direct_upload_presign_failed` | worksheetProcessingController | Phase 3d |
| `load_job_not_found` | gradingExecutionService | Phase 3a |
| `load_job_missing_metadata` | gradingExecutionService | Phase 3a |
| `load_job_no_images` | gradingExecutionService | Phase 3a |
| `image_download_failed` | gradingExecutionService | Phase 3a |
| `execution_started` | gradingExecutionService | pre-existing |
| `execution_persisted` | gradingExecutionService | pre-existing |
| `python_call_started` | gradingExecutionService | pre-existing |
| `python_call_succeeded` | gradingExecutionService | pre-existing |
| `python_call_invalid_json` | gradingExecutionService | Phase 3a |
| `python_call_rate_limited` | gradingExecutionService | Phase 3a |
| `python_call_server_error` | gradingExecutionService | Phase 3a |
| `python_call_non_retryable_failed` | gradingExecutionService | pre-existing |
| `python_call_retry_scheduled` | gradingExecutionService | pre-existing |
| `python_call_retry_exhausted` | gradingExecutionService | pre-existing |
| `runner_started` | gradingJobRunner | pre-existing |
| `runner_completed` | gradingJobRunner | pre-existing |
| `runner_failed` | gradingJobRunner | pre-existing |
| `runner_skipped_lease_not_acquired` | gradingJobRunner | pre-existing |
| `runner_skipped_lease_lost_before_complete` | gradingJobRunner | pre-existing |
| `runner_skipped_lease_lost_before_fail` | gradingJobRunner | pre-existing |
| `worksheet_persist_rejected_response` | gradingWorksheetPersistenceService | pre-existing |
| `worksheet_persist_fallback_missing_unique_index` | gradingWorksheetPersistenceService | pre-existing |
| `worksheet_persist_failed` | gradingWorksheetPersistenceService | pre-existing (enriched 3c) |
| `worksheet_persist_slow` | gradingWorksheetPersistenceService | pre-existing |
| `worker_acquire_requested` | internalGradingWorkerController | pre-existing |
| `worker_acquire_skipped` | internalGradingWorkerController | pre-existing |
| `worker_acquire_succeeded` | internalGradingWorkerController | pre-existing |
| `worker_acquire_job_not_found` | internalGradingWorkerController | pre-existing |
| `worker_acquire_failed` | internalGradingWorkerController | pre-existing |
| `worker_clock_skew` | internalGradingWorkerController | Phase 3f |
| `worker_heartbeat_initial` | internalGradingWorkerController | pre-existing |
| `worker_heartbeat_lease_mismatch` | internalGradingWorkerController | pre-existing |
| `worker_heartbeat_drift` | internalGradingWorkerController | Phase 3f |
| `worker_heartbeat_failed` | internalGradingWorkerController | pre-existing |
| `worker_complete_requested` | internalGradingWorkerController | pre-existing |
| `worker_complete_invalid_payload` | internalGradingWorkerController | pre-existing |
| `worker_complete_succeeded` | internalGradingWorkerController | pre-existing |
| `worker_complete_job_not_found` | internalGradingWorkerController | pre-existing |
| `worker_complete_lease_mismatch` | internalGradingWorkerController | pre-existing |
| `worker_complete_failed` | internalGradingWorkerController | pre-existing |
| `worker_fail_lease_mismatch` | internalGradingWorkerController | pre-existing |
| `worker_fail_succeeded` | internalGradingWorkerController | pre-existing |
| `worker_fail_failed` | internalGradingWorkerController | pre-existing |
| `worker_requeue_lease_mismatch` | internalGradingWorkerController | pre-existing |
| `worker_requeue_succeeded` | internalGradingWorkerController | pre-existing |
| `worker_requeue_failed` | internalGradingWorkerController | pre-existing |
| `dispatch_loop_stale_processing_requeued` | gradingDispatchLoop | pre-existing |
| `dispatch_loop_retry_attempt` | gradingDispatchLoop | pre-existing |
| `dispatch_loop_retry_succeeded` | gradingDispatchLoop | pre-existing |
| `dispatch_loop_retry_failed` | gradingDispatchLoop | pre-existing |
| `dispatch_loop_crashed` | gradingDispatchLoop | Phase 3e |
| `pull_worker_invalid_message_dropped` | gradingWorker | pre-existing |
| `pull_worker_message_processing_started` | gradingWorker | pre-existing (enriched 3e) |
| `pull_worker_message_skipped` | gradingWorker | pre-existing |
| `pull_worker_message_completed` | gradingWorker | pre-existing |
| `pull_worker_message_failed` | gradingWorker | pre-existing |
| `pull_worker_lag_detected` | gradingWorker | Phase 3e |
| `pull_worker_poison_message` | gradingWorker | Phase 3e |

### Standalone events (via `capturePosthogEvent` directly)

| Event name | File | Added in |
|---|---|---|
| `backend_request_diagnostic` | requestDiagnostics | pre-existing |
| `backend_request_client_error` | requestDiagnostics | Phase 3b |
| `backend_request_body_parse_error` | index.ts | Phase 3b |
| `image_upload_rejected` | worksheetProcessingRoutes | Phase 3d |

### `$exception` events (via `capturePosthogException`)

| Stage | File | Added in |
|---|---|---|
| `express_error_middleware` | index.ts | Phase 3b |
| `unhandled_rejection` | index.ts | Phase 3b |
| `uncaught_exception` | index.ts | Phase 3b |
| *(Phase 4 will add all `*_failed` stages)* | various | Phase 4 |

---

## Automatic properties on every event

| Property | Source | Added in |
|---|---|---|
| `runtime` | hardcoded `'backend'` | pre-existing |
| `service` | hardcoded `'worksheet-grading-backend'` | Phase 0 |
| `environment` | `process.env.NODE_ENV` | Phase 0 |
| `release` | `process.env.GIT_SHA \|\| RELEASE` | Phase 0 |
| `hostname` | `os.hostname()` | Phase 0 |
| `requestId` | AsyncLocalStorage (when inside a request) | Phase 2 |
| `sessionId` | AsyncLocalStorage (reserved, unset until Phase 6) | Phase 2 |
| `userId` | AsyncLocalStorage (reserved, unset until Phase 6) | Phase 2 |

---

## Environment variables

| Variable | Default | Purpose | Phase |
|---|---|---|---|
| `POSTHOG_API_KEY` | `''` (disabled) | PostHog project API key | pre-existing |
| `POSTHOG_HOST` | `https://us.i.posthog.com` | PostHog ingestion endpoint | pre-existing |
| `REQUEST_DIAGNOSTICS_ENABLED` | `true` | Enables request diagnostics middleware (and ALS wrapping) | pre-existing |
| `POSTHOG_EXCEPTIONS_ENABLED` | `false` | Gates Phase 4 `$exception` dual-writing | Phase 4 |
| `GIT_SHA` or `RELEASE` | `'unknown'` | Stamped as `release` property on every event | Phase 0 |

---

## Test coverage

| File | Tests | Purpose |
|---|---|---|
| `services/posthogService.test.ts` | 11 | `buildExceptionProperties`, `parseStackFrames` (Phase 1) |
| `middleware/requestDiagnostics.test.ts` | 1 | Mock-based: 500 response fires `backend_request_diagnostic` (pre-existing) |
| `services/gradingWorksheetPersistenceService.test.ts` | 5 | Mock-based: persistence failures, fallback paths (pre-existing) |
| `controllers/internalGradingWorkerController.test.ts` | 2 | Mock-based: complete handler 500 and 409 paths (pre-existing) |
| `services/gradingJobLifecycleService.test.ts` | 3 | Lifecycle service tests (pre-existing) |
| `services/worksheetRecommendation.test.ts` | 4 | Recommendation tests (pre-existing) |

All existing tests mock `posthogService` at the module boundary using
`vi.mock('./posthogService')` with `vi.fn()` replacements. They use
`objectContaining` assertions, so additive properties never break them.

**Total: 6 files, 26 tests, all passing.**

---

## TS error baseline

19 pre-existing errors, all in `controllers/worksheetProcessingController.ts`,
all caused by Prisma client not being regenerated against the current schema
(`WorksheetUploadBatch`, `WorksheetUploadItem`, `WorksheetUploadImage` models).
These resolve automatically after `npx prisma generate`.

Zero errors introduced by any phase.
