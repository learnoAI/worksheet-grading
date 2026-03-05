# Queued Worksheet Generation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable class-level worksheet generation (up to 10k worksheets) using two CF Queues — one for LLM question generation, one for PDF rendering via Cloudflare Browser Rendering.

**Architecture:** Backend creates a WorksheetBatch, plans skills for all students, deduplicates skills, enqueues question generation jobs to CF Queue 1. Question Generator Worker calls Gemini, POSTs questions back to backend. Backend assembles sections and enqueues PDF jobs to CF Queue 2. PDF Renderer Worker renders HTML→PDF via CF Browser Rendering, uploads to R2, calls back to mark complete.

**Tech Stack:** Prisma (DB), Cloudflare Queues (job dispatch), Cloudflare Workers (question gen + PDF render), Cloudflare Browser Rendering (HTML→PDF), Gemini API (LLM), R2 (storage), Express (API), Next.js (UI)

**Design doc:** `docs/plans/2026-03-05-queued-worksheet-generation-design.md`

---

## Task 1: Prisma Schema — WorksheetBatch + GeneratedWorksheet.batchId

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/[timestamp]_add_worksheet_batch/migration.sql`

**Step 1: Add WorksheetBatch model and modify GeneratedWorksheet**

In `backend/prisma/schema.prisma`:

Add new enum after `GeneratedWorksheetStatus`:
```prisma
enum WorksheetBatchStatus {
  PENDING
  GENERATING_QUESTIONS
  RENDERING_PDFS
  COMPLETED
  FAILED
}
```

Add new model after `GeneratedWorksheet`:
```prisma
model WorksheetBatch {
  id                  String               @id @default(uuid())
  classId             String
  class               Class                @relation(fields: [classId], references: [id])
  days                Int
  startDate           DateTime
  status              WorksheetBatchStatus @default(PENDING)
  totalWorksheets     Int                  @default(0)
  completedWorksheets Int                  @default(0)
  failedWorksheets    Int                  @default(0)
  pendingSkills       Int                  @default(0)
  completedSkills     Int                  @default(0)
  errors              Json?
  createdAt           DateTime             @default(now())
  updatedAt           DateTime             @updatedAt
  worksheets          GeneratedWorksheet[]

  @@index([classId])
  @@index([status])
}
```

Add relation field on `Class` model (after `gradingJobs` line):
```prisma
  worksheetBatches WorksheetBatch[]
```

Add `batchId` to `GeneratedWorksheet` model (after `sectionsJson` field):
```prisma
  batchId        String?
  batch          WorksheetBatch?          @relation(fields: [batchId], references: [id])
```

Add index on GeneratedWorksheet (after existing `@@index([status])`):
```prisma
  @@index([batchId, status])
