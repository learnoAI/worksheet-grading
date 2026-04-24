# Express Cleanup Audit

Static analysis of what can be safely deleted from `backend/` once the
Hono worker takes over as the sole HTTP surface. Nothing here is deleted
yet — this is the removal plan, staged in anticipation of P5.

**Method.** Grep-verified that nothing under `backend/src/worker/` imports
from outside its own tree (one exception: the shared Prisma-generated
client). Any file outside `src/worker/` that is *only* reachable from
`src/index.ts` (the Express entry) or its transitive route/controller
graph is a deletion candidate. Scripts under `src/scripts/` are treated
as standalone tools kept runnable against local Postgres for ops tasks.

---

## Bundle size snapshot (post-P0)

```
Total Upload: 3778.03 KiB / gzip: 1152.84 KiB
```

Measured via `npm run worker:build` (wrangler dry-run) after the 9 new
route handlers landed. Unchanged within rounding from the pre-P0 baseline
(`3.75 MB / 1.15 MB gz`) — the new code is Prisma-query glue and brings
no additional package weight. Well under the 10 MB (compressed) Workers
hard cap.

---

## Safe to delete (post-cutover)

The worker tree imports **none** of the packages listed below and **none**
of the files listed below. Verified by grep on
`backend/src/worker/**/*.ts`.

### `backend/src/` files

**Entry points**
- `src/index.ts` — Express bootstrap; replaced by `src/worker/index.ts`

**`src/routes/` (15 files)** — all 15 have been ported to `src/worker/routes/`
- analyticsRoutes, authRoutes, classRoutes, gradingJobRoutes,
  internalGradingWorkerRoutes, internalQuestionBankRoutes,
  internalWorksheetGenerationRoutes, masteryRoutes, notificationRoutes,
  schoolRoutes, userRoutes, worksheetGenerationRoutes,
  worksheetProcessingRoutes, worksheetRoutes, worksheetTemplateRoutes

**`src/controllers/` (15 files + 1 test)** — 1:1 with worker routes
- analyticsController, authController, classController,
  gradingJobController, internalGradingWorkerController (+ .test.ts),
  internalWorksheetGenerationController, masteryController,
  notificationController, questionBankController, schoolController,
  userController, worksheetController, worksheetGenerationController,
  worksheetProcessingController, worksheetTemplateController

**`src/middleware/` (6 files)** — replaced by `src/worker/middleware/`
- `auth.ts` → `worker/middleware/auth.ts`
- `gradingWorkerAuth.ts` → `worker/middleware/workerTokens.ts`
- `requestContext.ts` → `worker/middleware/requestContext.ts`
- `requestDiagnostics.ts` → merged into `worker/middleware/requestContext.ts`
- `utils.ts` — Express-only helpers (`auth`, `asHandler`, `authorizeRoles`)
- `worksheetCreationAuth.ts` → `worker/middleware/workerTokens.ts`

**`src/services/` (20 files)** — fully replaced by `src/worker/adapters/`
or obsoleted by the new architecture
- `errorLogService.ts` — MongoDB error logger; replaced by PostHog
- `gradingDiagnostics.ts` → `adapters/gradingDiagnostics.ts`
- `gradingExecutionService.ts` — integrated into
  `routes/internalGradingWorker.ts`
- `gradingJobLifecycleService.ts` → `adapters/gradingLifecycle.ts`
- `gradingJobRunner.ts` — in-process runner; replaced by Cron dispatch
- `gradingLimiter.ts` — Bottleneck-based throttle; replaced by
  `dispatch.ts` exponential backoff
- `gradingTypes.ts` — inlined in adapters
- `gradingWorksheetPersistenceService.ts` → `adapters/gradingPersistence.ts`
- `logger.ts` — pino-ish wrapper; worker uses `console.*`
- `masteryService.ts` → `adapters/mastery.ts`
- `posthogService.ts` → `adapters/posthog.ts`
- `queueService.ts` — Bull/Redis; already gated off by
  `ENABLE_LEGACY_BULL_QUEUE`, fully dead once Express is off
- `queue/cloudflareQueueClient.ts` → `adapters/queues.ts`
- `queue/gradingQueue.ts` → `dispatch.ts` calls `publishToQueue` directly
- `queue/pdfRenderingQueue.ts` → inlined in
  `adapters/worksheetGeneration.ts`
- `queue/questionGenerationQueue.ts` → inlined in
  `adapters/worksheetGeneration.ts`
- `s3Service.ts` — AWS SDK v2; replaced by R2 native binding + `aws4fetch`
  presigning in `adapters/storage.ts`
- `worksheetBatchService.ts` → `adapters/worksheetGeneration.ts`
- `worksheetGenerationService.ts` → `adapters/worksheetGeneration.ts`
- `worksheetPdfService.ts` — puppeteer-based renderer; replaced by the
  external CF PDF-rendering worker consumed via queue
- `worksheetRecommendation.ts` → `adapters/worksheetRecommendation.ts`
- `worksheetSchedulerService.ts` → `adapters/worksheetScheduler.ts`

Plus the two test files: `gradingWorksheetPersistenceService.test.ts` and
`worksheetRecommendation.test.ts`.

