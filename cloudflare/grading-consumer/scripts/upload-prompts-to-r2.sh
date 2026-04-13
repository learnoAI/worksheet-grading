#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WORKER_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
REPO_ROOT="$(cd "${WORKER_DIR}/../.." && pwd)"

PROMPTS_DIR="${1:-${REPO_ROOT}/prompts}"
BUCKET_NAME="${R2_ASSETS_BUCKET:-worksheet-grading-assets}"
PROMPT_PREFIX="${R2_PROMPTS_PREFIX:-prompts}"
WRANGLER_BIN="${WRANGLER_BIN:-wrangler}"

if ! command -v "${WRANGLER_BIN}" >/dev/null 2>&1; then
  if [[ -x "${WORKER_DIR}/node_modules/.bin/wrangler" ]]; then
    WRANGLER_BIN="${WORKER_DIR}/node_modules/.bin/wrangler"
  else
    echo "wrangler not found. Install it or set WRANGLER_BIN."
    exit 1
  fi
fi

if [[ ! -d "${PROMPTS_DIR}" ]]; then
  echo "Prompts directory not found: ${PROMPTS_DIR}"
  echo "Usage: $0 [path/to/prompts]"
  exit 1
fi

shopt -s nullglob
files=("${PROMPTS_DIR}"/*.txt)
shopt -u nullglob

if [[ ${#files[@]} -eq 0 ]]; then
  echo "No .txt prompt files found in ${PROMPTS_DIR}"
  exit 1
fi

uploaded=0
skipped=0

cd "${WORKER_DIR}"

for file in "${files[@]}"; do
  filename="$(basename "${file}")"
  worksheet="${filename%.txt}"

  if [[ ! "${worksheet}" =~ ^[0-9]+$ ]]; then
    echo "Skipping non-worksheet file: ${filename}"
    skipped=$((skipped + 1))
    continue
  fi

  key="${BUCKET_NAME}/${PROMPT_PREFIX}/${worksheet}.txt"
  echo "Uploading ${filename} -> ${PROMPT_PREFIX}/${worksheet}.txt"
  "${WRANGLER_BIN}" r2 object put "${key}" --file "${file}" >/dev/null
  uploaded=$((uploaded + 1))
done

echo "Uploaded ${uploaded} prompt file(s) to R2 bucket '${BUCKET_NAME}'. Skipped ${skipped}."