```

**Step 2: Create migration SQL**

Create `backend/prisma/migrations/20260305150000_add_worksheet_batch/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "WorksheetBatchStatus" AS ENUM ('PENDING', 'GENERATING_QUESTIONS', 'RENDERING_PDFS', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "WorksheetBatch" (
    "id" TEXT NOT NULL,
    "classId" TEXT NOT NULL,
    "days" INTEGER NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "WorksheetBatchStatus" NOT NULL DEFAULT 'PENDING',
    "totalWorksheets" INTEGER NOT NULL DEFAULT 0,
    "completedWorksheets" INTEGER NOT NULL DEFAULT 0,
    "failedWorksheets" INTEGER NOT NULL DEFAULT 0,
    "pendingSkills" INTEGER NOT NULL DEFAULT 0,
    "completedSkills" INTEGER NOT NULL DEFAULT 0,
    "errors" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "WorksheetBatch_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "GeneratedWorksheet" ADD COLUMN "batchId" TEXT;

-- CreateIndex
CREATE INDEX "WorksheetBatch_classId_idx" ON "WorksheetBatch"("classId");

-- CreateIndex
CREATE INDEX "WorksheetBatch_status_idx" ON "WorksheetBatch"("status");

-- CreateIndex
CREATE INDEX "GeneratedWorksheet_batchId_status_idx" ON "GeneratedWorksheet"("batchId", "status");

-- AddForeignKey
ALTER TABLE "WorksheetBatch" ADD CONSTRAINT "WorksheetBatch_classId_fkey" FOREIGN KEY ("classId") REFERENCES "Class"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedWorksheet" ADD CONSTRAINT "GeneratedWorksheet_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "WorksheetBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

**Step 3: Run migration + generate**

```bash
cd backend && npx prisma migrate deploy && npx prisma generate
```

**Step 4: Verify TypeScript compiles**

```bash
cd backend && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add backend/prisma/
git commit -m "feat: add WorksheetBatch model and batchId on GeneratedWorksheet"
```

---

## Task 2: Question Generation Queue — Backend Publisher

**Files:**
- Create: `backend/src/services/queue/questionGenerationQueue.ts`
- Modify: `backend/src/config/env.ts` (add queue config)

**Step 1: Add queue config to env.ts**

In `backend/src/config/env.ts`, add a new section in the default export (after the `cloudflare` block):

```typescript
    worksheetGeneration: {
        questionQueueId: process.env.QUESTION_GENERATION_QUEUE_ID || '',
        pdfQueueId: process.env.PDF_RENDERING_QUEUE_ID || '',
    },
```

**Step 2: Create question generation queue module**

`backend/src/services/queue/questionGenerationQueue.ts`:

```typescript
import { CloudflareQueueClient } from './cloudflareQueueClient';
import config from '../../config/env';

export interface QuestionGenQueueMessage {
    v: 1;
    mathSkillId: string;
    skillName: string;
    topicName: string;
    count: number;
    batchId: string;
    enqueuedAt: string;
}

let cachedClient: CloudflareQueueClient | null = null;

function getQuestionGenQueueClient(): CloudflareQueueClient {
    if (cachedClient) return cachedClient;

    cachedClient = new CloudflareQueueClient({
        accountId: config.cloudflare.accountId,
        queueId: config.worksheetGeneration.questionQueueId,
        apiToken: config.cloudflare.apiToken,
        consumerName: 'question-generator',
        apiBaseUrl: config.cloudflare.apiBaseUrl
    });

    return cachedClient;
}

export function createQuestionGenMessage(
    mathSkillId: string,
    skillName: string,
    topicName: string,
    count: number,
    batchId: string
): QuestionGenQueueMessage {
    return {
        v: 1,
        mathSkillId,
        skillName,
        topicName,
        count,
        batchId,
        enqueuedAt: new Date().toISOString()
    };
}

export async function enqueueQuestionGeneration(message: QuestionGenQueueMessage): Promise<void> {
    const client = getQuestionGenQueueClient();
    await client.publish(message);
}
```

**Step 3: Verify compilation**

```bash
cd backend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add backend/src/services/queue/questionGenerationQueue.ts backend/src/config/env.ts
git commit -m "feat: add question generation queue publisher"
```

---

## Task 3: PDF Rendering Queue — Backend Publisher

**Files:**
- Create: `backend/src/services/queue/pdfRenderingQueue.ts`

**Step 1: Create PDF rendering queue module**

`backend/src/services/queue/pdfRenderingQueue.ts`:

```typescript
import { CloudflareQueueClient } from './cloudflareQueueClient';
import config from '../../config/env';

export interface PdfRenderQueueMessage {
    v: 1;
    worksheetId: string;
    batchId: string;
    enqueuedAt: string;
}

let cachedClient: CloudflareQueueClient | null = null;

function getPdfRenderQueueClient(): CloudflareQueueClient {
    if (cachedClient) return cachedClient;

    cachedClient = new CloudflareQueueClient({
        accountId: config.cloudflare.accountId,
        queueId: config.worksheetGeneration.pdfQueueId,
        apiToken: config.cloudflare.apiToken,
        consumerName: 'pdf-renderer',
        apiBaseUrl: config.cloudflare.apiBaseUrl
    });

    return cachedClient;
}

export function createPdfRenderMessage(
    worksheetId: string,
    batchId: string
): PdfRenderQueueMessage {
    return {
        v: 1,
        worksheetId,
        batchId,
        enqueuedAt: new Date().toISOString()
    };
}

export async function enqueuePdfRendering(message: PdfRenderQueueMessage): Promise<void> {
    const client = getPdfRenderQueueClient();
    await client.publish(message);
}
```

**Step 2: Verify + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/services/queue/pdfRenderingQueue.ts
git commit -m "feat: add PDF rendering queue publisher"
```

---

## Task 4: Class-Level Batch Orchestrator

**Files:**
- Create: `backend/src/services/worksheetBatchService.ts`

This service handles: create batch → plan all students → create worksheet rows → deduplicate skills → enqueue question generation.

**Step 1: Create the batch service**

`backend/src/services/worksheetBatchService.ts`:

```typescript
import { Prisma } from '@prisma/client';
import prisma from '../utils/prisma';
import { planWorksheets } from './worksheetSchedulerService';
import { buildSections } from './worksheetGenerationService';
import {
    enqueueQuestionGeneration,
    createQuestionGenMessage
} from './queue/questionGenerationQueue';
import {
    enqueuePdfRendering,
    createPdfRenderMessage
} from './queue/pdfRenderingQueue';

interface BatchResult {
    batchId: string;
    totalWorksheets: number;
    skillsToGenerate: number;
    errors: string[];
}

/**
 * Create a batch of worksheets for an entire class.
 * Deduplicates skills, enqueues question generation for missing ones.
 */
export async function createClassBatch(
    classId: string,
    days: number,
    startDate: Date
): Promise<BatchResult> {
    const errors: string[] = [];

    // 1. Get all students in the class
    const studentClasses = await prisma.studentClass.findMany({
        where: { classId },
        select: { studentId: true }
    });

    if (studentClasses.length === 0) {
        return { batchId: '', totalWorksheets: 0, skillsToGenerate: 0, errors: ['No students in class'] };
    }

    // 2. Create the batch
    const batch = await prisma.worksheetBatch.create({
        data: {
            classId,
            days,
            startDate,
            status: 'PENDING',
            totalWorksheets: 0
        }
    });

    // 3. Plan worksheets for all students and create GeneratedWorksheet rows
    const allSkillIds = new Set<string>();
    let totalWorksheets = 0;

    for (const { studentId } of studentClasses) {
        const { plans, errors: planErrors } = await planWorksheets(studentId, days, startDate);
        errors.push(...planErrors);

        for (const plan of plans) {
            await prisma.generatedWorksheet.create({
                data: {
                    studentId,
                    scheduledDate: plan.scheduledDate,
                    newSkillId: plan.newSkillId,
                    reviewSkill1Id: plan.reviewSkill1Id,
                    reviewSkill2Id: plan.reviewSkill2Id,
                    batchId: batch.id,
                    status: 'PENDING'
                }
            });
            totalWorksheets++;
            allSkillIds.add(plan.newSkillId);
            allSkillIds.add(plan.reviewSkill1Id);
            allSkillIds.add(plan.reviewSkill2Id);
        }
    }

    // 4. Deduplicate: find which skills need question generation
    const skillsNeedingGeneration: { id: string; name: string; topicName: string }[] = [];
    for (const skillId of allSkillIds) {
        const count = await prisma.questionBank.count({ where: { mathSkillId: skillId } });
        if (count >= 30) continue;

        const skill = await prisma.mathSkill.findUnique({
            where: { id: skillId },
            include: { mainTopic: true }
        });
        if (!skill) continue;

        skillsNeedingGeneration.push({
            id: skill.id,
            name: skill.name,
            topicName: skill.mainTopic?.name ?? 'Math'
        });
    }

    // 5. Update batch with counts
    await prisma.worksheetBatch.update({
        where: { id: batch.id },
        data: {
            totalWorksheets,
            pendingSkills: skillsNeedingGeneration.length,
            status: skillsNeedingGeneration.length > 0 ? 'GENERATING_QUESTIONS' : 'RENDERING_PDFS'
        }
    });

    // 6. If no skills need generation, go straight to assembling + PDF
    if (skillsNeedingGeneration.length === 0) {
        // All questions already exist — assemble and enqueue PDFs
        await assembleAndEnqueuePdfs(batch.id);
    } else {
        // 7. Enqueue question generation for each skill
        for (const skill of skillsNeedingGeneration) {
            try {
                const msg = createQuestionGenMessage(skill.id, skill.name, skill.topicName, 30, batch.id);
                await enqueueQuestionGeneration(msg);
            } catch (err) {
                errors.push(`Failed to enqueue generation for ${skill.name}: ${err}`);
            }
        }
    }

    return {
        batchId: batch.id,
        totalWorksheets,
        skillsToGenerate: skillsNeedingGeneration.length,
        errors
    };
}

/**
 * Called after question generation completes for a skill.
 * Checks if all skills for the batch are done, then assembles worksheets and enqueues PDFs.
 */
export async function onSkillQuestionsReady(batchId: string): Promise<void> {
    // Increment completed skills
    const batch = await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: { completedSkills: { increment: 1 } }
    });

    // Check if all skills done
    if (batch.completedSkills < batch.pendingSkills) return;

    // All skills generated — move to PDF rendering phase
    await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: { status: 'RENDERING_PDFS' }
    });

    await assembleAndEnqueuePdfs(batchId);
}

