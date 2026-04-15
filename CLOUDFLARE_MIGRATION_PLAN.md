# Cloudflare Migration Plan — Worksheet Grading Platform

**Created:** 2026-04-13
**Status:** Planning

---

## Current Stack Summary

| Layer             | Current                                                               | Status                       |
| ----------------- | --------------------------------------------------------------------- | ---------------------------- |
| **Backend**       | Express.js (Node.js 22) on DigitalOcean App Platform                  | Needs migration              |
| **Frontend**      | Next.js 14.2.25 with React 18                                         | Needs migration              |
| **Mobile**        | Expo 54 / React Native 0.81                                           | No change needed             |
| **Database**      | PostgreSQL via Prisma 6.19 (20+ migrations)                           | Keep, connect via Hyperdrive |
| **Queue**         | Cloudflare Queues (`grading-fast` + DLQ)                              | Already on CF                |
| **Storage**       | Cloudflare R2 (primary) + AWS S3 (legacy fallback)                    | Already on CF                |
| **Workers**       | Grading consumer worker (`worksheet-grading-consumer`)                | Already on CF                |
| **AI**            | Google Gemini API (flash models for OCR + grading)                    | Keep, proxy via AI Gateway   |
| **Auth**          | JWT-based with bcrypt, 4-tier RBAC (SUPERADMIN/ADMIN/TEACHER/STUDENT) | Port to Workers              |
| **Analytics**     | PostHog (frontend + backend)                                          | Keep as-is                   |
| **Error Logging** | Optional MongoDB                                                      | Drop, use Logpush            |
| **Legacy Queue**  | Bull + Redis (disabled, `ENABLE_LEGACY_BULL_QUEUE=false`)             | Remove                       |
| **Legacy AI**     | Python API on DigitalOcean (fallback grader)                          | Remove                       |

---

## Target Architecture

```
                    ┌-────────────────────────────────-─┐
                    │       Cloudflare Edge             │
                    │                                   │
   Mobile App ─────-┤  ┌-──────────────────────────┐    │
   (Expo)           │  │  Workers (Hono API)       │    │
                    │  │  - Auth middleware (JWT)  │    │
   Web Browser ────-┤  │  - Route handlers         │    │
                    │  │  - Prisma + Hyperdrive    │    │
                    │  │  - Zod validation         │    │
                    │  └──────┬───────┬────────────┘    │
                    │         │       │                 │
                    │    ┌────▼──┐ ┌──▼───────────--─┐  │
                    │    │Queues │ │KV (cache/       │  │
                    │    │       │ │ sessions/config)│  │
                    │    └───┬───┘ └───────────────--┘  │
                    │        │                          │
                    │  ┌─────▼─────────────────── ─┐    │
                    │  │ Grading Worker            │    │
                    │  │ (existing consumer)       │    │
                    │  │ → migrate to Workflows    │    │
                    │  └─────┬──────────────────── ┘    │
                    │        │                          │
                    │  ┌─────▼──┐  ┌─────────────── ┐   │
                    │  │AI Gate │  │      R2        │   │
                    │  │(Gemini)│  │  (images)      │   │
                    │  └────────┘  └─────────────── ┘   │
                    │                                   │
                    │  ┌─────────────────────────-─┐    │
                    │  │ Workers + Static Assets   │    │
                    │  │ (Next.js via OpenNext)    │    │
                    │  └──────────────────────────-┘    │
                    └──────────────┬────────────────────┘
                                   │ Hyperdrive
                           ┌─────-─▼──────┐
                           │ PostgreSQL   │
                           │ (managed DB) │
                           └──────-───────┘
```

---

## Cloudflare Services Mapping

### Workers (Serverless Compute) — Backend API

**Purpose:** Replace Express.js on DigitalOcean App Platform.

**Framework:** Hono (Express-like API, built for Workers)

**Why Hono over Express:**

- Hono is built for Workers/edge runtimes; Express relies on `node:http` server model
- Express-like API — middleware, routing, context — so the port is mechanical
- Sub-millisecond cold starts vs. Containers' multi-second cold starts
- Same middleware pattern (auth, validation, CORS)

**Why not Cloudflare Containers:**

