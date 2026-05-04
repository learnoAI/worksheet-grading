# Cloudflare Porting Changelog

Consolidated record of the Cloudflare migration from the DigitalOcean-hosted
Express backend + ad-hoc Next.js host to a Hono-on-Cloudflare-Workers
backend + OpenNext-on-Workers frontend.

**Branch:** `refac/express_to_hono`
**Commit range:** 113+ commits, `1661ad6` → `HEAD`
**Started:** 2026-04-13
**Code-side complete:** 2026-04-22
**Tooling complete:** 2026-04-24
**Staging validation complete:** 2026-05-04

> This document is a **changelog** — "what was done, in what order, with
> what outcome." For the **plan** (what to do, what concerns are open,
> which phases are deferred), see `CLOUDFLARE_MIGRATION_PLAN.md`. For the
> **first-time deploy runbook**, see `backend/DEPLOYMENT.md`. For the
> **post-cutover Express removal plan**, see `EXPRESS_CLEANUP_AUDIT.md`.

---

## Executive Summary

| Metric | Value |
|---|---|
| Total commits on the branch | **113+** |
| Backend unit tests | **613 passing** (46 test files) |
| HTTP routes ported to Hono | **110 / 110** (100%) — every Express route, including `/api/mastery/backfill` and `/api/analytics/students/:studentId/classes/:classId` (POST + DELETE) |
| Cron handlers on Hono Worker | **1** (grading dispatch loop) |
| New adapters built | **16** |
| Express code still in use | **0** (cutover-ready) |
| Worker bundle size | **3.78 MB / 1.15 MB gzipped** (Workers limit: 10 MB compressed) |
| Staging deployments | **3** — backend, frontend, grading-consumer (all isolated from prod) |
| End-to-end staging pipeline validated | ✅ Real upload → queue → consumer → Gemini → callback → DB → UI |
| Concerns open (C1–C9.1) | **2 open, 7 resolved/deferred** |
| Blockers to decommissioning Express | Operational only (prod Hyperdrive creation, prod secrets, parallel-run smoke) |

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
| **5.15** | Final route parity — `/api/grading-jobs/*` + `/api/worksheet-generation/*` | 4 | ✅ |
| **5.16** | Pre-cutover tooling — cleanup audit + parity smoke script | 3 | ✅ |
| **5.17** | Local smoke iteration — error-shape parity, hang detection, write-parity tests | 5 | ✅ |
| **5.18** | Staging environment provisioned — DO Postgres staging DB, Hyperdrive, R2, queue, secrets | 4 | ✅ |
| **5.19** | Workers + pg adapter fix — fresh-per-request prisma client | 2 | ✅ |
| **5.20** | Staging frontend deploy + frontend-driven bug iteration (CORS Cache-Control/Pragma/Expires, studentSummaries undefined) | 4 | ✅ |
| **5.21** | Sync with main — pulled in renderSpec, Workers AI Gemma, fallback-when-AI-Gateway, single-student worksheet generation | 1 (merge) | ✅ |
| **5.22** | Final 3 deferred routes — `/api/mastery/backfill`, `POST` + `DELETE /api/analytics/students/:studentId/classes/:classId` | 4 | ✅ |
| **5.23** | External-worker HTTP-contract audit (grading-consumer, pdf-renderer, question-generator) — 3 fixes: `batchId: null` accepted, `renderSpec` persisted, queue payload `v: 1` (not `version: 1`) | 3 | ✅ |
| **5.24** | Hyperdrive read-cache safety audit — 22 HIGH findings hardened across 6 route files via P2002/P2025 translation; shared `lib/prismaErrors.ts` helper extracted | 6 | ✅ |
| **5.25** | End-to-end grading pipeline validation — staging grading-consumer deployed, real Gemini grading round-trip succeeded against staging Hono | 1 | ✅ |
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

### Phase 5.15 — Final route parity

Closes the last two route-group gaps found in a parity audit against
`backend/src/index.ts`: `/api/grading-jobs/*` (4 endpoints) and
`/api/worksheet-generation/*` (5 endpoints). Introduces two new
prisma-injected adapters (`worksheetScheduler`, `worksheetGeneration`).

One behaviour change: `POST /api/worksheet-generation/generate` used to
call `renderBatchPdfs(ids)` (puppeteer) fire-and-forget. Puppeteer does
not run in Workers, so the port publishes each worksheet to the PDF
rendering queue (`PDF_RENDERING_QUEUE_ID`) — the same pattern
`/generate-class` already uses, consumed by the existing
`cloudflare/pdf-renderer` worker.

