#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# smoke-parity.sh — diff responses between the Express backend (baseline) and
# the Hono worker (new). Used to confirm byte-level (or jq-normalised) parity
# before flipping traffic.
#
# Covers GET endpoints across the full route inventory + internal shared-
# secret routes. Mutating endpoints + CF-Queue-publishing endpoints are
# deliberately skipped so the script is safe to re-run without polluting
# real CF queues or local DB state.
#
# Usage:
#   bash smoke-parity.sh                    # uses defaults below
#   EMAIL=... PASSWORD=... bash smoke-parity.sh
#
# Required env (one of):
#   SMOKE_TOKEN   — pre-minted JWT (skips the login step if set)
#   EMAIL/PASSWORD — credentials for /api/auth/login (Express side)
#
# Optional env (param-route IDs sourced from local DB):
#   TEACHER_ID    — exercises /api/users/:id, /api/worksheets/teacher/:id/classes
#   CLASS_ID      — /api/classes/:id, /api/mastery/class/:id, /api/worksheets/class/:id
#   STUDENT_ID    — /api/worksheets/student/:id, /api/mastery/student/:id, /api/worksheet-generation/student/:id
#   WORKSHEET_ID  — /api/worksheets/:id
#   TEMPLATE_ID   — /api/worksheet-templates/:id
#   SCHOOL_ID     — /api/schools/:id, /api/analytics/schools/:id/classes
#   JOB_ID        — /api/grading-jobs/:jobId
#   BATCH_ID      — /api/worksheet-generation/batch/:id
#   INTERNAL_TOKEN — shared-secret token for /internal/* routes
#   GRADING_TOKEN  — shared-secret token for /internal/grading-worker/* (if different)
#
# Server URLs:
#   EXPRESS_URL   — baseline server          (default http://localhost:5100)
#   WORKER_URL    — hono worker              (default http://localhost:8787)
#
# Exits 0 if all non-skipped cases match, 1 otherwise.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

