# Curriculum Mapping System

## Purpose
This system maps each worksheet number to:
- a **main topic**
- a **learning outcome**
- whether it is a **test worksheet**

The mapping is then used to measure student performance by topic and learning outcome.

## Data Model
Defined in:
- `/Users/madhavkaushish/saarthi/worksheet-grading/backend/prisma/schema.prisma`

### Tables
1. `MainTopic`
- `id` (PK)
- `name` (unique)
- timestamps

2. `MathSkill` (reused as learning outcomes)
- `id` (PK)
- `name` (learning outcome text)
- `description` (optional)
- `mainTopicId` (FK to `MainTopic`, nullable for legacy rows)
- timestamps
- unique constraint: `(name, mainTopicId)`

3. `WorksheetSkillMap`
- `id` (PK)
- `worksheetNumber` (unique)
- `mathSkillId` (FK to `MathSkill`)
- `isTest` (boolean)
- timestamps

### Migration
Created in:
- `/Users/madhavkaushish/saarthi/worksheet-grading/backend/prisma/migrations/20260305124500_add_curriculum_mapping/migration.sql`

## Import Pipeline
Script:
- `/Users/madhavkaushish/saarthi/worksheet-grading/backend/src/scripts/import-learning-outcomes.ts`

NPM command:
- `npm run import-learning-outcomes -- ../learning-outcomes.xlsx`

`package.json` runs Prisma generate before import:
- `"import-learning-outcomes": "npm run prisma:generate && ts-node src/scripts/import-learning-outcomes.ts"`

### Expected Excel Columns
- `Worksheet no.`
- `Main Topic`
- `Learning outcome`
- `is_test` (optional; accepts `1/0`, `true/false`, `yes/no`)

### Important Parsing Rules
1. `worksheetNumber` must be a positive integer.
2. `mainTopic` is required.
3. `learningOutcome` fallback:
- if `Learning outcome` is blank and `Main Topic` exists, script uses `Main Topic` as `learningOutcome`.
4. duplicate worksheet numbers in the sheet are rejected with an error.

## Idempotency and Re-runs
The importer is designed to be safe to re-run.

### Behavior by table
1. `MainTopic`
- Reuses existing topic by exact name.
- Creates only if not found.

2. `MathSkill`
- Reuses existing skill by `(mainTopicId, name)`.
- If a legacy skill exists with same name but no `mainTopicId`, it scopes that row by setting `mainTopicId`.
- Creates only if no match is reusable.

3. `WorksheetSkillMap`
- Looks up by unique `worksheetNumber`.
- Creates if missing.
- Updates if `mathSkillId` or `isTest` changed.
- Leaves unchanged rows untouched.

### What it does not do
- It does not delete DB rows that are no longer present in the Excel file.

## Logging
All logs are prefixed with:
- `[import-learning-outcomes]`

### Logs emitted
1. Header/column mapping detected.
2. Parse summary:
- total rows
- parsed rows
- skipped rows
- fallback count
- skip reason counts
3. Sample rows where fallback was applied.
4. Sample skipped rows.
5. Existing DB counts (topics/skills/mappings).
6. Import progress every 500 rows.
7. Import summary:
- topics created
- skills created
- legacy skills scoped
- mappings created/updated/unchanged

## API Surface
Routes file:
- `/Users/madhavkaushish/saarthi/worksheet-grading/backend/src/routes/worksheetTemplateRoutes.ts`

Controller file:
- `/Users/madhavkaushish/saarthi/worksheet-grading/backend/src/controllers/worksheetTemplateController.ts`

### 1) Get worksheet curriculum mapping
- `GET /api/worksheet-curriculum`
- Auth: `TEACHER`, `ADMIN`, `SUPERADMIN`
- Optional query: `worksheetNumbers=108,129,2243`

Response shape:
```json
[
  {
    "worksheetNumber": 108,
    "isTest": true,
    "learningOutcome": { "id": "...", "name": "Write 1-10" },
    "mainTopic": { "id": "...", "name": "Number tracing & writing" }
  }
]
```

### 2) Get math skills
- `GET /api/math-skills`
- Now includes `mainTopic` relation.

### 3) Create math skill
- `POST /api/math-skills`
- Supports optional `mainTopicId`.

## Performance Measurement Pattern
To compute performance by learning outcome/topic:
1. Start from `Worksheet` rows (student submissions with grade/outOf).
2. Join `WorksheetSkillMap` using `Worksheet.worksheetNumber = WorksheetSkillMap.worksheetNumber`.
3. Join `MathSkill` and `MainTopic`.
4. Aggregate by:
- learning outcome (`MathSkill.id`)
- topic (`MainTopic.id`)
- optional test split (`WorksheetSkillMap.isTest`)

## Operational Runbook
Run from backend directory:

1. Apply schema migration:
- `npm run prisma:deploy`

2. Import mapping from Excel:
- `npm run import-learning-outcomes -- ../learning-outcomes.xlsx`

3. Verify mapping exists:
- call `GET /api/worksheet-curriculum?worksheetNumbers=108,129`

## Troubleshooting
1. Error: Prisma client missing new models/fields (e.g. `mainTopic` not found)
- Cause: stale generated Prisma client.
- Fix: `npm run prisma:generate` (already included in import script command).

2. Rows skipped unexpectedly
- Check parse summary and skipped sample logs.
- Common causes: invalid worksheet number or missing main topic.

3. Transition rows with blank learning outcome
- Current behavior: imported using `Main Topic` as fallback learning outcome.

4. Duplicate worksheet number in Excel
- Import stops with explicit row-level error; fix the source sheet and re-run.