/**
 * Assemble sectionsJson for all PENDING worksheets in a batch, then enqueue PDF rendering.
 */
async function assembleAndEnqueuePdfs(batchId: string): Promise<void> {
    const worksheets = await prisma.generatedWorksheet.findMany({
        where: { batchId, status: 'PENDING' }
    });

    for (const ws of worksheets) {
        try {
            const sections = await buildSections(ws.newSkillId, ws.reviewSkill1Id, ws.reviewSkill2Id);
            await prisma.generatedWorksheet.update({
                where: { id: ws.id },
                data: {
                    sectionsJson: sections as unknown as Prisma.InputJsonValue,
                    status: 'QUESTIONS_READY'
                }
            });

            const msg = createPdfRenderMessage(ws.id, batchId);
            await enqueuePdfRendering(msg);
        } catch (err) {
            console.error(`[batch] Failed to assemble worksheet ${ws.id}:`, err);
            await prisma.generatedWorksheet.update({
                where: { id: ws.id },
                data: { status: 'FAILED' }
            });
            await prisma.worksheetBatch.update({
                where: { id: batchId },
                data: { failedWorksheets: { increment: 1 } }
            });
        }
    }
}

/**
 * Called when a PDF rendering completes for a worksheet.
 * Updates batch progress, marks batch complete when all done.
 */