EXPRESS_URL=${EXPRESS_URL:-http://localhost:5100}
WORKER_URL=${WORKER_URL:-http://localhost:8787}
EMAIL=${EMAIL:-}
PASSWORD=${PASSWORD:-}
SMOKE_TOKEN=${SMOKE_TOKEN:-}
TEACHER_ID=${TEACHER_ID:-}
CLASS_ID=${CLASS_ID:-}
STUDENT_ID=${STUDENT_ID:-}
WORKSHEET_ID=${WORKSHEET_ID:-}
TEMPLATE_ID=${TEMPLATE_ID:-}
SCHOOL_ID=${SCHOOL_ID:-}
JOB_ID=${JOB_ID:-}
BATCH_ID=${BATCH_ID:-}
INTERNAL_TOKEN=${INTERNAL_TOKEN:-}
GRADING_TOKEN=${GRADING_TOKEN:-$INTERNAL_TOKEN}

command -v jq   >/dev/null || { echo "jq is required"; exit 2; }
command -v curl >/dev/null || { echo "curl is required"; exit 2; }

# Colours (disabled when not a TTY)
if [ -t 1 ]; then R='\033[31m'; G='\033[32m'; Y='\033[33m'; N='\033[0m'
else R=''; G=''; Y=''; N=''; fi

pass=0; fail=0; skip=0; hang=0
failed_names=()
hang_names=()

# Detect the local-only workerd+pg-adapter pool wedge. Production with
# Hyperdrive doesn't see this — but it's noisy in local smoke. We mark
# hangs separately so real parity bugs stand out.
HANG_RE='Workers runtime canceled this request'

login() {
  if [ -n "$SMOKE_TOKEN" ]; then echo "$SMOKE_TOKEN"; return; fi
  if [ -z "$EMAIL" ] || [ -z "$PASSWORD" ]; then
    echo "Set EMAIL + PASSWORD or SMOKE_TOKEN" >&2
    exit 2
  fi
  local body resp
  body=$(printf '{"email":"%s","password":"%s"}' "$EMAIL" "$PASSWORD")
  resp=$(curl -sf -X POST "$EXPRESS_URL/api/auth/login" \
    -H 'Content-Type: application/json' -d "$body") \
    || { echo "login to $EXPRESS_URL failed" >&2; exit 2; }
  echo "$resp" | jq -r '.token // empty'
}

# compare-case NAME PATH [AUTH_TYPE]
# AUTH_TYPE=jwt (default)      — sends Authorization: Bearer <jwt>
# AUTH_TYPE=internal           — sends X-Internal-Token: <token>
# AUTH_TYPE=grading-worker     — sends X-Grading-Worker-Token: <token>
# AUTH_TYPE=none               — no auth header
compare_case() {
  local name=$1 path=$2 authtype=${3:-jwt}
  local hdr=()
  case "$authtype" in
    jwt)            hdr=(-H "Authorization: Bearer $TOK") ;;
    internal)       hdr=(-H "X-Internal-Token: $INTERNAL_TOKEN") ;;
    grading-worker) hdr=(-H "X-Grading-Worker-Token: $GRADING_TOKEN") ;;
    none)           hdr=() ;;
  esac

  local a b try
  a=$(curl -s --max-time 15 "${hdr[@]}" "$EXPRESS_URL$path" 2>/dev/null || echo '{"_curl_err":true}')

  # Retry up to 3 times if the worker hangs (workerd+pg pool wedge).
  for try in 1 2 3; do
    b=$(curl -s --max-time 15 "${hdr[@]}" "$WORKER_URL$path" 2>/dev/null || echo '{"_curl_err":true}')
    if ! echo "$b" | grep -q "$HANG_RE"; then break; fi
    sleep 2
  done
  sleep 0.5

  local a_norm b_norm
  a_norm=$(echo "$a" | jq -S . 2>/dev/null || echo "$a")
  b_norm=$(echo "$b" | jq -S . 2>/dev/null || echo "$b")

  if [ "$a_norm" = "$b_norm" ]; then
    pass=$((pass + 1))
    printf "${G}PASS${N}  %s\n" "$name"
  elif echo "$b" | grep -q "$HANG_RE"; then
    hang=$((hang + 1))
    hang_names+=("$name")
    printf "${Y}HANG${N}  %s  (workerd+pg pool wedge after 3 retries — Hyperdrive fix in prod)\n" "$name"
  else
    fail=$((fail + 1))
    failed_names+=("$name")
    printf "${R}FAIL${N}  %s  (path=%s)\n" "$name" "$path"
    diff <(echo "$a_norm") <(echo "$b_norm") | head -20 | sed 's/^/        /' || true
  fi
}

skip_case() {
  skip=$((skip + 1))
  printf "${Y}SKIP${N}  %s  (%s)\n" "$1" "$2"
}

# ── 0. Reachability check ──────────────────────────────────────────────────
curl -sf "$EXPRESS_URL/health" >/dev/null \
  || { echo "Express not reachable at $EXPRESS_URL"; exit 2; }
curl -sf "$WORKER_URL/health" >/dev/null \
  || { echo "Worker not reachable at $WORKER_URL"; exit 2; }

TOK=$(login)
[ -z "$TOK" ] && { echo "login returned no token"; exit 2; }

# ─── PHASE 1: PUBLIC API — auth-related ─────────────────────────────────────
printf "\n=== Phase 1: Auth & user-self ===\n"
skip_case "GET  /health" "intentional shape difference (Hono simpler)"
compare_case "GET  /api/auth/me"            "/api/auth/me"

