#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# smoke-parity.sh — diff responses between the Express backend (baseline) and
# the Hono worker (new). Used to confirm byte-level (or jq-normalised) parity
# before flipping traffic.
#
# Usage:
#   bash smoke-parity.sh                    # uses defaults below
#   EMAIL=... PASSWORD=... bash smoke-parity.sh
#   CLASS_ID=... STUDENT_ID=... BATCH_ID=... bash smoke-parity.sh
#
# Env vars (all optional, sensible defaults):
#   EXPRESS_URL   — baseline server          (default http://localhost:5100)
#   WORKER_URL    — hono worker              (default http://localhost:8787)
#   EMAIL         — teacher login email
#   PASSWORD      — teacher login password
#   SMOKE_TOKEN   — pre-minted JWT (skips the login step if set)
#   CLASS_ID      — optional class to exercise /api/mastery/class/:id
#   STUDENT_ID    — optional student to exercise /api/worksheet-generation/student/:id
#   BATCH_ID      — optional batch to exercise /api/worksheet-generation/batch/:id
#
# Exits 0 if all non-skipped cases match, 1 otherwise.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

EXPRESS_URL=${EXPRESS_URL:-http://localhost:5100}
WORKER_URL=${WORKER_URL:-http://localhost:8787}
EMAIL=${EMAIL:-}
PASSWORD=${PASSWORD:-}
SMOKE_TOKEN=${SMOKE_TOKEN:-}
CLASS_ID=${CLASS_ID:-}
STUDENT_ID=${STUDENT_ID:-}
BATCH_ID=${BATCH_ID:-}

command -v jq   >/dev/null || { echo "jq is required"; exit 2; }
command -v curl >/dev/null || { echo "curl is required"; exit 2; }

# Colours (disabled when not a TTY)
if [ -t 1 ]; then R='\033[31m'; G='\033[32m'; Y='\033[33m'; N='\033[0m'
else R=''; G=''; Y=''; N=''; fi

pass=0; fail=0; skip=0
failed_names=()

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

# compare-case NAME PATH [AUTH]
# AUTH=1 sends the bearer token; omit/0 for unauthenticated calls.
compare_case() {
  local name=$1 path=$2 auth=${3:-1}
  local hdr=()
  [ "$auth" = "1" ] && hdr=(-H "Authorization: Bearer $TOK")

  local a b
  a=$(curl -s --max-time 15 "${hdr[@]}" "$EXPRESS_URL$path" 2>/dev/null || echo '{"_curl_err":true}')
  b=$(curl -s --max-time 15 "${hdr[@]}" "$WORKER_URL$path"   2>/dev/null || echo '{"_curl_err":true}')
  # Small pause so the local workerd + pg adapter can tear down its
  # connection between requests (wrangler-dev quirk; not an issue in prod
  # where Hyperdrive pools externally).
  sleep 0.5

  local a_norm b_norm
  # jq -S sorts keys; fall back to raw text if the body isn't JSON
  a_norm=$(echo "$a" | jq -S . 2>/dev/null || echo "$a")
  b_norm=$(echo "$b" | jq -S . 2>/dev/null || echo "$b")

  if [ "$a_norm" = "$b_norm" ]; then
    pass=$((pass + 1))
    printf "${G}PASS${N}  %s\n" "$name"
  else
    fail=$((fail + 1))
    failed_names+=("$name")
    printf "${R}FAIL${N}  %s  (path=%s)\n" "$name" "$path"
    # Truncated diff — use the script output as a starting point, not a final report
    # `diff` exits 1 on difference; swallow so `set -e` doesn't abort.
    diff <(echo "$a_norm") <(echo "$b_norm") | head -30 | sed 's/^/        /' || true
  fi
}

skip_case() {
  skip=$((skip + 1))
  printf "${Y}SKIP${N}  %s  (%s)\n" "$1" "$2"
}

# ── 0. Health check: both servers reachable ────────────────────────────────
curl -sf "$EXPRESS_URL/health" >/dev/null \
  || { echo "Express not reachable at $EXPRESS_URL"; exit 2; }
curl -sf "$WORKER_URL/health" >/dev/null \
  || { echo "Worker not reachable at $WORKER_URL"; exit 2; }

# ── 1. Auth ─────────────────────────────────────────────────────────────────
TOK=$(login)
[ -z "$TOK" ] && { echo "login returned no token"; exit 2; }

# ── 2. Parity matrix ────────────────────────────────────────────────────────
# /health intentionally differs in shape (Hono is simpler). Skip from strict diff.
skip_case "/health"                 "intentional shape difference"
compare_case "/api/auth/me"         "/api/auth/me"
compare_case "/api/notifications"   "/api/notifications"
compare_case "/api/schools"         "/api/schools"
compare_case "/api/classes"         "/api/classes"
compare_case "/api/worksheet-templates" "/api/worksheet-templates"
compare_case "/api/grading-jobs/teacher/today" "/api/grading-jobs/teacher/today"

if [ -n "$CLASS_ID" ]; then
  compare_case "/api/mastery/class/:classId" "/api/mastery/class/$CLASS_ID"
else
  skip_case "/api/mastery/class/:classId"  "CLASS_ID not set"
fi

if [ -n "$STUDENT_ID" ]; then
  compare_case "/api/worksheet-generation/student/:studentId" \
    "/api/worksheet-generation/student/$STUDENT_ID"
else
  skip_case "/api/worksheet-generation/student/:studentId" "STUDENT_ID not set"
fi

if [ -n "$BATCH_ID" ]; then
  compare_case "/api/worksheet-generation/batch/:batchId" \
    "/api/worksheet-generation/batch/$BATCH_ID"
else
  skip_case "/api/worksheet-generation/batch/:batchId" "BATCH_ID not set"
fi

# ── 3. Summary ──────────────────────────────────────────────────────────────
echo
printf "──────────────────────────────────────────\n"
printf "${G}PASS${N} %d  ${R}FAIL${N} %d  ${Y}SKIP${N} %d\n" "$pass" "$fail" "$skip"
if [ "$fail" -gt 0 ]; then
  printf "${R}Failed cases:${N}\n"
  for n in "${failed_names[@]}"; do printf "  - %s\n" "$n"; done
  exit 1
fi
