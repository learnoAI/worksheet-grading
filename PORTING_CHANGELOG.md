# Cloudflare Porting Changelog

Consolidated record of the Cloudflare migration from the DigitalOcean-hosted
Express backend + ad-hoc Next.js host to a Hono-on-Cloudflare-Workers
backend + OpenNext-on-Workers frontend.

**Branch:** `refac/express_to_hono`
**Commit range:** 80 commits, `1661ad6` → `1fc5b96`
**Started:** 2026-04-13
**Code-side complete:** 2026-04-16

> This document is a **changelog** — "what was done, in what order, with
> what outcome." For the **plan** (what to do, what concerns are open,
> which phases are deferred), see `CLOUDFLARE_MIGRATION_PLAN.md`. For the
> **first-time deploy runbook**, see `backend/DEPLOYMENT.md`.

---

## Executive Summary

| Metric | Value |
|---|---|
| Total commits on the branch | **80** |
| Backend unit tests | **538 passing** |
| HTTP routes ported to Hono | **97 / 97** (100%) |
| Cron handlers on Hono Worker | **1** (grading dispatch loop) |
| New adapters built | **14** |
| Express code still in use | **0** (cutover-ready) |
| Worker bundle size | **3.75 MB / 1.15 MB gzipped** (Workers limit: 10 MB compressed) |
| Concerns open (C1–C9.1) | **5 open, 4 resolved/deferred** |
| Blockers to decommissioning Express | Operational only (C5 secrets, Hyperdrive creation, smoke test) |

---

## Phases at a glance

| Phase | Goal | Commits | Outcome |
|---|---|---:|---|
| **6** | Next.js frontend on CF Workers | 8 | ✅ Deployed |
| **5.1** | Scaffold Hono worker + health endpoint | 3 | ✅ |
| **5.2** | Prisma adapter + DB module | 2 | ✅ |
| **5.3** | Core middleware (auth, CORS, request-id, worker tokens) | 7 | ✅ |
| **5.4** | Zod validation helpers | 2 | ✅ |
| **5.5** | Auth routes (login, me) | 4 | ✅ |
| **5.6** | Read-only routes (schools, users, classes, templates, mastery, analytics light) | 7 | ✅ |
| **5.7** | Write/CRUD routes (schools, users, classes, templates, notifications) | 5 | ✅ |
| **5.8** | FormData upload helper (Multer replacement) | 2 | ✅ helper only |
| **5.9** | Internal worksheet-generation routes | 2 | ✅ |
| **5.10** | Service-layer adapters (R2, Python API, queues, PostHog, batch progress, mastery) | 8 | ✅ |
| **5.11** | Worksheet CRUD + derived queries + utilities | 4 | ✅ |
| **5.12** | Deployment prep — fallback proxy + wrangler config + runbook | 3 | ✅ |
| **5.13** | Complex deferred routes (direct-upload sessions, grading-worker, analytics, etc.) | 19 | ✅ |
| **5.14** | Dispatch loop as Cron handler | 3 | ✅ |
| **—** | **Remaining for decommissioning Express** | — | Operational (see bottom) |

---

## Phase-by-phase detail

### Phase 6 — Next.js frontend on Cloudflare Workers

Ported `web-app/` from its previous static host to a Cloudflare Worker using
the OpenNext adapter. Added wrangler config, build scripts, env handling
(`CLOUDFLARE_ACCOUNT_ID` via `.env.local` + `dotenv-cli`), and cache headers
for static assets. First CF Worker deployment of this project.

| Commit | Description |
|---|---|
| `1661ad6` | chore: add @opennextjs/cloudflare and wrangler dependencies |
| `dd8e626` | feat: add wrangler config for Cloudflare Workers deployment |
| `8b67688` | feat: add OpenNext config for Cloudflare adapter |
| `00c53f8` | feat: integrate OpenNext Cloudflare dev adapter in next.config |
| `9b55eaf` | feat: add Cloudflare build, preview, and deploy scripts |
| `14cd48a` | feat: add static asset caching headers and gitignore for CF build output |
| `b7ebfdc` | chore: add dotenv-cli for loading CF credentials from .env.local |
| `641b399` | docs: document CLOUDFLARE_ACCOUNT_ID env var in .env.example |