| Commit | Description |
|---|---|
| `96398eb` | feat: port /api/grading-jobs routes to hono |
| `29888a8` | feat: add worksheet scheduler adapter (planWorksheets) |
| `f859f19` | feat: add worksheet generation adapter (generate + class batch) |
| `ce8ed00` | feat: port /api/worksheet-generation routes to hono |

### Phase 5.16 — Pre-cutover tooling

Supporting docs and automation for the cutover itself. Nothing ships new
routes; everything here is either audit material (what to delete after
Express is off) or a reusable parity-check script.

| Commit | Description |
|---|---|
| `31e859a` | docs: add express cleanup audit for post-cutover removal |
| `4e0ca4d` | chore: add parity smoke-test script for hono vs express |

---

### Phase 5.17 — Local smoke iteration

Expanded the parity smoke-test matrix and added a write-parity counterpart
once `wrangler dev` was usable end-to-end against a local Postgres. Caught
two real parity drifts: Hono's 500 response shape diverged from Express's
generic `{message: ...}`, and the parity script aborted on `diff` non-zero
exit. Both fixed.

| Commit | Description |
|---|---|
| `57c91fc` | chore: align web-app node engine to 22.x to match backend |
| `84c2ef9` | fix(smoke): curl timeout + tolerate diff non-zero exit |
| `00bd16b` | fix(worker): match express 500 error response shape for parity |
| `e822fd4` | feat(smoke): expanded read-parity matrix + hang detection with retry |
| `832d376` | feat(smoke): add write-parity test for schools/users/notifications |

---

### Phase 5.18 — Staging environment provisioned

Provisioned a fully isolated staging environment so the worker could be
tested against real CF infrastructure (Hyperdrive, R2 binding, Queues,
secrets) without touching prod. Includes: a separate `worksheet_grading_hono_test`
database on the existing DO Postgres cluster, an idempotent migration that
restores `Worksheet.worksheetNumber` on fresh DBs (previously missing on
non-prod after a 2025 historical hotfix), a deterministic-fixture seed
script, and the `[env.staging]` block in `wrangler.toml`.

| Commit | Description |
|---|---|
| `a379155` | fix(prisma): add idempotent worksheetNumber column for fresh databases |
| `7290cad` | feat(prisma): add staging seed script with deterministic IDs |
| `0d44628` | feat(wrangler): add staging environment block |
| `89b8a5f` | chore(wrangler): re-enable staging cron after pg-pool fix |

---

### Phase 5.19 — Workers + pg adapter fix

Cached `PrismaClient` + `pg.Pool` at module scope across requests caused
~50% of deployed-staging requests to fail with "Workers runtime canceled
this request" (wallTime 1-3 ms). Workers freezes idle isolates and
Hyperdrive silently drops idle TCP sockets, so cached pools handed out
dead connections on the next wake. Switched to fresh-per-request with
`ctx.waitUntil(prisma.$disconnect())`. Verified Hyperdrive caps DB
connections at ~10 even at 1000-req/50-concurrent load.

| Commit | Description |
|---|---|
| `3b47c15` | fix(worker): build a fresh prisma client per request to avoid stale pools |

---

### Phase 5.20 — Staging frontend + UI-driven bug fixes

Deployed `worksheet-grading-web-staging` (separate from prod CF frontend
worker) pointing at the staging Hono backend. Real-frontend testing
surfaced bugs the curl smoke had missed: the web-app's `fetchAPI` helper
sends `Cache-Control`/`Pragma`/`Expires` cache-busters that weren't on the
worker's CORS allow-list, and `studentSummaries[id]` returned undefined
for students with same-day worksheets, crashing the upload page.

| Commit | Description |
|---|---|
| `5ad5f06` | chore(web-app): add staging environment to wrangler config |
| `5678a77` | fix(worker): allow Cache-Control and other browser headers in CORS |
| `2a7b087` | fix(worker): add Expires to CORS allowlist |
| `34d6f9a` | fix(worker): always populate studentSummaries for class-date |
| `625bfe1` | fix(seed-staging): reset isArchived on every fixture |

---

### Phase 5.21 — Sync with main

