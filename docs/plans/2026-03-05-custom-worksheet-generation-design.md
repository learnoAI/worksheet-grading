# Custom Worksheet Generation — Design Document

**Date:** 2026-03-05
**Status:** Approved

## Overview

Generate personalized daily math worksheets per student. Each worksheet has 2 printed pages (40 questions), split into 4 sections of 10. Skills are selected using a 50/50 new-curriculum/spaced-repetition-review split. Questions are LLM-generated via a Cloudflare Worker, stored in a QuestionBank for reuse, and rendered to printable PDF via Puppeteer.

## Worksheet Structure

Each worksheet = 2 pages, 4 sections:

```
Page 1:
  Header: Name ___ Token Number ___ Marks ___
  Section A (Q1-Q10):  NEW skill — 10 questions + instruction
  ─── divider ───
  Section B (Q11-Q20): REVIEW skill #1 — 10 questions + instruction

Page 2:
  Header: Name ___ Token Number ___ Marks ___
  Section C (Q21-Q30): Same NEW skill — 10 more questions + instruction
  ─── divider ───
  Section D (Q31-Q40): REVIEW skill #2 — 10 questions + instruction
```

- Sections A + C = same new skill (20 questions total on it)
- Sections B + D = two different review skills (10 each)
- Each section has its own instruction line (e.g., "Divide the following. / भाग करो.")
- Layout: questions in a grid (4 columns x 3 rows for 10 Qs, matching existing worksheet style)
- Saarthi Education logo at bottom right of each page

## System Components

### 1. Skill Scheduler (backend service: `worksheetSchedulerService.ts`)

Determines which skills appear on each day's worksheet for a given student.

**New skill selection:**
- Follow curriculum order from WorksheetSkillMap (ordered by worksheetNumber)
- Find the student's most recently practiced skill (from SkillPracticeLog)
- Next new skill = next worksheetNumber in sequence after that
- For multi-day: advance one skill per day (N, N+1, N+2, ...)

**Review skill selection:**
- Use FSRS retrievability from StudentSkillMastery
- Rank practiced skills by priority: `(1 - retrievability) * levelWeight`
- Pick top 2 per day
- For multi-day: simulate forward — after selecting review skills for day K, treat them as "refreshed" so they don't repeat on day K+1 (temporarily boost their retrievability in the simulation)

**Output:** For each day: `{ newSkillId, reviewSkill1Id, reviewSkill2Id }`

### 2. Question Generator (Cloudflare Worker: `question-generator/`)

A new CF worker (separate from grading-consumer) that generates math questions via LLM.

**Trigger:** Backend POSTs a generation request to a CF queue or direct HTTP endpoint.

**Input:**
```json
{
  "mathSkillId": "...",
  "skillName": "Add 110-190 and 10-90",
  "topicName": "3 Digit Addition mix",
  "count": 30
}
```

**LLM call:** Uses Cloudflare AI Gateway / Workers AI or external provider (Gemini/Claude) via CF Agent SDK. Prompt asks for `count` unique questions with answers and an instruction string, returned as JSON array.

**Output stored in QuestionBank:**
```json
[
  { "question": "145 + 37 =", "answer": "182", "instruction": "Add the following.\nजोड़ करो।" },
  ...
]
```

**Batch size:** Generate 30 questions per skill per request to build up the bank quickly.

### 3. QuestionBank (Prisma model)

```prisma
model QuestionBank {
  id          String    @id @default(uuid())
  mathSkillId String
  mathSkill   MathSkill @relation(fields: [mathSkillId], references: [id])
  question    String    // "3 ) 24" or "145 + 37 ="
  answer      String    // "8" or "182"
  instruction String    // "Divide the following.\nभाग करो।"
  usedCount   Int       @default(0)
  createdAt   DateTime  @default(now())

  @@index([mathSkillId, usedCount])
}
```

When drawing questions for a worksheet:
1. Query QuestionBank for the skill, ordered by usedCount ASC (prefer least-used)
2. If fewer than 10 available: trigger generation, wait for results, then draw
3. After drawing: increment usedCount on those 10 questions

### 4. PDF Renderer (backend service: `worksheetPdfService.ts`)

**Technology:** Puppeteer (headless Chromium) rendering HTML to PDF.

