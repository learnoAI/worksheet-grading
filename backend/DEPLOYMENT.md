# Hono Worker — Deployment Runbook

First-time deployment of the `worksheet-grading-api` worker. Follow these
steps in order; every step is idempotent so reruns are safe.

> **Pre-requisites**
> - Wrangler ≥ 4.82 logged in: `npx wrangler whoami`
> - `CLOUDFLARE_ACCOUNT_ID` exported in your shell — must be the account
>   that already hosts `worksheet-grading-consumer` and
>   `worksheet-grading-web`.
> - Access to `backend/.env` for reference values (prod DB, secrets).

---

## 1. Create the Hyperdrive

Hyperdrive is the Cloudflare-native Postgres pooler. It holds the
connection pool globally so Workers don't pay the TCP + TLS handshake
cost on every request.

```bash
# Copy the production DATABASE_URL from backend/.env first.
npx wrangler hyperdrive create worksheet-grading-pg \
  --connection-string="$PROD_DATABASE_URL"
```

Output prints a UUID. Copy it into `backend/wrangler.toml` under
`[[hyperdrive]]` and uncomment the block.

---

## 2. Reuse the existing R2 bucket

The existing grading consumer already writes to
`worksheet-grading-files`. We bind the same bucket so the Hono worker
reads files written by the grading pipeline.

```toml
[[r2_buckets]]
binding = "WORKSHEET_FILES"
bucket_name = "worksheet-grading-files"
```

(No CLI command — editing `wrangler.toml` is enough.)

---

## 3. Set secrets

Never put these in `wrangler.toml` — they go via `wrangler secret put`.
Run each of these once and paste the value from `backend/.env`:

```bash
cd backend

npx wrangler secret put JWT_SECRET
npx wrangler secret put GRADING_WORKER_TOKEN
npx wrangler secret put WORKSHEET_CREATION_WORKER_TOKEN

# Grading queue publisher (only if the Hono worker needs to enqueue;
# currently only the direct-upload finalize endpoint would, and that
# ships in Phase 5.13).
npx wrangler secret put CF_ACCOUNT_ID
npx wrangler secret put CF_API_TOKEN
npx wrangler secret put CF_QUEUE_ID

# PostHog analytics (leave unset to disable in prod initially).
# npx wrangler secret put POSTHOG_API_KEY

# R2 S3-compatible credentials for presigned URLs (Phase 5.13).
# npx wrangler secret put R2_ACCOUNT_ID
# npx wrangler secret put R2_ACCESS_KEY_ID
# npx wrangler secret put R2_SECRET_ACCESS_KEY
# npx wrangler secret put R2_BUCKET_NAME
# npx wrangler secret put R2_ENDPOINT
# npx wrangler secret put R2_PUBLIC_BASE_URL
```

Verify with `npx wrangler secret list`.

---

## 3a. Verify the Cron trigger is enabled

The `wrangler.toml` already declares the grading dispatch loop trigger:

```toml
[triggers]
crons = ["*/1 * * * *"]
```

After deploy, confirm the trigger is live:

```bash
npx wrangler triggers deploy
# or inspect via dashboard: Workers > worksheet-grading-api > Triggers
```

The first cron fire won't run dispatch (Prisma init may fail if
`DATABASE_URL` / Hyperdrive aren't configured yet) — this is by design
and emits a `dispatch_loop_crashed` PostHog event for visibility. Once
secrets land, subsequent fires pick up automatically.

## 4. Set non-secret vars

Uncomment the `[vars]` block in `wrangler.toml` and fill in for your
environment. The key one for parallel-run is `EXPRESS_FALLBACK_URL` —
point it at the current DigitalOcean App Platform backend so unported
routes keep working.

```toml
[vars]
NODE_ENV = "production"
CORS_ORIGINS = "https://worksheet-grading-web.madhav-2ff.workers.dev,https://app.saarthi.ai"
CF_API_BASE_URL = "https://api.cloudflare.com/client/v4"
POSTHOG_HOST = "https://us.i.posthog.com"
EXPRESS_FALLBACK_URL = "https://king-prawn-app-k2urh.ondigitalocean.app/worksheet-grading-backend"
```