---

### Phase 5.1 — Scaffold Hono worker + health endpoint

Set up `backend/src/worker/` directory, wrangler config, dev scripts. Express
is untouched and continues running.

| Commit | Description |
|---|---|
| `11f25d3` | chore: add hono and wrangler dependencies to backend |
| `e4899be` | feat: scaffold hono worker with health endpoint and tests |
| `f49191f` | chore: add backend wrangler config, dev vars template, and worker scripts |

### Phase 5.2 — Prisma adapter + DB module

Added `@prisma/adapter-pg` + `pg` for Workers-compatible Prisma access.
Created `createPrismaClient(env)` factory that prefers `HYPERDRIVE.connectionString`
with `DATABASE_URL` fallback.

| Commit | Description |
|---|---|
| `1288922` | chore: add @prisma/adapter-pg and pg dependencies for worker |
| `8f083e6` | feat: add prisma client factory for hono worker using pg adapter |

### Phase 5.3 — Core middleware

JWT auth, role-based authorize, CORS with env-driven allowlist, request-ID
injection, shared-secret token auth for internal routes (grading worker +
worksheet creation). Switched from `jsonwebtoken` to `hono/jwt` (Web Crypto,
Workers-native; HS256 tokens interchangeable with Express).

| Commit | Description |
|---|---|
| `fb36eda` | feat: add worker env and variables typing for hono bindings |
| `e645bab` | feat: add jwt auth and authorize middleware for hono worker |
| `8b5b8b4` | fix: guard worker middleware against undefined c.env in tests |
| `829deed` | feat: add shared-secret token auth middleware for worker endpoints |
| `b1d4a58` | feat: add cors middleware for hono worker with env-based allowlist |
| `5de8106` | feat: add request-id middleware for hono worker |
| `37c5fc7` | feat: wire cors and request-id middleware into hono worker |

### Phase 5.4 — Zod validation helpers

`validateJson`, `validateQuery`, `validateParams`, `validateForm` wrappers
around `@hono/zod-validator` that produce the same `{ errors: [...] }` error
shape as `express-validator`.

| Commit | Description |
|---|---|
| `eff1b74` | chore: add zod and @hono/zod-validator for worker input validation |
| `de398f9` | feat: add zod validation helpers for hono worker |

### Phase 5.5 — Auth routes

`POST /api/auth/login` + `GET /api/auth/me`. Swapped `bcrypt` (native
addon) for `bcryptjs` (pure JS) — hash format is identical, so hashes
created by Express validate here.

| Commit | Description |
|---|---|
| `3797964` | feat: add isolate-cached prisma middleware for hono worker |
| `a94e120` | chore: add bcryptjs for workers-compatible password verification |
| `c1f267f` | feat: port auth routes (login, me) to hono worker |
| `abd2491` | feat: mount auth routes and db middleware in hono worker |

### Phase 5.6 — Read-only routes

All GET endpoints for: schools, users, classes, worksheet templates, math
skills, curriculum, mastery, light analytics, notifications.

| Commit | Description |
|---|---|
| `0628930` | docs: track bundle size and other known concerns in migration plan |
| `2c48bb5` | feat: port GET /api/notifications to hono worker |
| `f92026d` | feat: port schools read routes to hono worker |
| `54e21b5` | feat: port users read routes (list, by-id, with-details) to hono |
| `d4d3f2d` | feat: port classes read routes to hono worker |
| `57705b3` | feat: port worksheet-templates, math-skills, and curriculum read routes |
| `b01eac1` | feat: port mastery read routes (student, by-topic, class) to hono |
| `70241a9` | feat: port analytics list routes (schools, classes-by-school) to hono |

### Phase 5.7 — Write/CRUD routes