Pulled in 5 commits from main that landed during the porting window:
structured worksheet question rendering (`renderSpec`), Workers AI Gemma 4
question generator, AI Gateway fallback, single-student worksheet
generation. Merge resolution preserved every branch contribution and
adopted main's versions for the 8 prod files main had updated. 0 conflict
markers; 609 → 612 tests still green.

| Commit | Description |
|---|---|
| `0582132` | Merge remote-tracking branch 'origin/main' into refac/express_to_hono |

---

### Phase 5.22 — Final 3 deferred routes

A proper full-URL diff (mount prefix + relative path) showed only 3
routes were genuinely deferred, not the "~20" the fallback comment had
estimated. All three ported: mastery backfill (with the FSRS state
machine as a worker adapter), and the analytics-side
student-class assignment POST/DELETE pair. **110 / 110 routes**.

| Commit | Description |
|---|---|
| `1a005e4` | feat(worker): port mastery backfill route from express |
| `1374888` | feat(worker): port analytics student-class assignment routes |
| `ac47650` | fix(worker): make analytics student-class handlers Hyperdrive-cache safe |
| `2f27582` | chore(worker): update fallback comment now that all routes are ported |

---

### Phase 5.23 — External-worker HTTP-contract audit

Compared every `fetch()` call in `cloudflare/grading-consumer/`,
`cloudflare/pdf-renderer/`, and `cloudflare/question-generator/` against
the corresponding Hono `/internal/*` route's input schema and response
shape. **3 real contract drifts found:**

1. `pdf-renderer` types `batchId: string | null` and serializes JSON
   `null` for non-batch renders; Hono used `z.string().optional()` (≠
   nullable) → 400 on every single-worksheet render.
2. `question-generator` sends `renderSpec` for layout dispatch (long
   division, vertical arithmetic, MCQ); Hono's schema didn't declare it,
   so `c.req.valid('json')` stripped it and `createMany` persisted it as
   NULL — would have broken every special-render question post-cutover.
3. `dispatch.ts` and `worksheetProcessing.ts` published queue messages
   with `version: 1`; consumer reads `normalized.v` (matches Express's
   `GradingQueueMessageV1`). Consumer rejected every staging message with
   `Unsupported message version: undefined`.

| Commit | Description |
|---|---|
| `e156f6a` | fix(worker): accept batchId: null in worksheet-generation complete/fail |
| `8d61854` | fix(worker): persist renderSpec on /internal/question-bank/store |
| `aaae052` | fix(worker): publish queue messages with v:1 (not version:1) |

---

### Phase 5.24 — Hyperdrive read-cache safety audit

Cataloged every `findUnique → check → mutate` pattern across the worker
routes — they're vulnerable to Hyperdrive's read-cache returning stale
rows for a few seconds after a write, producing false-positive 400s
("already exists") or 404s ("not found") right after delete-then-recreate
or fresh-create flows. **22 HIGH findings** hardened via Prisma error
translation: drop the pre-check, let `create` surface P2002 → 400 and
`update`/`delete` surface P2025 → 404. Extracted reusable helpers into
`backend/src/worker/lib/prismaErrors.ts`.

| Commit | Description |
|---|---|
| `dbbca7e` | fix(worker): make classes.ts handlers Hyperdrive-cache safe (5 routes + shared lib/prismaErrors.ts) |
| `164d038` | fix(worker): make users.ts handlers Hyperdrive-cache safe (6 routes + getUniqueConstraintTarget helper) |
| `32de8bb` | fix(worker): make schools.ts handlers Hyperdrive-cache safe (4 routes; 2 advisory checks left documented) |
| `66a09f6` | fix(worker): make worksheetTemplates.ts handlers Hyperdrive-cache safe (6 routes) |
| `c1ed0c7` | fix(worker): make worksheets.ts mutation handlers Hyperdrive-cache safe (3 routes) |
| `cf297eb` | fix(worker): defend notifications mark-read update with P2025 catch |

---

### Phase 5.25 — End-to-end grading pipeline validation

Replicated the prod `cloudflare/grading-consumer/` Worker as a staging
copy via a single `[env.staging]` block (no code changes). Wired it to
the staging queue (`grading-fast-staging`), staging Hono backend, and
real Gemini API. End-to-end run succeeded: image upload through the
staging UI → cron dispatch → CF Queue → consumer → Gemini OCR + grading
→ `/internal/grading-worker/jobs/.../{acquire,heartbeat,complete}` → DB
worksheet + mastery write → graded result rendered in UI. ~21 s of
Gemini time per worksheet; staging stays fully isolated from prod queue,
prod consumer, prod DB.