- The codebase has no `child_process`, native addons, or other Workers-incompatible deps
- Containers have cold start overhead and higher cost
- Only use Containers if Workers limits are hit (128 MB memory, 30s CPU)

**Pricing (Paid $5/month):**

- 10M requests/month included, $0.30/additional million
- 30M CPU-ms included, $0.02/additional million
- Zero egress charges

**Limits:**

- 30s CPU time per request (up to 15 min for Queue/Cron consumers)
- 128 MB memory per isolate
- 10 MB compressed script size
- 10,000 subrequests per invocation

**Key migration notes:**

- Enable `nodejs_compat` flag (date >= 2024-09-23) for Node.js built-in modules
- `jsonwebtoken` works on Workers with `nodejs_compat`
- Replace `multer` with Workers-native `FormData` parsing
- Replace `express-validator` with Zod (already used on frontend)
- Never store request-scoped data in module-level variables (isolates are reused)
- Use `ctx.waitUntil()` for fire-and-forget work (analytics, cache writes)

---

### Hyperdrive — Database Connection Pooling

**Purpose:** Connect Workers to the existing PostgreSQL database.

**Why:** Workers are stateless V8 isolates — they can't maintain persistent TCP connections. Hyperdrive solves this by managing a regional connection pool + query cache.

**Prisma compatibility:** Use `@prisma/adapter-pg` driver adapter for Workers support.

**Pricing:** Free (included with Workers plan).

**Setup:**

```bash
npx wrangler hyperdrive create my-hyperdrive \
  --connection-string="postgres://user:pass@host:5432/dbname"
```

**Why not D1 (SQLite):**

- 20+ Prisma migrations would need rewriting for SQLite dialect
- PostgreSQL-specific features (JSONB, arrays, full-text search) would be lost
- High risk, low reward for an established schema
- D1 max size is 10 GB, may be limiting long-term

**When D1 makes sense:** New microservices, per-worker config stores, feature flags.

---

### Workers with Static Assets — Frontend

**Purpose:** Deploy Next.js 14 on Cloudflare's edge.

**Approach:** Use `@opennextjs/cloudflare` (OpenNext adapter).

- Static assets served for free from Workers
- SSR runs in Workers with edge-fast response times
- Single deployment artifact

**Considerations:**

- Next.js image optimization needs Cloudflare Images or a custom image loader
- ISR (`revalidate`) may need KV or R2 for caching
- Test SSR routes thoroughly — OpenNext is mature but not 100% feature-complete
- `next/font` and `next/image` may need configuration adjustments

**Why not Cloudflare Pages:**

- Cloudflare is merging Pages into Workers; all new features land on Workers first
- Workers with Static Assets has full feature parity
- Single deployment model for both frontend and API

---

### AI Gateway — AI API Proxy

**Purpose:** Proxy Google Gemini API calls for observability, caching, and cost control.

**Benefits:**

- Free analytics dashboard — cost, latency, error rates for all AI calls
- Response caching — avoid paying Gemini for identical prompts (e.g., same worksheet)
- Rate limiting — protect against runaway API costs
- Fallback providers — route to backup model if Gemini is down
- No code change in grading worker — just change the base URL

**Pricing:** Core features free. Logs: 100K/month free, 10M/gateway on paid.

**Implementation:** Change `GEMINI_API_KEY` base URL in the grading worker's `gemini.ts` to point through AI Gateway endpoint.

---

### Queues — Message Queue (Already Deployed)

**Current config:**

- Queue: `grading-fast`
- Dead-letter queue: `grading-fast-dlq`
- Batch size: 3, max concurrency: 250
- REST API integration via `CloudflareQueueClient`

**No changes needed.** Already production.

---

### Workflows — Durable Execution

**Purpose:** Replace custom heartbeat/stale-processing logic in the grading pipeline with built-in durability.

**Use cases:**

- Multi-step grading: OCR → grade → store results → notify
- Automatic retries with backoff on Gemini failures
- Long-running jobs exceeding 15-minute Queue consumer limit
- Wait for external events (e.g., human review approval)

**Pricing:** Same as Workers (CPU time + requests). Zero cost while waiting/sleeping.