All POST/PUT/PATCH/DELETE mutation endpoints for the groups ported in 5.6.
Includes CSV uploads (users CSV, class-teachers CSV, student-classes CSV —
all JSON-body, not multipart).

| Commit | Description |
|---|---|
| `eafd964` | feat: port notifications mutation routes (mark read, mark all read) |
| `9d5491a` | feat: port schools mutation routes (create, update, archive, delete) |
| `8db4674` | feat: port users mutation routes (create, update, reset, archive, csv) |
| `ddbbbc6` | feat: port classes mutation routes (create, archive, members, csv) |
| `0cd5cf6` | feat: port worksheet templates and math skills mutation routes |

### Phase 5.8 — FormData upload helper (Multer replacement)

Shipped `backend/src/worker/uploads.ts` — `parseMultipartFiles()` with
`UploadedFile` / `UploadError` types matching Multer's shape (buffer,
mimetype, originalname, size, fieldname) + `maxCount`, `maxFileSizeBytes`,
`fileFilter`, `requireAtLeastOne` options. Actual Multer routes (upload +
process) were deferred to 5.11 / 5.13 because they also needed storage +
Python API adapters.

| Commit | Description |
|---|---|
| `c64622d` | feat: add formdata upload helper for hono worker (multer replacement) |
| `2030562` | docs: track deferred multer and direct-upload routes in migration plan |

### Phase 5.9 — Internal worksheet-generation routes

Ported `GET/POST /internal/worksheet-generation/*` (data fetch, complete,
fail). Inlined `onWorksheetPdfComplete` helper; later replaced by a
prisma-injected adapter in Phase 5.10.

| Commit | Description |
|---|---|
| `4569bea` | feat: port internal worksheet-generation routes to hono worker |
| `50c0c20` | docs: track deferred internal grading-worker and question-bank routes |

### Phase 5.10 — Service-layer adapters

Six prisma-injected / Workers-native adapters that unblock downstream
route ports. Also wired up `GET /api/mastery/recommendations` using the
new adapter.

| Commit | Adapter / change |
|---|---|
| `2a4e154` | chore: add aws4fetch for workers-compatible s3/r2 request signing |
| `ddf8857` | feat: add r2 storage adapter with native binding + aws4fetch presigned urls |
| `5f2ee8e` | feat: add workers-native python api client with retry and multipart support |
| `b3e775c` | feat: add workers-native cloudflare queues publisher adapter |
| `d8b00a3` | feat: add workers-native posthog capture adapter with retry and failure tolerance |
| `379ca8f` | refactor: extract worksheet batch progress helpers into prisma-injectable adapter |
| `d97b6b8` | feat: add prisma-injectable mastery recommendations adapter |
| `7ec9f15` | feat: wire mastery recommendations endpoint using new adapter |

### Phase 5.11 — Worksheet CRUD + derived queries + utilities

Simple worksheet reads (class, student, id, find, history, templates),
grade CRUD (create, update, delete, admin mod), derived queries (check-
repeated, batch-save).

| Commit | Description |
|---|---|
| `9b8e818` | feat: port simple worksheet read routes to hono worker |
| `f5edfc1` | feat: port worksheet grade CRUD and admin moderation routes to hono |
| `7acda64` | feat: port check-repeated and batch-save worksheet routes to hono |
| `5778251` | docs: define phase 5.13 for deferred complex worksheet and grading routes |

### Phase 5.12 — Deployment prep

Fallback proxy (unported paths forward to Express), wrangler config with
all bindings commented out, first-time deploy runbook.

| Commit | Description |
|---|---|
| `d790f93` | feat: add express fallback proxy for deferred phase 5.13 routes |
| `a962051` | chore: document hyperdrive, r2, and secret bindings in wrangler config |
| `fc2d222` | docs: add first-time deployment runbook for hono worker |

### Phase 5.13 — Complex deferred routes

The longest phase. Six sub-phases covering everything the Express fallback
was still catching.

**5.13.0** — Python API utilities + Multer-based worksheet upload

