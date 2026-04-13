# Queued Worksheet Generation for Classes — Design

## Goal

Generate personalized worksheets for an entire class (up to 10k worksheets) using two CF Queues for parallel processing. Questions are deduplicated per-skill, generated via Gemini, then assembled into per-student worksheets and rendered to PDF via Cloudflare Browser Rendering.

## Architecture

```
Teacher clicks "Generate for Class"
        |
        v
   Backend API
   - Creates WorksheetBatch (classId, days, status)
   - Plans skills per student (scheduler service)
   - Creates GeneratedWorksheet rows (PENDING)
   - Deduplicates skills -> finds which need questions
   - Enqueues QuestionGeneration jobs to CF Queue 1
        |
        v
   question-generation queue
        |
        v
   Question Generator Worker (existing, add queue consumer)
   - Calls Gemini API
   - POSTs questions back to backend /internal/question-bank/store
   - Backend stores in QuestionBank
        |
        v
   Backend checks: are all skills for a worksheet ready?
   - Yes -> build sectionsJson, enqueue PDF job to CF Queue 2
   - No -> wait for remaining skill callbacks
        |
        v
   pdf-rendering queue
        |
        v
   PDF Renderer Worker (new)
   - Fetches sectionsJson from backend
   - Builds HTML from template
   - Cloudflare Browser Rendering -> PDF buffer
   - Uploads to R2
   - POSTs completion back to backend
        |
        v
   Backend marks GeneratedWorksheet COMPLETED
   Updates WorksheetBatch progress
```

## Data Model

### New: WorksheetBatch

- id, classId, days, startDate
- status: PENDING | GENERATING_QUESTIONS | RENDERING_PDFS | COMPLETED | FAILED
- totalWorksheets, completedWorksheets, failedWorksheets
- createdAt, updatedAt

### Modified: GeneratedWorksheet

- Add batchId (optional FK to WorksheetBatch)
- Existing status flow: PENDING -> QUESTIONS_READY -> RENDERING -> COMPLETED / FAILED

## Question Deduplication

For a class of 30 students x 5 days, there might be ~50 unique skills total (not 450). The backend:

1. Collects all skill IDs across all planned worksheets
2. Checks QuestionBank — skips skills with 30+ questions already
3. Enqueues only the skills that need generation
4. Each skill is enqueued once, not per-student

## Worksheet Assembly Trigger

When the question-generator worker calls back with stored questions, the backend checks: "Are all 3 skills for this worksheet now satisfied in QuestionBank (30+ questions each)?" If yes -> build sectionsJson -> enqueue PDF job. This is event-driven, not polling.

## Two Queues

| Aspect | Question Generation | PDF Rendering |
|---|---|---|
| Queue name | question-generation | pdf-rendering |
| Worker | question-generator (existing) | pdf-renderer (new) |
| Bottleneck | Gemini API rate limits | Browser Rendering CPU |
| max_concurrency | ~50 | ~100 |
| max_retries | 5 | 3 |
| Callback | POST /internal/question-bank/store | POST /internal/worksheet-generation/complete |

## Question Generator Worker Changes

Currently the worker is HTTP-only (request/response). Add a queue consumer handler alongside the existing fetch handler. The queue message contains `{ mathSkillId, skillName, topicName, count, batchId }`. After generating questions, the worker POSTs them back to the backend's `/internal/question-bank/store` endpoint (callback pattern, since the backend has a public URL in production).

Keep the existing synchronous fetch handler for single-student generation.

## PDF Renderer Worker

New CF Worker with:
- Queue consumer binding for `pdf-rendering` queue
- Cloudflare Browser Rendering binding (`browser`)
- R2 bucket binding for uploads

Flow per message:
1. Receives `{ worksheetId }`
2. Fetches worksheet data (sectionsJson, studentId) from backend via internal GET endpoint
3. Builds HTML using the existing template layout (same as current worksheetPdfService.ts)
4. Renders via `puppeteer.launch(env.BROWSER)` (CF Browser Rendering)
5. Uploads PDF buffer to R2 bucket
6. POSTs completion to backend: `POST /internal/worksheet-generation/:id/complete` with `{ pdfUrl }`

## API Endpoints

### New

- `POST /api/worksheet-generation/generate-class` — Body: `{ classId, days, startDate }`. Creates batch, plans all students, enqueues. Returns `{ batchId, totalWorksheets }`.
- `GET /api/worksheet-generation/batch/:batchId` — Returns batch status + progress counts.
- `GET /internal/worksheet-generation/:id/data` — Internal endpoint for PDF worker to fetch worksheet sectionsJson.
- `POST /internal/worksheet-generation/:id/complete` — Internal endpoint for PDF worker to mark worksheet done with pdfUrl.

### Modified

- Existing `POST /generate` (single student) keeps working synchronously for small requests.
- `POST /internal/question-bank/store` — After storing questions, checks pending worksheets and enqueues PDF jobs for any that are now ready.

## Frontend Changes

- Add class-level generation: select school -> class -> days -> start date -> generate
- Show batch progress bar (poll batch status endpoint)
- List all worksheets in batch with download links
- Existing single-student generation stays as-is

## Queue Infrastructure

Both queues are created in the same Cloudflare account. The backend publishes to both via the CF Queue REST API (same pattern as existing grading queue). Each queue has its own consumer worker.

## Error Handling

- Question generation failure: retried by queue (max 5 attempts). If all fail, skill is skipped and worksheets using that skill get fewer questions (graceful degradation).
- PDF rendering failure: retried by queue (max 3 attempts). If all fail, worksheet stays in RENDERING status and batch tracks it as failed.
- Batch completion: batch moves to COMPLETED when all worksheets are either COMPLETED or FAILED. If any failed, UI shows which ones.