**`src/workers/` (3 files)** — the old Express-embedded runners
- `index.ts` — pm2/DO worker entry
- `gradingDispatchLoop.ts` — in-process `setInterval` dispatcher;
  replaced by the Cron `scheduled` handler
- `gradingWorker.ts` — experimental runner, not used in prod

**`src/config/env.ts`** — Express-style centralised config singleton. The
worker reads env bindings directly (`c.env.*`), so this becomes dead code
once Express is gone. **Caveat:** `utils/prisma.ts` and scripts also import
it — remove only after those are rewritten (see *Conditional deletion*
below).

### `backend/package.json` dependencies

**Runtime deps confirmed unused by worker + scripts (safe to drop):**

| Package | Replaced by |
|---|---|
| `express` | `hono` |
| `express-validator` | `@hono/zod-validator` + `zod` |
| `cors` | `worker/middleware/cors.ts` |
| `multer` | `worker/uploads.ts` (FormData-based) |
| `bcrypt` | `bcryptjs` (keep) |
| `jsonwebtoken` | `hono/jwt` |
| `node-fetch` | native `fetch` in Workers |
| `form-data` | `FormData` web API |
| `bull` | CF Queues (consumed by external workers) |
| `mongodb` | PostHog error tracking |
| `aws-sdk` | `aws4fetch` (keep) + R2 native binding |
| `puppeteer` | External CF PDF-rendering worker |
| `@tanstack/react-table` | Vestigial — not imported anywhere in `backend/` |
| `axios` | Vestigial — not imported anywhere in `backend/` |

**Matching `@types/*` to drop:**
`@types/bcrypt`, `@types/bull`, `@types/cors`, `@types/express`,
`@types/jsonwebtoken`, `@types/multer`, `@types/node-fetch`,
`@types/form-data`.

---

## Keep

### Files to keep

**`src/utils/prisma.ts`** — singleton Prisma client used by
`src/scripts/`. Stays as long as any script is retained.

**`src/utils/retry.ts`** — imported only by
`services/gradingWorksheetPersistenceService.ts`. Delete together with
that service; no other callers.

**`src/scripts/` (6 files)** — ad-hoc ops/analytics:
`archive-dropout-students.ts`, `export-admin-comments.ts`,
`find-multiple-worksheets-per-day.ts`,
`get-teacher-latest-worksheets.ts`, `import-learning-outcomes.ts`,
`remove-duplicate-worksheets.ts`. Keep — still runnable against local
Postgres via `ts-node`. One dep pull: `import-learning-outcomes.ts`
imports `xlsx`, so `xlsx` stays too.

**`prisma/`** — schema, migrations, seed. Unchanged.

**`backend/package.json` deps to keep:**

| Package | Reason |
|---|---|
| `@prisma/client`, `prisma` | ORM (both Express scripts and worker) |
| `@prisma/adapter-pg`, `pg`, `@types/pg` | Worker DB adapter |
| `hono`, `@hono/zod-validator`, `zod` | Worker framework |
| `bcryptjs`, `@types/bcryptjs` | Worker password hashing |
| `aws4fetch` | Worker R2 presigned URLs |
| `bottleneck` | Unused today (was in `gradingLimiter`); **remove with services** |
| `xlsx` | Used by `scripts/import-learning-outcomes.ts` |
| `@cloudflare/workers-types`, `wrangler` | Worker build tooling |
| Dev: `typescript`, `ts-node`, `vitest`, `eslint`, `nodemon` | Build/test |
| Misc: `dotenv` (transitive via `dotenv/config`), `@types/node` | Scripts |

### Conditional deletion (low priority)

- `src/config/env.ts` and `dotenv/config` — removable once the scripts
  are rewritten to read `process.env` directly (small refactor).
- `nodemon` — only needed if someone still runs `ts-node-dev` style
  watch for scripts; can drop together with Express entry if unused.

---

## Suggested cleanup commit breakdown

Aim: small commits, each leaves the worker test suite green (`npx vitest
run src/worker`).

1. **Delete Express entry + route/controller tree**
   Files: `src/index.ts`, `src/routes/*`, `src/controllers/*`. ~30 files.
   Worker is unaffected — it imports nothing from these.

2. **Delete Express middleware**
   Files: all of `src/middleware/`.

3. **Delete services replaced by adapters**
   Files: the 20 files in `src/services/` + `src/services/queue/*`.
   Also `src/utils/retry.ts` (only caller was a deleted service).

4. **Delete `src/workers/` (in-process dispatcher + runner)**
   Files: `src/workers/index.ts`, `gradingDispatchLoop.ts`, `gradingWorker.ts`.

5. **Drop Express-only npm deps**
   Edit `backend/package.json` to remove the 14 runtime deps + 8 @types.
   Run `npm install` to regenerate lockfile.

6. **(optional) `src/config/env.ts` removal**
   Requires touching `scripts/*.ts` and `utils/prisma.ts` to read env
   directly. Defer unless someone asks.

Expected bundle size delta post-commit 5: smaller node_modules, no change
to worker output size (worker already doesn't pull Express deps).

---

## What stays the same

- `prisma/` (schema + migrations)
- `backend/src/worker/` (the whole new tree)
- `backend/src/scripts/` (ops scripts run locally)
- `backend/src/utils/prisma.ts` (script dependency)
- Web-app (separate cleanup topic)