| Commit | Description |
|---|---|
| `a042106` | feat: port python api worksheet utility endpoints to hono |
| `26675f8` | feat: port POST /api/worksheets/upload to hono (multer + r2) |
| `ce696c2` | docs: track phase 5.13 partial progress (upload + python utilities) |

**5.13.α** — Prerequisite adapters

| Commit | Description |
|---|---|
| `88387ac` | feat: add grading diagnostics adapter (pure summarizer functions) |
| `63ef710` | feat: add worksheet recommendation adapter (pure fsrs-free progression logic) |

**5.13.B** — Complex worksheet queries (3 routes)

| Commit | Description |
|---|---|
| `2bf872e` | feat: port POST /api/worksheets/recommend-next to hono |
| `1ba7b65` | feat: port GET /api/worksheets/class-date to hono with fallback chain |
| `6412a16` | feat: port GET /api/worksheets/incorrect-grading to hono with image fallback chain |

**5.13.A** — Direct-upload sessions (4 routes)

| Commit | Description |
|---|---|
| `f5b571c` | feat: add direct-upload helpers (validation, key builder, access assertion) |
| `af6b7a9` | feat: port direct-upload session routes (create, get, finalize) to hono |
| `5035014` | feat: port POST /api/worksheet-processing/process to hono (multipart + r2 + queue) |

**5.13.D** — Question-bank internal (2 routes)

| Commit | Description |
|---|---|
| `ddb0cab` | feat: add worksheet sections adapter (buildSections + assembleAndEnqueuePdfs) |
| `96c19e0` | feat: port internal question-bank routes (store, generate) to hono |

**5.13.C** — Grading-worker state machine (5 routes)

| Commit | Description |
|---|---|
| `e60c446` | feat: add grading lifecycle adapter (prisma-injected job state transitions) |
| `44b312a` | feat: add grading persistence adapter (upsert with missing-index + p2002 fallbacks) |
| `ef5c00a` | feat: extend mastery adapter with updateMasteryForWorksheet (fsrs updates) |
| `7e4a206` | feat: port internal grading-worker state machine routes to hono |
| `0ce70e5` | feat: mount internal grading-worker routes in hono worker |

**5.13.E** — Heavy analytics (3 routes)

| Commit | Description |
|---|---|
| `ab8bd02` | feat: port analytics overall, students, and CSV download routes to hono |

### Phase 5.14 — Dispatch loop as Cron handler

Final piece: the grading dispatch loop moved from Express `setInterval` to
a Workers `scheduled` handler. Cron fires every minute. Closes concern C4.

| Commit | Description |
|---|---|
| `f65cb88` | feat: add grading dispatch tick (stale requeue + cf queues publish with backoff) |
| `8bd346c` | feat: wire scheduled cron handler for grading dispatch loop |
| `1fc5b96` | docs: close C4 dispatch loop concern; document cron trigger in runbook |

---

## Route inventory (97 HTTP + 1 Cron)

### Public API (under `/api`)