export async function onWorksheetPdfComplete(batchId: string, failed: boolean): Promise<void> {
    const updateData = failed
        ? { failedWorksheets: { increment: 1 } }
        : { completedWorksheets: { increment: 1 } };

    const batch = await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: updateData
    });

    const totalDone = batch.completedWorksheets + batch.failedWorksheets;
    if (totalDone >= batch.totalWorksheets) {
        await prisma.worksheetBatch.update({
            where: { id: batchId },
            data: { status: batch.failedWorksheets > 0 ? 'COMPLETED' : 'COMPLETED' }
        });
    }
}
```

**Step 2: Export `buildSections` from worksheetGenerationService.ts**

In `backend/src/services/worksheetGenerationService.ts`, change the `buildSections` function from `async function buildSections(` to `export async function buildSections(`.

**Step 3: Verify + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/services/worksheetBatchService.ts backend/src/services/worksheetGenerationService.ts
git commit -m "feat: add class-level batch orchestrator service"
```

---

## Task 5: Question Generator Worker — Add Queue Consumer

**Files:**
- Modify: `cloudflare/question-generator/wrangler.toml`
- Modify: `cloudflare/question-generator/src/index.ts`

**Step 1: Update wrangler.toml with queue consumer binding**

Replace the entire `cloudflare/question-generator/wrangler.toml`:

```toml
name = "question-generator"
main = "src/index.ts"
compatibility_date = "2026-02-14"

# Secrets (set via `wrangler secret put`):
# - WORKSHEET_CREATION_WORKER_TOKEN
# - WORKSHEET_CREATION_BACKEND_BASE_URL
# - GEMINI_API_KEY

[[queues.consumers]]
queue = "question-generation"
max_batch_size = 5
max_batch_timeout = 5
max_concurrency = 50
max_retries = 5
dead_letter_queue = "question-generation-dlq"
```

**Step 2: Update the worker to handle both HTTP and Queue**

Replace `cloudflare/question-generator/src/index.ts` entirely:

```typescript
import { z } from 'zod';

interface Env {
    WORKSHEET_CREATION_WORKER_TOKEN: string;
    WORKSHEET_CREATION_BACKEND_BASE_URL: string;
    GEMINI_API_KEY: string;
    GEMINI_MODEL?: string;
}

const RequestSchema = z.object({
    mathSkillId: z.string(),
    skillName: z.string(),
    topicName: z.string(),
    count: z.number().int().min(1).max(50).default(30)
});

const QuestionSchema = z.object({
    question: z.string(),
    answer: z.string(),
    instruction: z.string()
});

interface QueueMessageV1 {
    v: 1;
    mathSkillId: string;
    skillName: string;
    topicName: string;
    count: number;
    batchId: string;
    enqueuedAt: string;
}

async function generateQuestions(
    env: Env,
    skillName: string,
    topicName: string,
    count: number
): Promise<z.infer<typeof QuestionSchema>[]> {
    const model = env.GEMINI_MODEL || 'gemini-2.0-flash';
    const prompt = `You are a math worksheet question generator for elementary school students in India.

Topic: ${topicName}
Skill: ${skillName}

Generate exactly ${count} unique math questions for this skill. Each question must be appropriate for the skill level described.

Rules:
- Questions must be computational (not word problems unless the skill requires it)
- Provide the correct numerical answer for each question
- Provide a short instruction line in English and Hindi (e.g., "Add the following.\\nजोड़ करो।")
- All ${count} questions must test the SAME skill but with different numbers
- Keep question text concise (how it would appear on a worksheet)
- For division, use the format: "divisor ) dividend" (e.g., "3 ) 24")
- For vertical operations, just show the horizontal form (e.g., "145 + 37")

Return a JSON array of objects with fields: question, answer, instruction
Return ONLY the JSON array, no other text.`;

    const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.8,
                    responseMimeType: 'application/json'
                }
            })
        }
    );

    if (!response.ok) {
        const text = await response.text();
        throw new Error(`Gemini API error ${response.status}: ${text}`);
    }

    const data = await response.json() as any;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text) throw new Error('Empty response from Gemini');

    const parsed = JSON.parse(text);
    return z.array(QuestionSchema).parse(parsed);
}

async function storeQuestionsOnBackend(
    env: Env,
    mathSkillId: string,
    questions: z.infer<typeof QuestionSchema>[],
    batchId: string
): Promise<void> {
    const res = await fetch(
        `${env.WORKSHEET_CREATION_BACKEND_BASE_URL}/internal/question-bank/store`,
        {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Worksheet-Creation-Token': env.WORKSHEET_CREATION_WORKER_TOKEN
            },
            body: JSON.stringify({ mathSkillId, questions, batchId })
        }
    );
    if (!res.ok) {
        const text = await res.text();
        throw new Error(`Backend store failed: ${res.status} ${text}`);
    }
}

export default {
    // HTTP handler — synchronous single-student flow (dev/small batches)
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        const token = request.headers.get('X-Worksheet-Creation-Token');
        if (!token || token !== env.WORKSHEET_CREATION_WORKER_TOKEN) {
            return new Response('Unauthorized', { status: 401 });
        }

        try {
            const body = await request.json();
            const input = RequestSchema.parse(body);
            const questions = await generateQuestions(env, input.skillName, input.topicName, input.count);

            return Response.json({
                success: true,
                mathSkillId: input.mathSkillId,
                questions
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Question generation failed:', message);
            return Response.json({ success: false, error: message }, { status: 500 });
        }
    },

    // Queue handler — async batch flow
    async queue(batch: any, env: Env): Promise<void> {
        const messages = (batch.messages || []) as any[];

        for (const message of messages) {
            try {
                const body = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
                const msg = body as QueueMessageV1;

                if (msg.v !== 1 || !msg.mathSkillId || !msg.skillName) {
                    console.error('Invalid queue message:', JSON.stringify(body));
                    message.ack();
                    continue;
                }

                const questions = await generateQuestions(env, msg.skillName, msg.topicName, msg.count);

                await storeQuestionsOnBackend(env, msg.mathSkillId, questions, msg.batchId);

                message.ack();
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                console.error('Queue message processing failed:', errorMsg);

                // Retry on Gemini rate limits or transient errors
                if (errorMsg.includes('429') || errorMsg.includes('503') || errorMsg.includes('500')) {
                    message.retry();
                } else {
                    // Non-retryable — ack to remove from queue
                    console.error('Non-retryable error, dropping message');
                    message.ack();
                }
            }
        }
    }
};
```

**Step 3: Typecheck + commit**

```bash
cd cloudflare/question-generator && npm run typecheck
git add cloudflare/question-generator/
git commit -m "feat: add queue consumer to question generator worker"
```

---

## Task 6: Backend Store Endpoint — Trigger Batch Progress

**Files:**
- Modify: `backend/src/controllers/questionBankController.ts`

**Step 1: Update storeQuestions to handle batchId and trigger assembly**

Replace the `storeQuestions` function in `backend/src/controllers/questionBankController.ts`:

```typescript
import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { onSkillQuestionsReady } from '../services/worksheetBatchService';

/**
 * POST /internal/question-bank/store
 * Called by CF worker to store generated questions.
 * Body: { mathSkillId, questions: [{question, answer, instruction}], batchId? }
 */
export async function storeQuestions(req: Request, res: Response): Promise<Response> {
    const { mathSkillId, questions, batchId } = req.body;

    if (!mathSkillId || !Array.isArray(questions) || questions.length === 0) {
        return res.status(400).json({ success: false, error: 'mathSkillId and questions[] required' });
    }

    const created = await prisma.questionBank.createMany({
        data: questions.map((q: any) => ({
            mathSkillId,
            question: q.question,
            answer: q.answer,
            instruction: q.instruction
        }))
    });

    // If part of a batch, notify batch service
    if (batchId) {
        try {
            await onSkillQuestionsReady(batchId);
        } catch (err) {
            console.error(`[question-bank] onSkillQuestionsReady error for batch ${batchId}:`, err);
        }
    }

    return res.json({ success: true, stored: created.count });
}
```

Keep the existing `triggerGeneration` function unchanged (still used for single-student sync flow).

**Step 2: Verify + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/controllers/questionBankController.ts
git commit -m "feat: trigger batch assembly when questions stored from queue"
```

---

## Task 7: PDF Renderer Worker — Cloudflare Browser Rendering

**Files:**
- Create: `cloudflare/pdf-renderer/wrangler.toml`
- Create: `cloudflare/pdf-renderer/package.json`
- Create: `cloudflare/pdf-renderer/tsconfig.json`
- Create: `cloudflare/pdf-renderer/src/index.ts`
- Create: `cloudflare/pdf-renderer/src/htmlTemplate.ts`
- Create: `cloudflare/pdf-renderer/src/backendClient.ts`

**Step 1: Scaffold the project**

```bash
mkdir -p cloudflare/pdf-renderer/src
```

`cloudflare/pdf-renderer/package.json`:
```json
{
  "name": "pdf-renderer",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250214.0",
    "@cloudflare/puppeteer": "^0.0.15",
    "typescript": "^5.7.3",
    "wrangler": "^4.0.0"
  }
}
```

`cloudflare/pdf-renderer/tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ESNext",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ESNext"],
    "types": ["@cloudflare/workers-types/2023-07-01"],
    "strict": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