**Migration path:** Wrap existing grading worker logic in Workflow steps. Each step auto-retries on failure and persists state.

---

### R2 — Object Storage (Already Deployed)

**Current config:**

- Primary bucket: `worksheet-grading-files`
- Assets bucket: `worksheet-grading-assets`
- Public base URL configured via `R2_PUBLIC_BASE_URL`

**Action items:**

- Migrate remaining AWS S3 images to R2 (one-time script)
- Remove S3 fallback code path and `aws-sdk` dependency
- Add R2 lifecycle rules for automatic cleanup of old/temporary files

**Pricing:** $0.015/GB-month storage, zero egress. Class A ops $4.50/million, Class B $0.36/million.

---

### KV — Key-Value Store

**Purpose:** Caching layer for read-heavy, eventually-consistent data.

**Use cases:**

- JWT session/refresh token storage
- Feature flags and app configuration
- Grading prompt templates
- Cached database query results with TTL
- Rate limiting counters

**Pricing (Paid):** 10M reads/month, 1M writes/month included. $0.50/million additional reads.

**Note:** Eventually consistent (up to 60s propagation). Not for strongly consistent data — use D1 or Durable Objects for that.

---

### Cloudflare Access (Zero Trust) — Auth Enhancement

**For internal/admin tools only:**

- Protect admin panels with SSO (Google, Okta, etc.)
- No code changes needed — reverse proxy authentication
- Free for up to 50 users

**For student/teacher API:** Keep JWT-based auth (port middleware to Hono).

---

### Observability

| Current                     | Target                                                   |
| --------------------------- | -------------------------------------------------------- |
| PostHog (product analytics) | Keep as-is                                               |
| MongoDB (error logging)     | Drop — use Logpush                                       |
| Custom diagnostics          | Workers Analytics Engine (free)                          |
| Console logs                | Workers `console.log` + Logpush to preferred destination |

---

## Migration Phases

### Phase 1 — AI Gateway for Gemini (Quick Win)

**Effort:** Low | **Risk:** Very Low | **Duration:** 1 day

- [ ] Create AI Gateway in Cloudflare dashboard
- [ ] Update `GEMINI_API_KEY` base URL in grading worker
- [ ] Verify grading still works end-to-end
- [ ] Enable caching for repeated prompts
- [ ] Set up rate limiting

### Phase 2 — Drop AWS S3 Fallback

**Effort:** Low | **Risk:** Low | **Duration:** 1-2 days

- [ ] Audit remaining S3-only images, write migration script
- [ ] Run migration: copy all S3 images to R2
- [ ] Verify all image URLs resolve from R2
- [ ] Remove S3 fallback code in storage layer
- [ ] Remove `aws-sdk` from `package.json`
- [ ] Remove S3 environment variables

### Phase 3 — Drop MongoDB Error Logging

**Effort:** Low | **Risk:** Low | **Duration:** 1 day

- [ ] Set up Logpush for Workers logs
- [ ] Remove `errorLogService.ts` MongoDB integration
- [ ] Remove `mongodb` from `package.json`
- [ ] Remove `MONGO_URL` environment variable

### Phase 4 — Remove Legacy Bull/Redis Queue

**Effort:** Low | **Risk:** Low | **Duration:** 1 day

- [ ] Remove Bull queue code (already disabled)
- [ ] Remove `bull` from `package.json`
- [ ] Remove `REDIS_URL`, `ENABLE_LEGACY_BULL_QUEUE` env vars
- [ ] Remove Python API fallback code
- [ ] Remove `PYTHON_API_URL` and related env vars
- [ ] Remove `bottleneck` dependency (rate limiter for Python API)

### Phase 5 — Port Backend to Hono + Hyperdrive (Major)

**Effort:** High | **Risk:** Medium | **Duration:** 2-4 weeks

**Substeps:**

#### 5a. Setup & Infrastructure

- [ ] Create new Worker project with Hono
- [ ] Set up Hyperdrive connection to PostgreSQL
- [ ] Configure Prisma with `@prisma/adapter-pg` for Workers
- [ ] Set up `wrangler.toml` with bindings (R2, KV, Queues, Hyperdrive)
- [ ] Set up local dev with `wrangler dev`