| Route group | Endpoints | Hono file |
|---|---|---|
| Auth | `POST /auth/login`, `GET /auth/me` | `routes/auth.ts` |
| Notifications | `GET /notifications`, `PUT /notifications/:id/read`, `PUT /notifications/read-all` | `routes/notifications.ts` |
| Schools | `GET /schools`, `GET /schools/archived`, `GET /schools/:id`, `POST /schools`, `PUT /schools/:id`, `POST /schools/:id/archive`, `POST /schools/:id/unarchive`, `DELETE /schools/:id` | `routes/schools.ts` |
| Users | `GET /users`, `GET /users/:id`, `GET /users/with-details`, `POST /users`, `PUT /users/:id`, `POST /users/:id/reset-password`, `POST /users/upload-csv`, `POST /users/:id/archive`, `POST /users/:id/unarchive` | `routes/users.ts` |
| Classes | 17 routes — CRUD, archive/unarchive, teacher/student management, bulk archive-by-year, 2 CSV imports | `routes/classes.ts` |
| Worksheet templates | `GET /worksheet-templates`, `GET /:id`, `POST /`, `PUT /:id`, `DELETE /:id`, `POST /:id/images`, `DELETE /images/:id`, `POST /:id/questions`, `PUT /questions/:id`, `DELETE /questions/:id` | `routes/worksheetTemplates.ts` |
| Math skills | `GET /math-skills`, `POST /math-skills` | `routes/worksheetTemplates.ts` |
| Curriculum | `GET /worksheet-curriculum` | `routes/worksheetTemplates.ts` |
| Mastery | `GET /mastery/student/:id`, `GET /:id/by-topic`, `GET /:id/recommendations`, `GET /mastery/class/:id` | `routes/mastery.ts` |
| Analytics | `GET /analytics/schools`, `/schools/:id/classes`, `/overall`, `/students`, `/students/download` | `routes/analytics.ts` |
| Worksheets | 23 routes — reads, grade CRUD, admin mod, check-repeated, batch-save, Python utilities, multipart upload, class-date summary, incorrect-grading feed, recommend-next | `routes/worksheets.ts` |
| Worksheet processing | `POST /upload-session`, `GET /:batchId`, `POST /:batchId/finalize`, `POST /process` | `routes/worksheetProcessing.ts` |

### Internal API (under `/internal`, shared-secret auth)

| Route group | Endpoints | Hono file |
|---|---|---|
| Worksheet generation | `GET /:id/data`, `POST /:id/complete`, `POST /:id/fail` | `routes/internalWorksheetGeneration.ts` |
| Question bank | `POST /store`, `POST /generate` | `routes/internalQuestionBank.ts` |
| Grading worker | `POST /jobs/:id/acquire`, `/heartbeat`, `/complete`, `/fail`, `/requeue` | `routes/internalGradingWorker.ts` |

### Cron handlers

| Name | Schedule | Handler |
|---|---|---|
| Grading dispatch loop | Every 1 minute | `scheduled` export in `index.ts` → `dispatch.ts` |

---

## Adapter inventory (14)

Every adapter is prisma-injected or env-based so it works in Workers.

| Adapter | Source | Purpose |
|---|---|---|
| `db.ts` | — | Prisma client factory using `@prisma/adapter-pg`, prefers `HYPERDRIVE.connectionString` |
| `adapters/storage.ts` | `services/s3Service` | R2 binding + `aws4fetch` presigned URLs |
| `adapters/pythonApi.ts` | Python API calls in grading pipeline | Native `fetch` with retry + multipart |
| `adapters/queues.ts` | `services/queue/cloudflareQueueClient` | CF Queues HTTP publisher |
| `adapters/posthog.ts` | `services/posthogService` | Event capture + exception tracking with retry |
| `adapters/batchProgress.ts` | `services/worksheetBatchService` | `onWorksheetPdfComplete`, `incrementBatchCompletedSkills` |
| `adapters/gradingDiagnostics.ts` | `services/gradingDiagnostics` | Pure summarizers for telemetry |
| `adapters/worksheetRecommendation.ts` | `services/worksheetRecommendation` | FSRS-free progression logic (pure) |
| `adapters/worksheetSections.ts` | `services/worksheetGenerationService.buildSections` + `worksheetBatchService.assembleAndEnqueuePdfs` | Question draw + PDF enqueue |
| `adapters/gradingLifecycle.ts` | `services/gradingJobLifecycleService` | Job state transitions (acquire, heartbeat, complete, fail, requeue) |
| `adapters/gradingPersistence.ts` | `services/gradingWorksheetPersistenceService` | Worksheet upsert with missing-index + P2002 race fallbacks |
| `adapters/mastery.ts` | `services/masteryService` | `computeRecommendations` + `updateMasteryForWorksheet` |
| `uploads.ts` | Multer | FormData parsing (image-only filter, size/count limits) |
| `fallback.ts` | — | Catch-all proxy to Express for unported paths (now vestigial) |
| `dispatch.ts` | `workers/gradingDispatchLoop` | Cron tick: stale requeue + CF Queues publish |