`cloudflare/pdf-renderer/wrangler.toml`:
```toml
name = "pdf-renderer"
main = "src/index.ts"
compatibility_date = "2026-02-14"

# Secrets (set via `wrangler secret put`):
# - WORKSHEET_CREATION_WORKER_TOKEN
# - WORKSHEET_CREATION_BACKEND_BASE_URL

browser = { binding = "BROWSER" }

[[r2_buckets]]
binding = "PDF_BUCKET"
bucket_name = "worksheet-grading-files"

[[queues.consumers]]
queue = "pdf-rendering"
max_batch_size = 2
max_batch_timeout = 10
max_concurrency = 100
max_retries = 3
dead_letter_queue = "pdf-rendering-dlq"
```

**Step 2: Create the HTML template module**

`cloudflare/pdf-renderer/src/htmlTemplate.ts`:

Copy the `buildPageHtml`, `escapeHtml`, and `buildFullHtml` functions from `backend/src/services/worksheetPdfService.ts`. These are pure functions with no Node.js dependencies:

```typescript
interface SectionData {
    skillId: string;
    skillName: string;
    instruction: string;
    questions: { question: string; answer: string }[];
}

function buildPageHtml(sections: [SectionData, SectionData], pageStartQ: number): string {
    const [sectionTop, sectionBottom] = sections;

    const renderGrid = (questions: { question: string }[], startNum: number) => {
        const cols = 4;
        const rows = Math.ceil(questions.length / cols);
        let html = '<div style="display:grid;grid-template-columns:repeat(4,1fr);grid-template-rows:repeat(' + rows + ',1fr);gap:8px 16px;margin-top:12px;">';
        for (let r = 0; r < rows; r++) {
            for (let c = 0; c < cols; c++) {
                const idx = c * rows + r;
                const q = questions[idx];
                const num = startNum + idx;
                if (q) {
                    html += `<div style="font-size:14px;padding:4px 0;min-height:60px;border-left:${c > 0 ? '1px solid #ccc' : 'none'};padding-left:${c > 0 ? '12px' : '0'};">Q${num}. ${escapeHtml(q.question)}</div>`;
                } else {
                    html += '<div></div>';
                }
            }
        }
        html += '</div>';
        return html;
    };

    return `
        <div style="border:3px solid #888;border-radius:4px;padding:20px 24px;height:100%;box-sizing:border-box;display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;font-size:13px;border-bottom:1px solid #aaa;padding-bottom:8px;margin-bottom:4px;">
                <span>Name:________________</span>
                <span>Token Number:________</span>
                <span>Marks:______</span>
            </div>
            <div style="flex:1;display:flex;flex-direction:column;">
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:bold;margin-top:12px;white-space:pre-line;">${escapeHtml(sectionTop.instruction)}</div>
                    ${renderGrid(sectionTop.questions, pageStartQ)}
                </div>
                <div style="border-top:2px solid #aaa;margin:12px 0;"></div>
                <div style="flex:1;">
                    <div style="font-size:13px;font-weight:bold;white-space:pre-line;">${escapeHtml(sectionBottom.instruction)}</div>
                    ${renderGrid(sectionBottom.questions, pageStartQ + 10)}
                </div>
            </div>
            <div style="text-align:right;margin-top:8px;font-size:18px;font-weight:bold;color:#444;">
                Saarthi<br/><span style="font-size:10px;font-weight:normal;letter-spacing:2px;">EDUCATION</span>
            </div>
        </div>
    `;
}

function escapeHtml(text: string): string {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function buildFullHtml(sections: SectionData[]): string {
    const page1 = buildPageHtml([sections[0], sections[1]], 1);
    const page2 = buildPageHtml([sections[2], sections[3]], 21);

    return `<!DOCTYPE html>