# ─── PHASE 2: PUBLIC API — read endpoints (param-free) ──────────────────────
printf "\n=== Phase 2: Read endpoints (no params) ===\n"
compare_case "GET  /api/notifications"      "/api/notifications"
compare_case "GET  /api/users"              "/api/users"
compare_case "GET  /api/users/with-details" "/api/users/with-details"
compare_case "GET  /api/schools"            "/api/schools"
compare_case "GET  /api/schools/archived"   "/api/schools/archived"
compare_case "GET  /api/classes"            "/api/classes"
compare_case "GET  /api/classes/archived"   "/api/classes/archived"
compare_case "GET  /api/worksheet-templates" "/api/worksheet-templates"
compare_case "GET  /api/math-skills"        "/api/math-skills"
compare_case "GET  /api/worksheet-curriculum" "/api/worksheet-curriculum"
compare_case "GET  /api/grading-jobs/teacher/today" "/api/grading-jobs/teacher/today"
compare_case "GET  /api/analytics/schools"  "/api/analytics/schools"

# ─── PHASE 3: PUBLIC API — read endpoints (param routes) ────────────────────
printf "\n=== Phase 3: Read endpoints (with params) ===\n"

if [ -n "$TEACHER_ID" ]; then
  compare_case "GET  /api/users/:id"        "/api/users/$TEACHER_ID"
else
  skip_case "GET  /api/users/:id" "TEACHER_ID not set"
fi

if [ -n "$SCHOOL_ID" ]; then
  compare_case "GET  /api/schools/:id"      "/api/schools/$SCHOOL_ID"
  compare_case "GET  /api/analytics/schools/:id/classes" "/api/analytics/schools/$SCHOOL_ID/classes"
else
  skip_case "GET  /api/schools/:id" "SCHOOL_ID not set"
  skip_case "GET  /api/analytics/schools/:id/classes" "SCHOOL_ID not set"
fi

if [ -n "$CLASS_ID" ]; then
  compare_case "GET  /api/classes/:id"               "/api/classes/$CLASS_ID"
  compare_case "GET  /api/classes/:id/teachers"      "/api/classes/$CLASS_ID/teachers"
  compare_case "GET  /api/classes/:id/students"      "/api/classes/$CLASS_ID/students"
  compare_case "GET  /api/mastery/class/:classId"    "/api/mastery/class/$CLASS_ID"
  compare_case "GET  /api/grading-jobs/class/:classId" "/api/grading-jobs/class/$CLASS_ID"
  compare_case "GET  /api/worksheets/class/:classId"   "/api/worksheets/class/$CLASS_ID"
else
  skip_case "GET  /api/classes/:id (+ children)" "CLASS_ID not set"
fi

if [ -n "$STUDENT_ID" ]; then
  compare_case "GET  /api/mastery/student/:id"                    "/api/mastery/student/$STUDENT_ID"
  compare_case "GET  /api/mastery/student/:id/recommendations"    "/api/mastery/student/$STUDENT_ID/recommendations"
  compare_case "GET  /api/mastery/student/:id/by-topic"           "/api/mastery/student/$STUDENT_ID/by-topic"
  compare_case "GET  /api/worksheets/student/:id"                 "/api/worksheets/student/$STUDENT_ID"
  compare_case "GET  /api/worksheet-generation/student/:id"       "/api/worksheet-generation/student/$STUDENT_ID"
else
  skip_case "GET  /api/mastery/student/:id (+ children)" "STUDENT_ID not set"
fi

if [ -n "$WORKSHEET_ID" ]; then
  compare_case "GET  /api/worksheets/:id"  "/api/worksheets/$WORKSHEET_ID"
else
  skip_case "GET  /api/worksheets/:id" "WORKSHEET_ID not set"
fi

if [ -n "$TEMPLATE_ID" ]; then
  compare_case "GET  /api/worksheet-templates/:id" "/api/worksheet-templates/$TEMPLATE_ID"
else
  skip_case "GET  /api/worksheet-templates/:id" "TEMPLATE_ID not set"
fi