---

## Dependency changes

### Added (backend)

```
hono                    ^4.12.12   web framework
@hono/zod-validator     ^0.7.6     request validation
@prisma/adapter-pg      ^6.19.3    Workers-compatible Prisma
pg                      ^8.20.0    pg driver (used by adapter)
zod                     ^4.3.6     schema validation
bcryptjs                ^3.0.3     pure-JS bcrypt (Workers-safe)
aws4fetch               ^1.0.20    S3 request signing for R2 presigned URLs
wrangler (devDep)       ^4.82.2    CF deploy CLI
@cloudflare/workers-types (devDep) — Workers type definitions
@types/pg (devDep)      ^8.20.0
@types/bcryptjs (devDep) ^2.4.6
```

### To remove post-cutover (already not used by worker)

```
express                 ^4.21.2
express-validator       ^7.2.1
cors                    ^2.8.5
multer                  ^1.4.5-lts.1
bcrypt                  ^5.1.1      (replaced by bcryptjs)
bull                    ^4.16.5     (legacy queue, disabled in prod)
mongodb                 ^7.0.0      (optional error logging, replaced by console + PostHog)
aws-sdk                 ^2.1692.0   (S3 SDK, R2 binding replaces it)
node-fetch              ^2.7.0      (native fetch available in Node 18+)
form-data               ^4.0.2     (native FormData available)
@types/express, @types/cors, @types/multer, @types/bull, @types/bcrypt, @types/node-fetch
```

### Added (frontend)

```
@opennextjs/cloudflare (Next.js on Workers adapter)
wrangler (devDep)
dotenv-cli (devDep, for loading CLOUDFLARE_ACCOUNT_ID from .env.local)
```

---

## Known concerns — status

From `CLOUDFLARE_MIGRATION_PLAN.md`:

| ID | Concern | Status |
|---|---|---|
| **C1** | Worker bundle size inflated by Prisma (3.6 MB; monitor) | 🟡 Open — monitor |
| **C2** | Pre-existing Express test flake (`internalGradingWorkerController`) | ✅ Resolved (was a stale generated Prisma client) |
| **C3** | Node engine mismatch in local dev (22.x declared, 25 running) | 🟡 Open — opportunistic |
| **C4** | Dispatch loop migration | ✅ **Resolved in Phase 5.14** |
| **C5** | Production secrets in `backend/.env` | 🔴 Open — **blocker for deploy** |
| **C6** | Multer routes deferred past 5.8 | ✅ Resolved in Phase 5.13 (both Multer routes ported) |
| **C7** | Direct-upload session routes pending | ✅ Resolved in Phase 5.13 |
| **C8** | Internal grading-worker + question-bank deferred | ✅ Resolved in Phase 5.13 |
| **C9 / C9.1** | Complex/stateful routes deferred past 5.11 | ✅ Resolved in Phase 5.13 |

---

## What's left before Express can be turned off

All **code-side** work is complete. Remaining items are operational.