---

## 5. Dry-run build

Before deploying, make sure the bundle still compiles with the new
bindings:

```bash
npm run worker:build
# → .open-next/... irrelevant here; wrangler writes to dist-worker
# Expect ~3.6 MB upload / ~1.1 MB gzip.
```

---

## 6. First deploy (staging env)

For safety, deploy as a separate environment first so production traffic
doesn't hit the new worker:

```bash
# Optional: create a named environment in wrangler.toml under [env.staging]
# to get a separate `worksheet-grading-api-staging` worker.
npx wrangler deploy --env staging
```

If you don't want a staging env yet, just deploy:

```bash
npm run worker:deploy
```

Wrangler prints the `.workers.dev` URL.

---

## 7. Smoke tests (manual)

Against the deployed URL, validate the key paths:

```bash
export URL="https://worksheet-grading-api.<subdomain>.workers.dev"

# Health + root
curl -sf $URL/health                       # → {"status":"ok"}
curl -sf $URL/                             # → "AssessWise API (hono worker)"

# Auth login (use a real test user)
curl -sf -X POST $URL/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"test","password":"test"}' | jq .

# Use the token for a protected route
export TOKEN="<token from login>"
curl -sf $URL/api/auth/me -H "Authorization: Bearer $TOKEN" | jq .

# Fallback: hit a Phase 5.13 route and confirm it reaches Express
curl -sfi $URL/api/worksheets/upload -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: multipart/form-data'
# Expect: Express's multer error (not Hono's 404).
```

---

## 8. Traffic cutover

Three options, pick one based on appetite:

1. **Instant DNS swap** — repoint `api.saarthi.ai` at the Hono worker.
   Everything lands on Hono; unported paths fall through to Express.
2. **Application-layer dual writes** — update the frontend
   `NEXT_PUBLIC_API_URL` to the new worker URL. Easy to roll back: change
   the env var back and redeploy.
3. **Edge traffic splitting** — put both workers behind a Cloudflare zone
   and use a route pattern to shift traffic gradually.

---

## 9. Post-cutover monitoring

For the first 24h:

- Watch `npx wrangler tail worksheet-grading-api` for unexpected errors.
- Check PostHog for `$exception` events coming from the Hono adapter.
- Watch the Express `/logs` for unusual 502 spikes — they'd mean the
  fallback proxy is over-routing.

---

## Rollback

The fastest rollback is to re-deploy the last known good version:

```bash
npx wrangler versions list
npx wrangler rollback --version-id <uuid>
```

Or — during the parallel-run phase — just switch the frontend
`NEXT_PUBLIC_API_URL` back to the Express URL. The Hono worker stays up
but receives no traffic.

---

## Reference: production secret matrix

| Secret | Source | Used by |
|---|---|---|
| `JWT_SECRET` | `backend/.env#JWT_SECRET` | `middleware/auth.ts`, login/me |
| `GRADING_WORKER_TOKEN` | `backend/.env#GRADING_WORKER_TOKEN` | `middleware/workerTokens.ts` (internal grading-worker routes — Phase 5.13) |
| `WORKSHEET_CREATION_WORKER_TOKEN` | `backend/.env#WORKSHEET_CREATION_WORKER_TOKEN` | `routes/internalWorksheetGeneration.ts` |
| `CF_ACCOUNT_ID`, `CF_API_TOKEN`, `CF_QUEUE_ID` | `backend/.env` | `adapters/queues.ts` (Phase 5.13) |
| `POSTHOG_API_KEY` | `backend/.env#NEXT_PUBLIC_POSTHOG_KEY` | `adapters/posthog.ts` |
| `R2_*` | `backend/.env` | `adapters/storage.ts` (presigned URLs — Phase 5.13) |

**Do not copy production secrets into `.dev.vars`** — dev should point
at a local Postgres and use a dev-only JWT.

## Concerns tracked in the migration plan

See `CLOUDFLARE_MIGRATION_PLAN.md` for the living list. Deployment
depends on at least C4 (dispatch loop placement) and C5 (secret
migration) being addressed before full cutover.