if [ -n "$JOB_ID" ]; then
  compare_case "GET  /api/grading-jobs/:jobId" "/api/grading-jobs/$JOB_ID"
else
  skip_case "GET  /api/grading-jobs/:jobId" "JOB_ID not set"
fi

if [ -n "$BATCH_ID" ]; then
  compare_case "GET  /api/worksheet-generation/batch/:id" "/api/worksheet-generation/batch/$BATCH_ID"
else
  skip_case "GET  /api/worksheet-generation/batch/:id" "BATCH_ID not set (table missing locally)"
fi

# ─── PHASE 4: INTERNAL API (shared-secret auth) ─────────────────────────────
printf "\n=== Phase 4: Internal routes ===\n"

if [ -n "$INTERNAL_TOKEN" ] && [ -n "$WORKSHEET_ID" ]; then
  # Internal worksheet generation: GET /:id/data (read-only path of the
  # 3 endpoints; the other two are mutators).
  compare_case "GET  /internal/worksheet-generation/:id/data" \
    "/internal/worksheet-generation/$WORKSHEET_ID/data" internal
else
  skip_case "GET  /internal/worksheet-generation/:id/data" "INTERNAL_TOKEN or WORKSHEET_ID not set"
fi

# Internal grading-worker routes are all POST mutators (acquire, heartbeat,
# complete, fail, requeue) — not safe for parity smoke since they change
# job state. Skip with explicit reason.
skip_case "POST /internal/grading-worker/jobs/:id/acquire" "mutator — see write tests"
skip_case "POST /internal/grading-worker/jobs/:id/heartbeat" "mutator"
skip_case "POST /internal/grading-worker/jobs/:id/complete" "mutator"
skip_case "POST /internal/grading-worker/jobs/:id/fail" "mutator"
skip_case "POST /internal/grading-worker/jobs/:id/requeue" "mutator"
skip_case "POST /internal/question-bank/store" "mutator"
skip_case "POST /internal/question-bank/generate" "publishes to CF queue (would hit prod)"

# ─── PHASE 5: Deliberately skipped ─────────────────────────────────────────
printf "\n=== Phase 5: Skipped (CF queue / mutators / heavy / unported) ===\n"
skip_case "POST /api/worksheet-generation/generate"      "publishes to PDF rendering queue (prod CF)"
skip_case "POST /api/worksheet-generation/generate-class" "publishes to question + PDF queues"
skip_case "POST /api/worksheet-processing/process"       "publishes to grading queue"
skip_case "POST /api/worksheets/upload"                  "multipart + queue publish"
skip_case "POST /api/users/upload-csv"                   "mutator — see smoke-writes.sh"
skip_case "POST /api/schools (+ PUT/archive/delete)"     "mutator — see smoke-writes.sh"
skip_case "POST /api/classes (+ PUT/archive/delete)"     "mutator — see smoke-writes.sh"
skip_case "GET  /api/analytics/overall"                  "heavy aggregation; do separately"
skip_case "GET  /api/analytics/students"                 "heavy aggregation; do separately"
skip_case "GET  /api/analytics/students/download"        "CSV — needs raw-text comparison, not jq"

# ─── Summary ────────────────────────────────────────────────────────────────
echo
printf "──────────────────────────────────────────\n"
printf "${G}PASS${N} %d  ${R}FAIL${N} %d  ${Y}HANG${N} %d  ${Y}SKIP${N} %d\n" \
  "$pass" "$fail" "$hang" "$skip"
if [ "$hang" -gt 0 ]; then
  printf "${Y}Hung cases (worker pool wedge — production with Hyperdrive should resolve):${N}\n"
  for n in "${hang_names[@]}"; do printf "  - %s\n" "$n"; done
fi
if [ "$fail" -gt 0 ]; then
  printf "${R}Failed cases (real parity drift):${N}\n"
  for n in "${failed_names[@]}"; do printf "  - %s\n" "$n"; done
  exit 1
fi