| Commit | Description |
|---|---|
| `3c9815c` | chore(grading-consumer): add staging environment block |

---

## Route inventory (110 HTTP + 1 Cron)

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
| Mastery | `GET /mastery/student/:id`, `GET /:id/by-topic`, `GET /:id/recommendations`, `GET /mastery/class/:id`, `POST /mastery/backfill` | `routes/mastery.ts` |
| Analytics | `GET /analytics/schools`, `/schools/:id/classes`, `/overall`, `/students`, `/students/download`, `POST /students/:studentId/classes/:classId`, `DELETE /students/:studentId/classes/:classId` | `routes/analytics.ts` |
| Worksheets | 23 routes — reads, grade CRUD, admin mod, check-repeated, batch-save, Python utilities, multipart upload, class-date summary, incorrect-grading feed, recommend-next | `routes/worksheets.ts` |
| Worksheet processing | `POST /upload-session`, `GET /:batchId`, `POST /:batchId/finalize`, `POST /process` | `routes/worksheetProcessing.ts` |
| Grading jobs | `GET /grading-jobs/teacher/today`, `GET /class/:classId`, `GET /:jobId`, `POST /batch-status` | `routes/gradingJobs.ts` |
| Worksheet generation | `POST /worksheet-generation/generate`, `POST /generate-class`, `GET /batch/:batchId`, `GET /student/:studentId`, `GET /:id/pdf` | `routes/worksheetGeneration.ts` |

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

## Adapter inventory (16)

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
| `adapters/worksheetScheduler.ts` | `services/worksheetSchedulerService` | `planWorksheets` — FSRS-ish curriculum walker with mastery-weighted review picks |
| `adapters/worksheetGeneration.ts` | `services/worksheetGenerationService` + `worksheetBatchService` | `generateWorksheets`, `createClassBatch`, `buildSections` — question draw + queue enqueue |
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
| **C1** | Worker bundle size inflated by Prisma (3.6 MB; monitor) | 🟡 Open — monitor (3.78 MB now / 1.15 MB gzipped, well under the 10 MB compressed limit) |
| **C2** | Pre-existing Express test flake (`internalGradingWorkerController`) | ✅ Resolved (was a stale generated Prisma client) |
| **C3** | Node engine mismatch in local dev (22.x declared, 25 running) | ✅ Resolved in 5.17 (`web-app/package.json` engines pinned to 22.x) |
| **C4** | Dispatch loop migration | ✅ Resolved in Phase 5.14 |
| **C5** | Production secrets in `backend/.env` | 🔴 Open — **operational blocker for prod deploy** (resolved for staging in 5.18) |
| **C6** | Multer routes deferred past 5.8 | ✅ Resolved in Phase 5.13 |
| **C7** | Direct-upload session routes pending | ✅ Resolved in Phase 5.13 |
| **C8** | Internal grading-worker + question-bank deferred | ✅ Resolved in Phase 5.13 |
| **C9 / C9.1** | Complex/stateful routes deferred past 5.11 | ✅ Resolved in Phase 5.13 |
| **C10** | Workers + pg adapter pool staleness (50% staging-fail rate) | ✅ Resolved in Phase 5.19 (fresh-per-request) |
| **C11** | Hyperdrive read-cache staleness on `findUnique → check → mutate` | ✅ Resolved in Phase 5.24 (P2002/P2025 translation across 22 routes) |
| **C12** | External-worker contract drift (queue payload `v` vs `version`, `batchId: null` rejected, `renderSpec` dropped) | ✅ Resolved in Phase 5.23 |

---

## What's left before Express can be turned off

All **code-side** work is complete. Remaining items are operational.

### Already done for staging (a working reference)

Phases 5.18 + 5.25 walked through the full deploy + validate sequence
against an isolated staging environment. The same recipe is what gets
applied to prod for parallel-run, just with `--env production` and
prod-pointing values.

### Remaining for prod