<html>
<head>
<style>
    @page { size: A4; margin: 10mm; }
    body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 0; }
    .page { width: 100%; height: 100vh; page-break-after: always; }
    .page:last-child { page-break-after: auto; }
</style>
</head>
<body>
    <div class="page">${page1}</div>
    <div class="page">${page2}</div>
</body>
</html>`;
}
```

**Step 3: Create the backend client**

`cloudflare/pdf-renderer/src/backendClient.ts`:

```typescript
interface Env {
    WORKSHEET_CREATION_BACKEND_BASE_URL: string;
    WORKSHEET_CREATION_WORKER_TOKEN: string;
}

interface WorksheetData {
    id: string;
    studentId: string;
    batchId: string | null;
    sectionsJson: any;
}

export class BackendClient {
    private readonly baseUrl: string;
    private readonly token: string;

    constructor(env: Env) {
        this.baseUrl = env.WORKSHEET_CREATION_BACKEND_BASE_URL.replace(/\/$/, '');
        this.token = env.WORKSHEET_CREATION_WORKER_TOKEN;
    }

    async getWorksheetData(worksheetId: string): Promise<WorksheetData> {
        const res = await fetch(
            `${this.baseUrl}/internal/worksheet-generation/${worksheetId}/data`,
            {
                headers: {
                    'X-Worksheet-Creation-Token': this.token,
                    'Content-Type': 'application/json'
                }
            }
        );
        if (!res.ok) throw new Error(`Failed to fetch worksheet data: ${res.status}`);
        const json = await res.json() as any;
        return json.data;
    }

    async markComplete(worksheetId: string, pdfUrl: string, batchId: string | null): Promise<void> {
        const res = await fetch(
            `${this.baseUrl}/internal/worksheet-generation/${worksheetId}/complete`,
            {
                method: 'POST',
                headers: {
                    'X-Worksheet-Creation-Token': this.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ pdfUrl, batchId })
            }
        );
        if (!res.ok) throw new Error(`Failed to mark complete: ${res.status}`);
    }

    async markFailed(worksheetId: string, error: string, batchId: string | null): Promise<void> {
        const res = await fetch(
            `${this.baseUrl}/internal/worksheet-generation/${worksheetId}/fail`,
            {
                method: 'POST',
                headers: {
                    'X-Worksheet-Creation-Token': this.token,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ error, batchId })
            }
        );
        if (!res.ok) console.error(`Failed to mark failed: ${res.status}`);
    }
}
```

**Step 4: Create the main worker**

`cloudflare/pdf-renderer/src/index.ts`:

```typescript
import puppeteer from '@cloudflare/puppeteer';
import { buildFullHtml } from './htmlTemplate';
import { BackendClient } from './backendClient';

interface Env {
    BROWSER: any; // Cloudflare Browser Rendering binding
    PDF_BUCKET: R2Bucket;
    WORKSHEET_CREATION_BACKEND_BASE_URL: string;
    WORKSHEET_CREATION_WORKER_TOKEN: string;
}

interface QueueMessageV1 {
    v: 1;
    worksheetId: string;
    batchId: string;
    enqueuedAt: string;
}

export default {
    async queue(batch: any, env: Env): Promise<void> {
        const backend = new BackendClient(env);
        const messages = (batch.messages || []) as any[];

        for (const message of messages) {
            let worksheetId: string | null = null;
            let batchId: string | null = null;

            try {
                const body = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
                const msg = body as QueueMessageV1;
                worksheetId = msg.worksheetId;
                batchId = msg.batchId;

                if (!worksheetId) {
                    console.error('Missing worksheetId in queue message');
                    message.ack();
                    continue;
                }

                // 1. Fetch worksheet data from backend
                const wsData = await backend.getWorksheetData(worksheetId);
                const sections = wsData.sectionsJson;

                if (!sections || !Array.isArray(sections) || sections.length !== 4) {
                    throw new Error('Invalid sectionsJson');
                }

                // 2. Build HTML
                const html = buildFullHtml(sections);

                // 3. Render PDF via Browser Rendering
                const browser = await puppeteer.launch(env.BROWSER);
                const page = await browser.newPage();
                await page.setContent(html, { waitUntil: 'networkidle0' });

                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    printBackground: true,
                    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
                });

                await browser.close();

                // 4. Upload to R2
                const key = `generated-worksheets/${wsData.studentId}/${worksheetId}.pdf`;
                await env.PDF_BUCKET.put(key, pdfBuffer, {
                    httpMetadata: { contentType: 'application/pdf' }
                });

                // 5. Construct public URL and notify backend
                // Use the R2 public URL base from the existing setup
                const pdfUrl = `https://pub-c3c6a680b09a42b8aaa905a95ab0b07c.r2.dev/${key}`;

                await backend.markComplete(worksheetId, pdfUrl, batchId);
                message.ack();
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                console.error(`PDF render failed for ${worksheetId}:`, errorMsg);

                if (worksheetId) {
                    try {
                        await backend.markFailed(worksheetId, errorMsg, batchId);
                    } catch (e) {
                        console.error('Failed to mark worksheet as failed:', e);
                    }
                }

                // Retry on transient errors
                if (errorMsg.includes('429') || errorMsg.includes('503') || errorMsg.includes('timeout')) {
                    message.retry();
                } else {
                    message.ack();
                }
            }
        }
    }
};
```

**Step 5: Install deps + typecheck**

```bash
cd cloudflare/pdf-renderer && npm install && npm run typecheck
```

**Step 6: Commit**

```bash
git add cloudflare/pdf-renderer/
git commit -m "feat: add PDF renderer worker with CF Browser Rendering"
```

---

## Task 8: Backend Internal Endpoints for PDF Worker

**Files:**
- Create: `backend/src/controllers/internalWorksheetGenerationController.ts`
- Create: `backend/src/routes/internalWorksheetGenerationRoutes.ts`
- Modify: `backend/src/index.ts` (register routes)

**Step 1: Create the controller**

`backend/src/controllers/internalWorksheetGenerationController.ts`:

```typescript
import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { onWorksheetPdfComplete } from '../services/worksheetBatchService';