#### 5b. Port Middleware

- [ ] Port CORS middleware to Hono
- [ ] Port JWT auth middleware to Hono
- [ ] Port role-based authorization middleware
- [ ] Replace `express-validator` with Zod schemas
- [ ] Port error handling middleware
- [ ] Port request logging/diagnostics

#### 5c. Port Routes (route-by-route)

- [ ] Port auth routes (login, register, token refresh)
- [ ] Port user management routes
- [ ] Port worksheet/grading routes
- [ ] Port file upload routes (replace multer with FormData)
- [ ] Port admin routes
- [ ] Port any remaining routes

#### 5d. Integration & Cutover

- [ ] Set up service bindings for gradual traffic migration
- [ ] Run both Express and Hono in parallel
- [ ] Shift traffic route-by-route
- [ ] Full cutover — decommission DigitalOcean App Platform
- [ ] Update mobile app API base URL

### Phase 6 — Deploy Next.js on Workers

**Effort:** Medium | **Risk:** Medium | **Duration:** 1 week

- [ ] Install `@opennextjs/cloudflare` adapter
- [ ] Configure `wrangler.toml` for static assets
- [ ] Test all SSR routes
- [ ] Configure image optimization (Cloudflare Images or custom loader)
- [ ] Test ISR/revalidation behavior
- [ ] Set up custom domain
- [ ] Deploy and verify

### Phase 7 — Add Workflows for Grading Pipeline

**Effort:** Medium | **Risk:** Low | **Duration:** 1 week

- [ ] Define Workflow steps: OCR → grade → store → notify
- [ ] Add retry logic with exponential backoff per step
- [ ] Replace custom heartbeat/stale-processing logic
- [ ] Add human-review wait step (optional)
- [ ] Test failure scenarios and DLQ behavior
- [ ] Deploy alongside existing Queue consumer

### Phase 8 — Add KV Caching Layer

**Effort:** Low | **Risk:** Low | **Duration:** 2-3 days

- [ ] Create KV namespaces (sessions, config, cache)
- [ ] Add KV bindings to `wrangler.toml`
- [ ] Cache grading prompt templates in KV
- [ ] Cache frequently-accessed DB queries with TTL
- [ ] Add feature flag support via KV
- [ ] Store app configuration in KV

---

## Cost Comparison

### Current (Estimated)

| Service                             | Monthly Cost  |
| ----------------------------------- | ------------- |
| DigitalOcean App Platform (backend) | $12-24+       |
| PostgreSQL (managed)                | $15-50+       |
| AWS S3 (storage + egress)           | Variable      |
| Cloudflare Workers (grading)        | $5 base       |
| Redis (Bull queue)                  | $0 (disabled) |

### Target (Estimated)

| Service                                    | Monthly Cost                 |
| ------------------------------------------ | ---------------------------- |
| Cloudflare Workers Paid Plan (all compute) | $5 base                      |
| Workers usage (API + frontend + grading)   | Pay-per-use above free tier  |
| R2 storage                                 | $0.015/GB-month, zero egress |
| Hyperdrive                                 | Free                         |
| AI Gateway                                 | Free (core features)         |
| KV                                         | Included in base             |
| Queues                                     | Included in base             |
| PostgreSQL (managed, external)             | $15-50+ (unchanged)          |

**Net savings:** DigitalOcean App Platform cost eliminated, S3 egress eliminated, Redis cost eliminated. Single $5/month base with pay-per-use scaling.

---

## Key Technical Constraints

1. **Workers memory limit:** 128 MB per isolate — stream large files, don't buffer
2. **Workers CPU limit:** 30s per request (15 min for Queue/Cron consumers)
3. **No persistent filesystem:** Use R2 for all file storage
4. **No persistent TCP connections:** Use Hyperdrive for database access
5. **KV is eventually consistent:** Up to 60s propagation — don't use for strongly consistent data
6. **Some npm packages won't work:** Anything using `child_process`, `cluster`, or native addons
7. **Prisma on Workers:** Requires `@prisma/adapter-pg` driver adapter, not the default Prisma client
8. **Next.js on Workers:** Some features may behave differently — test ISR, middleware, image optimization