**HTML template:**
- A4 page, print-ready margins
- Gray double-border (matching existing worksheet style)
- Header: Name/Token/Marks blanks
- Per-section: instruction text, questions in 4-column grid
- Saarthi Education logo bottom-right
- Page break between page 1 and page 2

**Output:** PDF buffer → uploaded to S3/R2 → URL stored in DB.

### 5. GeneratedWorksheet (Prisma model)

```prisma
model GeneratedWorksheet {
  id           String   @id @default(uuid())
  studentId    String
  student      User     @relation(fields: [studentId], references: [id])
  scheduledDate DateTime // The day this worksheet is for
  pdfUrl       String?  // S3/R2 URL once rendered
  status       GeneratedWorksheetStatus @default(PENDING)
  // Skill assignments
  newSkillId     String
  newSkill       MathSkill @relation("GeneratedNewSkill", fields: [newSkillId], references: [id])
  reviewSkill1Id String
  reviewSkill1   MathSkill @relation("GeneratedReview1", fields: [reviewSkill1Id], references: [id])
  reviewSkill2Id String
  reviewSkill2   MathSkill @relation("GeneratedReview2", fields: [reviewSkill2Id], references: [id])
  // Question snapshot (JSON array of {question, answer, instruction} per section)
  sectionsJson   Json
  createdAt      DateTime @default(now())
  updatedAt      DateTime @updatedAt

  @@index([studentId, scheduledDate])
}

enum GeneratedWorksheetStatus {
  PENDING         // Skills selected, questions being generated
  QUESTIONS_READY // All questions available
  RENDERING       // PDF being generated
  COMPLETED       // PDF ready for download
  FAILED
}
```

### 6. API Endpoints

| Endpoint | Method | Auth | Purpose |
|----------|--------|------|---------|
| `POST /api/mastery/generate-worksheets` | POST | SUPERADMIN, TEACHER, ADMIN | Start generation |
| `GET /api/mastery/generated-worksheets/:studentId` | GET | SUPERADMIN, TEACHER, ADMIN | List generated worksheets |
| `GET /api/mastery/generated-worksheet/:id/pdf` | GET | SUPERADMIN, TEACHER, ADMIN | Download PDF |

**Generation request:**
```json
{
  "studentId": "uuid",
  "days": 5,
  "startDate": "2026-03-06"
}
```

**Generation response:**
```json
{
  "success": true,
  "data": {
    "worksheetIds": ["id1", "id2", ...],
    "status": "PENDING"
  }
}
```

Generation is async. The endpoint creates GeneratedWorksheet rows in PENDING state, then kicks off question generation + PDF rendering in the background. Frontend polls the list endpoint to check status.

## Generation Pipeline Flow

```
1. POST /generate-worksheets { studentId, days: 5 }
2. Scheduler computes 5 days of skill assignments
3. For each day: create GeneratedWorksheet row (PENDING)
4. For each unique skill across all days:
   a. Check QuestionBank for available questions
   b. If insufficient: dispatch generation request to CF worker
5. CF worker generates questions via LLM, POSTs back to backend
6. Backend stores in QuestionBank
7. Once all questions ready: mark QUESTIONS_READY
8. For each worksheet: draw questions, build HTML, Puppeteer → PDF
9. Upload PDF to S3/R2, update row with URL, mark COMPLETED
```

## Multi-Day Review Simulation

When generating a week at once, the scheduler must avoid picking the same review skills every day. Algorithm:

```
reviewState = copy of student's current mastery state
for each day 1..N:
  newSkill = next in curriculum sequence
  reviews = top 2 from reviewState by (1-R) * levelWeight, excluding newSkill
  assign(day, newSkill, reviews[0], reviews[1])
  // Simulate: refresh the picked review skills
  reviewState[reviews[0]].lastPracticeAt = scheduledDate
  reviewState[reviews[1]].lastPracticeAt = scheduledDate
  // Also simulate the new skill being practiced
  reviewState[newSkill].lastPracticeAt = scheduledDate
```

This ensures variety across the batch.

## Non-Goals (Phase 1)

- Auto-grading of generated worksheets (existing pipeline handles this)
- Student-facing UI (admin/teacher generates and prints)
- Adaptive mid-batch re-planning (all days generated upfront)
- Custom question editing before printing