| Step | Type | Who | Effort | Blocker type |
|---|---|---|---|---|
| 1. Create Hyperdrive for prod Postgres | Ops | operator | 15 min | Required |
| 2. Populate `[[r2_buckets]]` block in `wrangler.toml` | Ops | operator | 1 min | Required |
| 3. Run `wrangler secret put` for all secrets (`JWT_SECRET`, `GRADING_WORKER_TOKEN`, `WORKSHEET_CREATION_WORKER_TOKEN`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_QUEUE_ID`, `PDF_RENDERING_QUEUE_ID`, R2 creds, `POSTHOG_API_KEY`) | Ops | operator | 15 min | Required (C5) |
| 4. Set `[vars]` block (`NODE_ENV`, `CORS_ORIGINS`, `EXPRESS_FALLBACK_URL` initially, `PROGRESSION_THRESHOLD`, etc.) | Config | operator | 5 min | Required |
| 5. **Level 1 smoke test** — `wrangler dev` against local Postgres; curl login/me/schools flow | Validation | engineer | 30 min | Strongly recommended |
| 6. **Level 2 smoke test** — deploy to a staging Worker name, run the `DEPLOYMENT.md` curl checklist | Validation | engineer | 30 min | Strongly recommended |
| 7. Verify Cron trigger fires via `wrangler tail` (expect `dispatch_loop_tick` every 1 min) | Validation | engineer | 5 min | Required |
| 8. Flip frontend `NEXT_PUBLIC_API_URL` to the new worker URL | Cutover | operator | 5 min | Required |
| 9. Monitor PostHog + `wrangler tail` for 24 h | Observability | engineer | — | Recommended |
| 10. **Unset `EXPRESS_FALLBACK_URL`** once the 24 h window is clean | Cutover | operator | 1 min | Required to retire Express |
| 11. Scale DigitalOcean App Platform to zero | Ops | operator | 2 min | Final step |
| 12. Delete Express-only code (`src/index.ts`, `routes/`, `controllers/`, stale services) + drop deps | Cleanup | engineer | ~5 commits | Post-cutover |

---

## File-layout snapshot

```
backend/
├── wrangler.toml                       # Worker config + Cron trigger
├── .dev.vars.example                   # Local dev env template
├── DEPLOYMENT.md                       # First-time deploy runbook
├── prisma/schema.prisma                # Unchanged — Express + Hono share it
└── src/
    ├── worker/                         # NEW — the Hono worker
    │   ├── index.ts                    # Module-syntax: { fetch, scheduled }
    │   ├── types.ts                    # WorkerEnv / WorkerVariables / AppBindings
    │   ├── db.ts                       # Prisma factory
    │   ├── dispatch.ts                 # Cron tick logic
    │   ├── uploads.ts                  # FormData parser
    │   ├── validation.ts               # Zod helpers
    │   ├── fallback.ts                 # Express fallback proxy (vestigial)
    │   ├── adapters/                   # 12 adapter modules
    │   ├── middleware/                 # auth, cors, db, requestContext, workerTokens
    │   ├── routes/                     # 14 route files
    │   ├── schemas/                    # Zod schemas per domain
    │   └── lib/                        # directUpload helpers
    ├── index.ts                        # Express entry (still exists, untouched)
    ├── routes/                         # Express routes (still exist, untouched)
    ├── controllers/                    # Express controllers (still exist, untouched)
    ├── services/                       # Express services (still exist, untouched)
    ├── middleware/                     # Express middleware (still exist, untouched)
    ├── workers/                        # Express dispatch loop + consumer (still exist)
    ├── utils/prisma.ts                 # Express Prisma (still exists)
    ├── scripts/                        # Admin scripts (still exist)
    └── config/env.ts                   # Express config (still exists)

web-app/
├── wrangler.jsonc                      # NEW — worker config for Next.js
├── open-next.config.ts                 # NEW
├── .dev.vars                           # NEW (gitignored)
└── (existing Next.js app unchanged)

cloudflare/                             # Unchanged — existing workers
├── grading-consumer/
├── pdf-renderer/
└── question-generator/
```

---

## Testing snapshot at cutover-ready

- **538 unit tests passing** across 42 test files
- **0 integration tests** against a real DB (by design; see smoke test plan)
- Test framework: Vitest with mocked Prisma + mocked `fetch`
- `npm test` runs the full suite in ~2 seconds
- `wrangler deploy --dry-run` succeeds (3.75 MB upload / 1.15 MB gzip, no bindings)

---

## Quick reference

- **Migration plan (active document):** `CLOUDFLARE_MIGRATION_PLAN.md`
- **Deploy runbook:** `backend/DEPLOYMENT.md`
- **Branch:** `refac/express_to_hono`
- **First commit:** `1661ad6` (2026-04-13)
- **Last commit:** `1fc5b96` (2026-04-16)
- **Cutover-blocking work remaining:** ops only — see "What's left" above.