---

## Rollback Strategy

Each phase is independent and reversible:

- **Phases 1-4:** Code removal — revert via git if needed
- **Phase 5:** Run Express and Hono in parallel via service bindings; roll back by routing traffic back to Express
- **Phase 6:** Keep existing frontend deployment running until Workers deployment is verified
- **Phases 7-8:** Additive features — disable by removing bindings

---

## Dependencies to Add

```
hono                        # Express replacement for Workers
@prisma/adapter-pg          # Prisma driver adapter for Workers
@opennextjs/cloudflare      # Next.js adapter for Workers
@cloudflare/vitest-pool-workers  # Testing in Workers runtime
```

## Dependencies to Remove

```
aws-sdk                     # S3 fallback (Phase 2)
mongodb                     # Error logging (Phase 3)
bull                        # Legacy queue (Phase 4)
bottleneck                  # Python API rate limiter (Phase 4)
multer                      # File uploads — use native FormData (Phase 5)
express-validator           # Replace with Zod (Phase 5)
express                     # Replace with Hono (Phase 5)
cors                        # Built into Hono (Phase 5)
form-data                   # Native in Workers (Phase 5)
```

---

## Known Concerns / Tracked Issues

Items discovered during migration that do not block current progress but must
be revisited before full cutover (Phase 5.12) or soon after.

### C1 — Worker bundle size inflated by Prisma client

**Discovered:** Phase 5.5 (auth routes on Hono worker).

**Observation:** Before mounting Prisma-using routes, the worker bundle is
~87 KiB. After importing `@prisma/client` for the auth route, the bundle
jumps to ~3.4 MB uncompressed / ~1.1 MB gzipped. Cloudflare Workers paid
plan allows up to 10 MB compressed, so we are under the limit but with
only ~9 MB of headroom — and we have not yet ported the other 14 route
groups that will pull in more Prisma model code.

**Why it matters:**

- Larger bundles increase Worker cold-start time (isolate boot + JS parse).
- We risk hitting the 10 MB cap as more models and business logic ship.
- Prisma's default client bundles the entire query engine, including code
  paths we do not use (e.g. MongoDB adapter, Data Proxy transport).

**Mitigation options (in preference order):**

1. **Prisma `client` generator with Workers target.** Regenerate the client
   with `generator client { provider = "prisma-client"; runtime = "workerd"; moduleFormat = "esm"; output = "..." }`.
   The new-style generator emits a smaller Workers-optimized client and
   supports tree-shaking per-model code. Requires Prisma 6.7+ (we are on
   6.19, so supported).
2. **Scope Prisma imports.** Import `PrismaClient` only where needed and
   audit route files to avoid accidental re-exports that pull the whole
   client into every route's tree.
3. **Prisma Accelerate (paid service).** Moves query execution to
   Cloudflare-adjacent proxies, leaving the Worker with a thin HTTP client
   (<50 KiB). Adds vendor dependency and per-query cost; treat as fallback.
4. **Split deploys.** If the bundle keeps growing, split into multiple
   Workers (e.g. public API worker vs internal worker) routed via service
   bindings or path-based routing.

**When to address:** Before Phase 5.11 (complex route batch), or earlier
if dev builds approach 7 MB compressed. Track bundle size after every
phase as a smoke check.

**Tracking:** Re-measure at end of each sub-phase with
`cd backend && npx wrangler deploy --dry-run --outdir=dist-worker` and
record the `Total Upload` size.

### C2 — Pre-existing Express test flake: `internalGradingWorkerController.test.ts`

**Discovered:** Phase 5.1, self-resolved in Phase 5.2.

**Observation:** On first run the test failed with
`TypeError: Cannot read properties of undefined (reading 'NOT_STARTED')` at
`masteryService.ts:192`. Re-ran after `npx prisma generate` in Phase 5.2
and it passed; has been stable since. Root cause was a stale generated
Prisma client where the `MasteryLevel` enum had not been regenerated after
a recent schema change.

**Action:** Add a `postinstall` guard that runs `prisma generate` (already
present) and ensure CI does the same. No code change needed now.