| Step | Type | Who | Effort | Blocker type |
|---|---|---|---|---|
| 1. **Phase 0 — migration alignment**: run `prisma migrate status` against prod DB; apply any branch-introduced migrations (`20260214122800_ensure_worksheet_number_on_worksheet`, etc.) if missing | Ops + DBA | engineer + DBA | 5 min check, 15-30 min apply | Required |
| 2. Create prod Hyperdrive: `wrangler hyperdrive create worksheet-grading-pg-prod` | Ops | operator | 15 min | Required |
| 3. Add `[env.production]` block in `wrangler.toml` (Hyperdrive id, R2 binding, vars; cron initially disabled) | Config | operator | 5 min | Required |
| 4. `wrangler secret put --env production` for all secrets (`JWT_SECRET` — must match Express's value to keep existing tokens valid; `GRADING_WORKER_TOKEN`, `WORKSHEET_CREATION_WORKER_TOKEN`, `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_QUEUE_ID`, `PDF_RENDERING_QUEUE_ID`, R2 creds, `POSTHOG_API_KEY`) | Ops | operator | 15 min | Required (C5) |
| 5. `wrangler deploy --env production` — produces a `*.workers.dev` URL with **no DNS / route attached** | Deploy | engineer | 1 min | Required |
| 6. **Parallel-run smoke** — run `smoke-parity.sh` with WORKER_URL pointing at the new prod-deployed Hono worker and EXPRESS_URL pointing at live DO Express. Compare every read endpoint against real prod data. Triage any drifts. | Validation | engineer | ~1 hr | Required |
| 7. (Optional) **Write-path validation** — restore a prod DB snapshot to a clone, deploy a third env (`--env production-clone`), run `smoke-writes.mjs` against the clone | Validation | engineer | ~1 hr | Recommended |
| 8. Re-enable cron triggers for prod env (or have them on from step 3); verify via `wrangler tail --env production` | Validation | engineer | 5 min | Required pre-cutover |
| 9. **Cutover** — flip frontend `NEXT_PUBLIC_API_URL` to the new worker URL, redeploy frontend (or rotate DNS to the new worker for whichever surface routes traffic). The grading-consumer's `BACKEND_BASE_URL`, pdf-renderer's `WORKSHEET_CREATION_BACKEND_BASE_URL`, and question-generator's `WORKSHEET_CREATION_BACKEND_BASE_URL` also all need to point at the prod Hono URL — those are 3 separate `wrangler secret put` calls on the existing prod consumer/renderer/generator workers | Cutover | operator | 15 min | Required |
| 10. Monitor PostHog + `wrangler tail --env production` for 24-72 h | Observability | engineer | — | Recommended |
| 11. **Unset `EXPRESS_FALLBACK_URL`** once the soak window is clean (or just don't set it — every route is ported, so the fallback is vestigial) | Cutover | operator | 1 min | Required to retire Express |
| 12. Scale DigitalOcean App Platform to zero | Ops | operator | 2 min | Final step |
| 13. Delete Express-only code (`src/index.ts`, `routes/`, `controllers/`, stale services) + drop deps per `EXPRESS_CLEANUP_AUDIT.md` | Cleanup | engineer | ~5 commits | Post-cutover |

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

- **613 unit tests passing** across 46 test files (worker side)
- **565+ unit tests** in `cloudflare/grading-consumer/` (separate suite)
- **End-to-end staging pipeline validated** in Phase 5.25 — image upload → cron → CF Queue → real grading-consumer → real Gemini → DB persistence → UI render
- `smoke-parity.sh` and `smoke-writes.mjs` compare Hono vs Express response shapes against the same database
- Test framework: Vitest with mocked Prisma + mocked `fetch` for unit tests
- `npm test` from `backend/` runs the full suite in ~2 seconds
- `wrangler deploy --dry-run --env staging` succeeds (3.78 MB upload / 1.15 MB gzip)

---

## Quick reference

- **Migration plan (active document):** `CLOUDFLARE_MIGRATION_PLAN.md`
- **Deploy runbook:** `backend/DEPLOYMENT.md`
- **Post-cutover Express removal plan:** `EXPRESS_CLEANUP_AUDIT.md`
- **Branch:** `refac/express_to_hono`
- **First commit:** `1661ad6` (2026-04-13)
- **Latest commit:** `aaae052` (2026-05-04)
- **Staging URLs (CF account `2ffbc97...`):**
  - Backend: `worksheet-grading-api-staging.madhav-2ff.workers.dev`
  - Frontend: `worksheet-grading-web-staging.madhav-2ff.workers.dev`
  - Grading consumer: `worksheet-grading-consumer-staging.madhav-2ff.workers.dev`
- **Cutover-blocking work remaining:** ops only — see "What's left" above.
