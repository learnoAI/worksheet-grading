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
- `GEMINI_AI_GRADING_MODEL` (default `gemini-2.0-flash`)
- `GEMINI_BOOK_GRADING_MODEL` (default `gemini-2.0-flash`)
- `HEARTBEAT_INTERVAL_MS` (default `60000`)
- `FAST_MAX_PAGES` (default `4`)

## Assets bucket layout
- `answers_by_worksheet.json`
- `prompts/<worksheetNumber>.txt`

Generate assets:
```bash
node scripts/generate-assets.mjs \
  --book-json /path/to/book_worksheets.json \
  --out-dir ./assets-out
```
Notes:
- By default, prompts are loaded from `../../prompts` (repo-root `prompts/` folder).
- Use `--prompts-dir /path/to/prompts` to override.

Upload them to R2 (example):
```bash
# answers
wrangler r2 object put worksheet-grading-assets/answers_by_worksheet.json --file ./assets-out/answers_by_worksheet.json

# prompts
bash ./scripts/upload-prompts-to-r2.sh ../../prompts
# or:
npm run upload:prompts:r2
```

`upload-prompts-to-r2.sh` only uploads files named `<worksheetNumber>.txt`, so each prompt maps directly to that worksheet number in R2 as `prompts/<worksheetNumber>.txt`.