/**
 * GET /internal/worksheet-generation/:id/data
 * Returns worksheet sectionsJson for PDF rendering worker.
 */
export async function getWorksheetData(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;

    const ws = await prisma.generatedWorksheet.findUnique({
        where: { id },
        select: {
            id: true,
            studentId: true,
            batchId: true,
            sectionsJson: true,
            status: true
        }
    });

    if (!ws) {
        return res.status(404).json({ success: false, error: 'Worksheet not found' });
    }

    return res.json({ success: true, data: ws });
}

/**
 * POST /internal/worksheet-generation/:id/complete
 * Called by PDF renderer worker after successful rendering.
 * Body: { pdfUrl, batchId? }
 */
export async function completeWorksheet(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const { pdfUrl, batchId } = req.body;

    if (!pdfUrl) {
        return res.status(400).json({ success: false, error: 'pdfUrl required' });
    }

    await prisma.generatedWorksheet.update({
        where: { id },
        data: { pdfUrl, status: 'COMPLETED' }
    });

    if (batchId) {
        try {
            await onWorksheetPdfComplete(batchId, false);
        } catch (err) {
            console.error(`[ws-gen] onWorksheetPdfComplete error:`, err);
        }
    }

    return res.json({ success: true });
}

/**
 * POST /internal/worksheet-generation/:id/fail
 * Called by PDF renderer worker on failure.
 * Body: { error, batchId? }
 */
export async function failWorksheet(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const { batchId } = req.body;

    await prisma.generatedWorksheet.update({
        where: { id },
        data: { status: 'FAILED' }
    });

    if (batchId) {
        try {
            await onWorksheetPdfComplete(batchId, true);
        } catch (err) {
            console.error(`[ws-gen] onWorksheetPdfComplete error:`, err);
        }
    }

    return res.json({ success: true });
}
```

**Step 2: Create routes**

`backend/src/routes/internalWorksheetGenerationRoutes.ts`:

```typescript
import express from 'express';
import { getWorksheetData, completeWorksheet, failWorksheet } from '../controllers/internalWorksheetGenerationController';
import { requireWorksheetCreationToken } from '../middleware/worksheetCreationAuth';
import { asHandler } from '../middleware/utils';

const router = express.Router();

router.use(requireWorksheetCreationToken);

router.get('/:id/data', asHandler(getWorksheetData));
router.post('/:id/complete', asHandler(completeWorksheet));
router.post('/:id/fail', asHandler(failWorksheet));

export default router;
```

**Step 3: Register in index.ts**

In `backend/src/index.ts`, add import:
```typescript
import internalWorksheetGenerationRoutes from './routes/internalWorksheetGenerationRoutes';
```

And add route registration (after the question-bank route):
```typescript
app.use('/internal/worksheet-generation', internalWorksheetGenerationRoutes);
```

**Step 4: Verify + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/controllers/internalWorksheetGenerationController.ts backend/src/routes/internalWorksheetGenerationRoutes.ts backend/src/index.ts
git commit -m "feat: add internal endpoints for PDF renderer worker callbacks"
```

---

## Task 9: API Endpoints — Class Generation + Batch Status

**Files:**
- Modify: `backend/src/controllers/worksheetGenerationController.ts`
- Modify: `backend/src/routes/worksheetGenerationRoutes.ts`

**Step 1: Add class generation and batch status endpoints**

Add to `backend/src/controllers/worksheetGenerationController.ts`:

```typescript
import { createClassBatch } from '../services/worksheetBatchService';

/**
 * POST /api/worksheet-generation/generate-class
 * Body: { classId, days, startDate }
 */
export async function generateClass(req: Request, res: Response): Promise<Response> {
    const { classId, days, startDate } = req.body;

    if (!classId || !days || !startDate) {
        return res.status(400).json({ success: false, error: 'classId, days, and startDate required' });
    }

    if (days < 1 || days > 30) {
        return res.status(400).json({ success: false, error: 'days must be 1-30' });
    }

    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) {
        return res.status(404).json({ success: false, error: 'Class not found' });
    }

    const result = await createClassBatch(classId, days, new Date(startDate));

    return res.json({
        success: true,
        data: {
            batchId: result.batchId,
            totalWorksheets: result.totalWorksheets,
            skillsToGenerate: result.skillsToGenerate,
            errors: result.errors
        }
    });
}

/**
 * GET /api/worksheet-generation/batch/:batchId
 * Returns batch status and progress.
 */
export async function getBatchStatus(req: Request, res: Response): Promise<Response> {
    const { batchId } = req.params;

    const batch = await prisma.worksheetBatch.findUnique({
        where: { id: batchId }
    });

    if (!batch) {
        return res.status(404).json({ success: false, error: 'Batch not found' });
    }

    return res.json({
        success: true,
        data: batch
    });
}
```

**Step 2: Add routes**

In `backend/src/routes/worksheetGenerationRoutes.ts`, add the imports and routes:

```typescript
import { generate, generateClass, getBatchStatus, listForStudent, getPdf } from '../controllers/worksheetGenerationController';

// ... existing routes ...
router.post('/generate-class', asHandler(generateClass));
router.get('/batch/:batchId', asHandler(getBatchStatus));
```

