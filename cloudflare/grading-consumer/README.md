# Cloudflare Grading Consumer

Cloudflare Worker queue consumer that:
1. Pulls a grading job payload from the backend via internal endpoints.
2. Downloads worksheet images from R2.
3. Calls Gemini for OCR + grading.
4. Persists the result back to the backend (Postgres) via internal endpoints.

## Required bindings
- R2: `IMAGES_BUCKET` (worksheet images)
- R2: `ASSETS_BUCKET` (answer keys + custom OCR prompts)
- Queue consumer: `grading-fast`

## Required vars/secrets
- `BACKEND_BASE_URL` (e.g. `https://<your-backend>`)
- `BACKEND_WORKER_TOKEN` (must match backend `GRADING_WORKER_TOKEN`)
- `GEMINI_API_KEY`

Optional:
- `GEMINI_OCR_MODEL` (default `gemini-2.0-flash`)
- `GEMINI_AI_GRADING_MODEL` (default `gemini-3-flash-preview`)
- `GEMINI_BOOK_GRADING_MODEL` (default `gemini-2.0-flash`)
- `HEARTBEAT_INTERVAL_MS` (default `60000`)

## Assets bucket layout
- `answers_by_worksheet.json`
- `prompts/<worksheetNumber>.txt`

Generate assets from the legacy Python repo:
```bash
node scripts/generate-assets.mjs \
  --book-json /path/to/book_worksheets.json \
  --prompts-dir /path/to/context/prompts \
  --out-dir ./assets-out
```

Upload them to R2 (example):
```bash
# answers
wrangler r2 object put worksheet-grading-assets/answers_by_worksheet.json --file ./assets-out/answers_by_worksheet.json

# prompts
for f in ./assets-out/prompts/*.txt; do
  wrangler r2 object put "worksheet-grading-assets/prompts/$(basename "$f")" --file "$f"
done
```