### C3 — Node engine mismatch in local dev

**Discovered:** Phase 5.2 (npm install warnings).

**Observation:** `backend/package.json` declares `"engines": { "node": "22.x" }`
but the local machine runs Node 25. npm emits `EBADENGINE` warnings and
some transitive packages (notably `jsonwebtoken`'s `buffer-equal-constant-time`)
fail to initialize in the Vitest runtime. We worked around this in the
worker by using `hono/jwt` instead.

**Why it matters:** The Express server still uses `jsonwebtoken`. If
production runs on Node 22.x (per `engines`), this is invisible there, but
any developer running on a newer Node version gets a broken test suite for
Express code paths.

**Mitigation:** Either (a) loosen the engines range to `">=22"` after
validating Node 24/25 compatibility for the Express stack, or (b) document
that contributors must use Node 22.x locally (e.g. via `.nvmrc`).

**When to address:** Opportunistically. Not urgent while Express is being
deprecated.

### C4 — `GRADING_DISPATCH_LOOP_ON_WEB=true` on current Express

**Discovered:** Background knowledge during exploration (Phase 5 planning).

**Observation:** The current Express server runs the grading dispatch loop
in-process (`GRADING_DISPATCH_LOOP_ON_WEB=true` in `backend/.env`). When
we cut Hono over, the Hono Worker is request-scoped and cannot host a
long-running interval loop. The dispatch loop needs to move to either (a)
a Cloudflare Cron-triggered Worker, (b) a Durable Object with alarms, or
(c) stay on a small Node host during a transition window.

**Why it matters:** Cutover plan must not decommission the Express web
server until a replacement dispatch loop is running, or grading jobs will
stop being picked up.

**When to address:** Phase 5.12 (cutover). Pre-requisite for turning off
the DO App Platform instance.

### C6 — Multer-using routes deferred past Phase 5.8

**Discovered:** Phase 5.8 (file upload routes).

**Observation:** Only two endpoints in the Express backend actually use
Multer: `POST /api/worksheets/upload` and `POST /api/worksheet-processing/process`.
Phase 5.8 delivered the `parseMultipartFiles` helper (a Multer replacement
for Workers) but did not port the two routes themselves, because both also
depend on service-layer code that is not yet Workers-compatible:

- `POST /api/worksheets/upload` — calls `s3Service.uploadToS3`, which uses
  `aws-sdk` v2 (Node-only). Must migrate to `aws4fetch` or AWS SDK v3 in
  Phase 5.10.
- `POST /api/worksheet-processing/process` — calls the Python API with
  `node-fetch` and `form-data`. Must migrate to native `fetch` + native
  `FormData` in Phase 5.10.

**When to address:** Phase 5.11 (complex routes), after service adaptations
in Phase 5.10 land. The `parseMultipartFiles` helper is ready and tested;
the routes are thin layers on top of it.

### C7 — Worksheet-processing direct-upload session routes pending

**Discovered:** Phase 5.8 scope review.

**Observation:** The direct-upload session routes
(`POST /api/worksheet-processing/upload-session`,
`GET /api/worksheet-processing/upload-session/:batchId`,
`POST /api/worksheet-processing/upload-session/:batchId/finalize`) are
pure JSON endpoints (no Multer), but they still depend on
`s3Service.getPresignedUrl` and the Cloudflare Queue publisher service.
They were not ported in Phase 5.8 and are tracked for Phase 5.10/5.11.

**When to address:** Phase 5.11, bundled with the Multer-using routes.

### C5 — Production credentials currently in `backend/.env`

**Discovered:** Phase 5 planning (env file review).

**Observation:** `backend/.env` contains live production secrets
(database URL, JWT secret, CF API tokens, R2 keys, Mongo URL) — fine for
single-developer local dev with a `.gitignore`'d file, but risky if the
backend worker inherits the same resolution chain. The worker reads from
`.dev.vars` / wrangler secrets, not `backend/.env`, so this is already
isolated, but the principle stands.

**Action:** Before deploying the Hono worker to production, migrate all
secrets to `wrangler secret put`. Never copy production values into
`.dev.vars`.

**When to address:** Phase 5.12 (deployment prep).