**Step 3: Verify + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/controllers/worksheetGenerationController.ts backend/src/routes/worksheetGenerationRoutes.ts
git commit -m "feat: add class-level generation and batch status API endpoints"
```

---

## Task 10: Frontend UI — Class Generation + Batch Progress

**Files:**
- Modify: `web-app/lib/api/worksheetGeneration.ts` (add class generation + batch API)
- Modify: `web-app/app/dashboard/superadmin/mastery/generate/page.tsx` (add class generation tab)

**Step 1: Update API client**

Add to `web-app/lib/api/worksheetGeneration.ts`:

```typescript
export interface WorksheetBatch {
    id: string;
    classId: string;
    days: number;
    startDate: string;
    status: 'PENDING' | 'GENERATING_QUESTIONS' | 'RENDERING_PDFS' | 'COMPLETED' | 'FAILED';
    totalWorksheets: number;
    completedWorksheets: number;
    failedWorksheets: number;
    pendingSkills: number;
    completedSkills: number;
    createdAt: string;
    updatedAt: string;
}

// Add to worksheetGenerationAPI object:
    generateClass: async (classId: string, days: number, startDate: string) => {
        return fetchAPI<{ success: boolean; data: { batchId: string; totalWorksheets: number; skillsToGenerate: number; errors: string[] } }>(
            '/worksheet-generation/generate-class',
            { method: 'POST', body: JSON.stringify({ classId, days, startDate }) }
        );
    },

    getBatchStatus: async (batchId: string) => {
        return fetchAPI<{ success: boolean; data: WorksheetBatch }>(
            `/worksheet-generation/batch/${batchId}`
        );
    },
```

**Step 2: Update the generate page**

Update `web-app/app/dashboard/superadmin/mastery/generate/page.tsx` to add a "Class" tab alongside the existing "Student" tab. The class tab shows:
- School → Class selectors (no student selector)
- Days + start date
- "Generate for Class" button
- Batch progress bar (polls `getBatchStatus` every 3 seconds while in progress)
- Shows: `{completedWorksheets}/{totalWorksheets}` with status badge

Use existing patterns from the page. Add a `mode` state toggle: `'student' | 'class'`.

**Step 3: Verify build + commit**

```bash
cd web-app && npx next build
git add web-app/lib/api/worksheetGeneration.ts web-app/app/dashboard/superadmin/mastery/generate/
git commit -m "feat: add class-level worksheet generation UI with batch progress"
```

---

## Task 11: Create CF Queues + Deploy Workers

**Step 1: Create the queues via Cloudflare API**

```bash
# Create question-generation queue
curl -X POST "https://api.cloudflare.com/client/v4/accounts/2ffbc97db67c45deb3098acd1f647ac0/queues" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"queue_name": "question-generation"}'

# Create question-generation DLQ
curl -X POST "https://api.cloudflare.com/client/v4/accounts/2ffbc97db67c45deb3098acd1f647ac0/queues" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"queue_name": "question-generation-dlq"}'

# Create pdf-rendering queue
curl -X POST "https://api.cloudflare.com/client/v4/accounts/2ffbc97db67c45deb3098acd1f647ac0/queues" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"queue_name": "pdf-rendering"}'

# Create pdf-rendering DLQ
curl -X POST "https://api.cloudflare.com/client/v4/accounts/2ffbc97db67c45deb3098acd1f647ac0/queues" \
  -H "Authorization: Bearer $CF_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"queue_name": "pdf-rendering-dlq"}'
```

**Step 2: Note the queue IDs from responses and add to backend .env**

```
QUESTION_GENERATION_QUEUE_ID=<from response>
PDF_RENDERING_QUEUE_ID=<from response>
```

**Step 3: Deploy question-generator worker**

```bash
cd cloudflare/question-generator
npx wrangler secret put WORKSHEET_CREATION_BACKEND_BASE_URL
# Enter production backend URL
npx wrangler deploy
```

**Step 4: Deploy pdf-renderer worker**

```bash
cd cloudflare/pdf-renderer
npm install
npx wrangler secret put WORKSHEET_CREATION_WORKER_TOKEN
# Enter the same token from backend .env
npx wrangler secret put WORKSHEET_CREATION_BACKEND_BASE_URL
# Enter production backend URL
npx wrangler deploy
```

**Step 5: Commit any config changes**

```bash
git add -A
git commit -m "chore: deploy workers and configure queues"
```

---

## Task 12: End-to-End Verification

**Step 1: Verify backend compiles and starts**
```bash
cd backend && npx tsc --noEmit
```

**Step 2: Verify both workers typecheck**
```bash
cd cloudflare/question-generator && npm run typecheck
cd cloudflare/pdf-renderer && npm run typecheck
```

**Step 3: Test single-student generation still works**
The existing `/api/worksheet-generation/generate` endpoint should continue to work synchronously.

**Step 4: Test class-level generation**
```bash
curl -X POST http://localhost:5100/api/worksheet-generation/generate-class \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"classId": "<class-id>", "days": 1, "startDate": "2026-03-06"}'
```
Verify batch is created, question generation jobs are enqueued, PDFs are rendered.

**Step 5: Test batch status polling**
```bash
curl http://localhost:5100/api/worksheet-generation/batch/<batch-id> \
  -H "Authorization: Bearer <admin-token>"
```
Verify progress updates as worksheets complete.

**Step 6: Test UI**
Navigate to `/dashboard/superadmin/mastery/generate`, switch to class mode, generate for a class, verify progress bar updates and PDFs are downloadable.
