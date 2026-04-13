# Custom Worksheet Generation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generate personalized daily math worksheets per student with 50% new curriculum skill + 50% spaced-repetition review, LLM-generated questions stored in a reusable bank, rendered to printable PDF.

**Architecture:** Backend scheduler picks skills per day using FSRS mastery data. A Cloudflare Worker generates questions via LLM and stores them in a QuestionBank table. Backend renders questions into HTML templates and converts to PDF via Puppeteer. PDFs are stored in S3/R2 for download.

**Tech Stack:** Prisma (DB), Cloudflare Workers + AI SDK (question generation), Puppeteer (PDF), Express (API), Next.js (UI)

**Design doc:** `docs/plans/2026-03-05-custom-worksheet-generation-design.md`

---

## Task 1: Prisma Schema — QuestionBank + GeneratedWorksheet

**Files:**
- Modify: `backend/prisma/schema.prisma`
- Create: `backend/prisma/migrations/[timestamp]_add_worksheet_generation/migration.sql`

**Step 1: Add models to schema.prisma**

Add relation field on `MathSkill` (after `studentMastery` line ~137):
```prisma
  questionBank       QuestionBank[]
```

Add relation field on `User` (after `skillMastery` line ~30):
```prisma
  generatedWorksheets GeneratedWorksheet[]
```

Add new enum and models at end of schema:

```prisma
enum GeneratedWorksheetStatus {
  PENDING
  QUESTIONS_READY
  RENDERING
  COMPLETED
  FAILED
}

model QuestionBank {
  id          String    @id @default(uuid())
  mathSkillId String
  mathSkill   MathSkill @relation(fields: [mathSkillId], references: [id])
  question    String
  answer      String
  instruction String
  usedCount   Int       @default(0)
  createdAt   DateTime  @default(now())

  @@index([mathSkillId, usedCount])
}

model GeneratedWorksheet {
  id             String                   @id @default(uuid())
  studentId      String
  student        User                     @relation(fields: [studentId], references: [id])
  scheduledDate  DateTime
  pdfUrl         String?
  status         GeneratedWorksheetStatus @default(PENDING)
  newSkillId     String
  reviewSkill1Id String
  reviewSkill2Id String
  sectionsJson   Json?
  createdAt      DateTime                 @default(now())
  updatedAt      DateTime                 @updatedAt

  @@index([studentId, scheduledDate])
  @@index([status])
}
```

Note: GeneratedWorksheet intentionally does NOT have Prisma relations to MathSkill (would need 3 named relations which clutters MathSkill). Store skill IDs as plain strings, join manually when needed.

**Step 2: Create migration SQL**

Create `backend/prisma/migrations/20260305140000_add_worksheet_generation/migration.sql`:

```sql
-- CreateEnum
CREATE TYPE "GeneratedWorksheetStatus" AS ENUM ('PENDING', 'QUESTIONS_READY', 'RENDERING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "QuestionBank" (
    "id" TEXT NOT NULL,
    "mathSkillId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "instruction" TEXT NOT NULL,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "QuestionBank_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GeneratedWorksheet" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "scheduledDate" TIMESTAMP(3) NOT NULL,
    "pdfUrl" TEXT,
    "status" "GeneratedWorksheetStatus" NOT NULL DEFAULT 'PENDING',
    "newSkillId" TEXT NOT NULL,
    "reviewSkill1Id" TEXT NOT NULL,
    "reviewSkill2Id" TEXT NOT NULL,
    "sectionsJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "GeneratedWorksheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "QuestionBank_mathSkillId_usedCount_idx" ON "QuestionBank"("mathSkillId", "usedCount");

-- CreateIndex
CREATE INDEX "GeneratedWorksheet_studentId_scheduledDate_idx" ON "GeneratedWorksheet"("studentId", "scheduledDate");

-- CreateIndex
CREATE INDEX "GeneratedWorksheet_status_idx" ON "GeneratedWorksheet"("status");

-- AddForeignKey
ALTER TABLE "QuestionBank" ADD CONSTRAINT "QuestionBank_mathSkillId_fkey" FOREIGN KEY ("mathSkillId") REFERENCES "MathSkill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GeneratedWorksheet" ADD CONSTRAINT "GeneratedWorksheet_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
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
git commit -m "feat: add QuestionBank and GeneratedWorksheet schema for worksheet generation"
```

---

## Task 2: Skill Scheduler Service

**Files:**
- Create: `backend/src/services/worksheetSchedulerService.ts`

**Step 1: Implement the scheduler**

This service takes a studentId and number of days and returns skill assignments for each day.

```typescript
import { MasteryLevel } from '@prisma/client';
import prisma from '../utils/prisma';

interface DayPlan {
    scheduledDate: Date;
    newSkillId: string;
    reviewSkill1Id: string;
    reviewSkill2Id: string;
}

interface SchedulerResult {
    plans: DayPlan[];
    errors: string[];
}

const FSRS_DECAY = -0.154;
const FSRS_FACTOR = 0.9 ** (1 / FSRS_DECAY) - 1;

const LEVEL_WEIGHTS: Record<MasteryLevel, number> = {
    NOT_STARTED: 0,
    ATTEMPTED: 0.6,
    FAMILIAR: 0.8,
    PROFICIENT: 1.0,
    MASTERED: 1.2
};

function computeRetrievability(daysSince: number, stability: number): number {
    if (daysSince <= 0) return 1.0;
    return Math.pow(1 + FSRS_FACTOR * daysSince / stability, FSRS_DECAY);
}

export async function planWorksheets(
    studentId: string,
    days: number,
    startDate: Date
): Promise<SchedulerResult> {
    const errors: string[] = [];

    // 1. Get all curriculum skills in order (via WorksheetSkillMap)
    const allSkillMaps = await prisma.worksheetSkillMap.findMany({
        orderBy: { worksheetNumber: 'asc' },
        select: { worksheetNumber: true, mathSkillId: true }
    });

    if (allSkillMaps.length === 0) {
        return { plans: [], errors: ['No skills mapped in curriculum'] };
    }

    // 2. Find student's last practiced skill to determine curriculum position
    const lastPractice = await prisma.skillPracticeLog.findFirst({
        where: { studentId },
        orderBy: { practicedAt: 'desc' },
        select: { mathSkillId: true }
    });

    // Find the index in curriculum of the last practiced skill
    let startIdx = 0;
    if (lastPractice) {
        const idx = allSkillMaps.findIndex(m => m.mathSkillId === lastPractice.mathSkillId);
        if (idx >= 0) startIdx = idx + 1;
    }

    // Deduplicate curriculum skills (same skill may appear multiple times)
    const seen = new Set<string>();
    const curriculumSkills: string[] = [];
    for (const m of allSkillMaps) {
        if (!seen.has(m.mathSkillId)) {
            seen.add(m.mathSkillId);
            curriculumSkills.push(m.mathSkillId);
        }
    }

    // Recompute startIdx on deduplicated list
    if (lastPractice) {
        const idx = curriculumSkills.indexOf(lastPractice.mathSkillId);
        if (idx >= 0) startIdx = idx + 1;
    }

    // 3. Load student's mastery state for review simulation
    const masteryRecords = await prisma.studentSkillMastery.findMany({
        where: { studentId, lastPracticeAt: { not: null } }
    });

    // Build simulated state (mutable copy)
    const simState = new Map<string, { lastPracticeAt: Date; stability: number; level: MasteryLevel }>();
    for (const r of masteryRecords) {
        if (r.lastPracticeAt) {
            simState.set(r.mathSkillId, {
                lastPracticeAt: r.lastPracticeAt,
                stability: r.stability,
                level: r.masteryLevel
            });
        }
    }

    // 4. Plan each day
    const plans: DayPlan[] = [];
    for (let d = 0; d < days; d++) {
        const scheduledDate = new Date(startDate);
        scheduledDate.setDate(scheduledDate.getDate() + d);

        // New skill: next in curriculum
        const newIdx = (startIdx + d) % curriculumSkills.length;
        const newSkillId = curriculumSkills[newIdx];

        // Review skills: top 2 by priority, excluding the new skill
        const now = scheduledDate;
        const candidates: { skillId: string; priority: number }[] = [];

        for (const [skillId, state] of simState) {
            if (skillId === newSkillId) continue;
            if (state.level === MasteryLevel.NOT_STARTED) continue;

            const daysSince = (now.getTime() - state.lastPracticeAt.getTime()) / (1000 * 60 * 60 * 24);
            const R = computeRetrievability(daysSince, state.stability);
            const priority = (1 - R) * LEVEL_WEIGHTS[state.level];
            candidates.push({ skillId, priority });
        }

        candidates.sort((a, b) => b.priority - a.priority);

        const review1 = candidates[0]?.skillId ?? curriculumSkills[Math.max(0, newIdx - 1)];
        const review2 = candidates[1]?.skillId ?? curriculumSkills[Math.max(0, newIdx - 2)];

        plans.push({ scheduledDate, newSkillId, reviewSkill1Id: review1, reviewSkill2Id: review2 });

        // Simulate refresh for picked skills
        const refreshDate = scheduledDate;
        for (const skillId of [newSkillId, review1, review2]) {
            const existing = simState.get(skillId);
            if (existing) {
                existing.lastPracticeAt = refreshDate;
            } else {
                simState.set(skillId, {
                    lastPracticeAt: refreshDate,
                    stability: 1.0,
                    level: MasteryLevel.ATTEMPTED
                });
            }
        }
    }

    return { plans, errors };
}
```

**Step 2: Verify compilation**

```bash
cd backend && npx tsc --noEmit
```

**Step 3: Commit**

```bash
git add backend/src/services/worksheetSchedulerService.ts
git commit -m "feat: add worksheet scheduler service with curriculum + review planning"
```

---

## Task 3: Question Generation — CF Worker

**Files:**
- Create: `cloudflare/question-generator/wrangler.toml`
- Create: `cloudflare/question-generator/package.json`
- Create: `cloudflare/question-generator/tsconfig.json`
- Create: `cloudflare/question-generator/src/index.ts`

**Step 1: Scaffold the CF worker project**

```bash
mkdir -p cloudflare/question-generator/src
```

`cloudflare/question-generator/package.json`:
```json
{
  "name": "question-generator",
  "private": true,
  "scripts": {
    "dev": "wrangler dev",
    "deploy": "wrangler deploy",
    "typecheck": "tsc --noEmit"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "^4.20250214.0",
    "typescript": "^5.7.3",
    "wrangler": "^4.0.0"
  },
  "dependencies": {
    "zod": "^3.24.2"
  }
}
```

`cloudflare/question-generator/tsconfig.json`:
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

`cloudflare/question-generator/wrangler.toml`:
```toml
name = "question-generator"
main = "src/index.ts"
compatibility_date = "2026-02-14"

[vars]
BACKEND_BASE_URL = "https://your-backend.example.com"
# BACKEND_WORKER_TOKEN, GEMINI_API_KEY set as secrets
```

**Step 2: Implement the worker**

`cloudflare/question-generator/src/index.ts`:

The worker exposes an HTTP endpoint (POST /) that:
1. Receives `{ mathSkillId, skillName, topicName, count }` + auth token
2. Calls Gemini to generate questions as JSON
3. POSTs the results back to the backend's internal endpoint

```typescript
import { z } from 'zod';

interface Env {
    BACKEND_BASE_URL: string;
    BACKEND_WORKER_TOKEN: string;
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
    const questions = z.array(QuestionSchema).parse(parsed);
    return questions;
}

export default {
    async fetch(request: Request, env: Env): Promise<Response> {
        if (request.method !== 'POST') {
            return new Response('Method not allowed', { status: 405 });
        }

        // Auth check
        const token = request.headers.get('X-Grading-Worker-Token');
        if (!token || token !== env.BACKEND_WORKER_TOKEN) {
            return new Response('Unauthorized', { status: 401 });
        }

        try {
            const body = await request.json();
            const input = RequestSchema.parse(body);

            const questions = await generateQuestions(env, input.skillName, input.topicName, input.count);

            // POST results back to backend
            const backendResponse = await fetch(
                `${env.BACKEND_BASE_URL}/internal/question-bank/store`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Grading-Worker-Token': env.BACKEND_WORKER_TOKEN
                    },
                    body: JSON.stringify({
                        mathSkillId: input.mathSkillId,
                        questions
                    })
                }
            );

            if (!backendResponse.ok) {
                const errText = await backendResponse.text();
                throw new Error(`Backend store failed: ${backendResponse.status} ${errText}`);
            }

            return Response.json({
                success: true,
                stored: questions.length,
                mathSkillId: input.mathSkillId
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Unknown error';
            console.error('Question generation failed:', message);
            return Response.json({ success: false, error: message }, { status: 500 });
        }
    }
};
```

**Step 3: Install deps and typecheck**

```bash
cd cloudflare/question-generator && npm install && npm run typecheck
```

**Step 4: Commit**

```bash
git add cloudflare/question-generator/
git commit -m "feat: add Cloudflare Worker for LLM-based question generation"
```

---

## Task 4: Backend Internal Endpoints for Question Bank

**Files:**
- Create: `backend/src/controllers/questionBankController.ts`
- Create: `backend/src/routes/internalQuestionBankRoutes.ts`
- Modify: `backend/src/index.ts` (add route registration)

**Step 1: Create the controller**

`backend/src/controllers/questionBankController.ts`:

Two endpoints:
- `POST /internal/question-bank/store` — CF worker stores generated questions
- `POST /internal/question-bank/generate` — Backend triggers CF worker to generate questions for a skill

```typescript
import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import config from '../config/env';

/**
 * POST /internal/question-bank/store
 * Called by CF worker to store generated questions.
 * Body: { mathSkillId, questions: [{question, answer, instruction}] }
 */
export async function storeQuestions(req: Request, res: Response): Promise<Response> {
    const { mathSkillId, questions } = req.body;

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

    return res.json({ success: true, stored: created.count });
}

/**
 * POST /internal/question-bank/generate
 * Triggers question generation for a skill via CF worker.
 * Body: { mathSkillId, count? }
 */
export async function triggerGeneration(req: Request, res: Response): Promise<Response> {
    const { mathSkillId, count } = req.body;

    const skill = await prisma.mathSkill.findUnique({
        where: { id: mathSkillId },
        include: { mainTopic: true }
    });

    if (!skill) {
        return res.status(404).json({ success: false, error: 'Skill not found' });
    }

    const workerUrl = process.env.QUESTION_GENERATOR_WORKER_URL;
    if (!workerUrl) {
        return res.status(500).json({ success: false, error: 'QUESTION_GENERATOR_WORKER_URL not configured' });
    }

    try {
        const response = await fetch(workerUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Grading-Worker-Token': config.gradingWorkerToken
            },
            body: JSON.stringify({
                mathSkillId: skill.id,
                skillName: skill.name,
                topicName: skill.mainTopic?.name ?? 'Math',
                count: count ?? 30
            })
        });

        if (!response.ok) {
            const text = await response.text();
            return res.status(502).json({ success: false, error: `Worker error: ${response.status} ${text}` });
        }

        const result = await response.json();
        return res.json({ success: true, data: result });
    } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        return res.status(500).json({ success: false, error: message });
    }
}
```

**Step 2: Create routes**

`backend/src/routes/internalQuestionBankRoutes.ts`:

```typescript
import express from 'express';
import { storeQuestions, triggerGeneration } from '../controllers/questionBankController';
import { requireGradingWorkerToken } from '../middleware/gradingWorkerAuth';
import { asHandler } from '../middleware/utils';

const router = express.Router();

router.use(requireGradingWorkerToken);

router.post('/store', asHandler(storeQuestions));
router.post('/generate', asHandler(triggerGeneration));

export default router;
```

**Step 3: Register routes in index.ts**

In `backend/src/index.ts`, add after the `internalGradingWorkerRoutes` line:

```typescript
import internalQuestionBankRoutes from './routes/internalQuestionBankRoutes';
// ... and in routes section:
app.use('/internal/question-bank', internalQuestionBankRoutes);
```

**Step 4: Verify compilation**

```bash
cd backend && npx tsc --noEmit
```

**Step 5: Commit**

```bash
git add backend/src/controllers/questionBankController.ts backend/src/routes/internalQuestionBankRoutes.ts backend/src/index.ts
git commit -m "feat: add internal question bank endpoints for CF worker integration"
```

---

## Task 5: Worksheet Generation Orchestrator Service

**Files:**
- Create: `backend/src/services/worksheetGenerationService.ts`

This service orchestrates the full pipeline: schedule skills → ensure questions → assign questions to worksheet sections.

```typescript
import prisma from '../utils/prisma';
import config from '../config/env';
import { planWorksheets } from './worksheetSchedulerService';

interface GenerationResult {
    worksheetIds: string[];
    status: 'PENDING' | 'COMPLETED' | 'PARTIAL';
    errors: string[];
}

interface SectionData {
    skillId: string;
    skillName: string;
    instruction: string;
    questions: { question: string; answer: string }[];
}

/**
 * Main entry point: generate N days of worksheets for a student.
 */
export async function generateWorksheets(
    studentId: string,
    days: number,
    startDate: Date
): Promise<GenerationResult> {
    const errors: string[] = [];

    // 1. Plan skills for each day
    const { plans, errors: planErrors } = await planWorksheets(studentId, days, startDate);
    errors.push(...planErrors);

    if (plans.length === 0) {
        return { worksheetIds: [], status: 'COMPLETED', errors };
    }

    // 2. Collect all unique skills needed
    const skillIds = new Set<string>();
    for (const plan of plans) {
        skillIds.add(plan.newSkillId);
        skillIds.add(plan.reviewSkill1Id);
        skillIds.add(plan.reviewSkill2Id);
    }

    // 3. Ensure enough questions exist for each skill
    await ensureQuestionsForSkills(Array.from(skillIds), errors);

    // 4. Create GeneratedWorksheet rows and assign questions
    const worksheetIds: string[] = [];
    for (const plan of plans) {
        try {
            const sections = await buildSections(plan.newSkillId, plan.reviewSkill1Id, plan.reviewSkill2Id);
            const ws = await prisma.generatedWorksheet.create({
                data: {
                    studentId,
                    scheduledDate: plan.scheduledDate,
                    newSkillId: plan.newSkillId,
                    reviewSkill1Id: plan.reviewSkill1Id,
                    reviewSkill2Id: plan.reviewSkill2Id,
                    sectionsJson: sections,
                    status: 'QUESTIONS_READY'
                }
            });
            worksheetIds.push(ws.id);
        } catch (err) {
            errors.push(`Failed to create worksheet for ${plan.scheduledDate.toISOString()}: ${err}`);
        }
    }

    return {
        worksheetIds,
        status: errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
        errors
    };
}

/**
 * Ensure at least 20 questions exist per skill (need 10 or 20 per worksheet).
 * Triggers CF worker generation if insufficient.
 */
async function ensureQuestionsForSkills(skillIds: string[], errors: string[]): Promise<void> {
    for (const skillId of skillIds) {
        const count = await prisma.questionBank.count({ where: { mathSkillId: skillId } });
        if (count >= 30) continue; // Enough questions

        // Trigger generation
        const skill = await prisma.mathSkill.findUnique({
            where: { id: skillId },
            include: { mainTopic: true }
        });
        if (!skill) continue;

        const workerUrl = process.env.QUESTION_GENERATOR_WORKER_URL;
        if (!workerUrl) {
            errors.push(`QUESTION_GENERATOR_WORKER_URL not set, cannot generate for ${skill.name}`);
            continue;
        }

        try {
            const response = await fetch(workerUrl, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Grading-Worker-Token': config.gradingWorkerToken
                },
                body: JSON.stringify({
                    mathSkillId: skill.id,
                    skillName: skill.name,
                    topicName: skill.mainTopic?.name ?? 'Math',
                    count: 30
                })
            });
            if (!response.ok) {
                errors.push(`Question generation failed for ${skill.name}: ${response.status}`);
            }
        } catch (err) {
            errors.push(`Question generation error for ${skill.name}: ${err}`);
        }
    }
}

/**
 * Draw questions from QuestionBank for each section.
 * Returns 4 sections: [sectionA, sectionB, sectionC, sectionD]
 */
async function buildSections(
    newSkillId: string,
    review1Id: string,
    review2Id: string
): Promise<SectionData[]> {
    const drawQuestions = async (skillId: string, count: number) => {
        const questions = await prisma.questionBank.findMany({
            where: { mathSkillId: skillId },
            orderBy: { usedCount: 'asc' },
            take: count,
            select: { id: true, question: true, answer: true, instruction: true }
        });

        if (questions.length > 0) {
            await prisma.questionBank.updateMany({
                where: { id: { in: questions.map(q => q.id) } },
                data: { usedCount: { increment: 1 } }
            });
        }

        return questions;
    };

    const getSkillName = async (skillId: string) => {
        const s = await prisma.mathSkill.findUnique({ where: { id: skillId }, select: { name: true } });
        return s?.name ?? 'Math';
    };

    // Section A + C: new skill (20 questions total, split 10+10)
    const newQuestions = await drawQuestions(newSkillId, 20);
    const newName = await getSkillName(newSkillId);
    const newInstruction = newQuestions[0]?.instruction ?? 'Solve the following.';

    // Section B: review skill 1 (10 questions)
    const review1Questions = await drawQuestions(review1Id, 10);
    const review1Name = await getSkillName(review1Id);
    const review1Instruction = review1Questions[0]?.instruction ?? 'Solve the following.';

    // Section D: review skill 2 (10 questions)
    const review2Questions = await drawQuestions(review2Id, 10);
    const review2Name = await getSkillName(review2Id);
    const review2Instruction = review2Questions[0]?.instruction ?? 'Solve the following.';

    return [
        {
            skillId: newSkillId,
            skillName: newName,
            instruction: newInstruction,
            questions: newQuestions.slice(0, 10).map(q => ({ question: q.question, answer: q.answer }))
        },
        {
            skillId: review1Id,
            skillName: review1Name,
            instruction: review1Instruction,
            questions: review1Questions.map(q => ({ question: q.question, answer: q.answer }))
        },
        {
            skillId: newSkillId,
            skillName: newName,
            instruction: newInstruction,
            questions: newQuestions.slice(10, 20).map(q => ({ question: q.question, answer: q.answer }))
        },
        {
            skillId: review2Id,
            skillName: review2Name,
            instruction: review2Instruction,
            questions: review2Questions.map(q => ({ question: q.question, answer: q.answer }))
        }
    ];
}
```

**Step 2: Commit**

```bash
git add backend/src/services/worksheetGenerationService.ts
git commit -m "feat: add worksheet generation orchestrator service"
```

---

## Task 6: PDF Renderer Service

**Files:**
- Modify: `backend/package.json` (add puppeteer)
- Create: `backend/src/services/worksheetPdfService.ts`

**Step 1: Install Puppeteer**

```bash
cd backend && npm install puppeteer
```

**Step 2: Create the PDF service**

`backend/src/services/worksheetPdfService.ts`:

Renders worksheet sections into HTML → Puppeteer → PDF buffer → upload to S3/R2.

```typescript
import puppeteer from 'puppeteer';
import prisma from '../utils/prisma';
import { uploadToS3 } from './s3Service';

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
                const idx = c * rows + r; // column-major order (Q1-5 in col 1, Q6-10 in col 2, etc.)
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

function buildFullHtml(sections: SectionData[]): string {
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

/**
 * Render a GeneratedWorksheet to PDF, upload to S3/R2, update DB record.
 */
export async function renderWorksheetPdf(worksheetId: string): Promise<string> {
    const ws = await prisma.generatedWorksheet.findUnique({ where: { id: worksheetId } });
    if (!ws) throw new Error(`Worksheet ${worksheetId} not found`);

    const sections = ws.sectionsJson as SectionData[];
    if (!sections || sections.length !== 4) throw new Error('Invalid sections data');

    await prisma.generatedWorksheet.update({
        where: { id: worksheetId },
        data: { status: 'RENDERING' }
    });

    try {
        const html = buildFullHtml(sections);

        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        const page = await browser.newPage();
        await page.setContent(html, { waitUntil: 'networkidle0' });

        const pdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true,
            margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
        });

        await browser.close();

        // Upload to S3/R2
        const key = `generated-worksheets/${ws.studentId}/${worksheetId}.pdf`;
        const pdfUrl = await uploadToS3(Buffer.from(pdfBuffer), key, 'application/pdf');

        await prisma.generatedWorksheet.update({
            where: { id: worksheetId },
            data: { pdfUrl, status: 'COMPLETED' }
        });

        return pdfUrl;
    } catch (err) {
        await prisma.generatedWorksheet.update({
            where: { id: worksheetId },
            data: { status: 'FAILED' }
        });
        throw err;
    }
}

/**
 * Render all worksheets in a batch.
 */
export async function renderBatchPdfs(worksheetIds: string[]): Promise<void> {
    for (const id of worksheetIds) {
        try {
            await renderWorksheetPdf(id);
        } catch (err) {
            console.error(`[pdf] render failed for ${id}:`, err);
        }
    }
}
```

**Step 3: Verify compilation**

```bash
cd backend && npx tsc --noEmit
```

**Step 4: Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/services/worksheetPdfService.ts
git commit -m "feat: add Puppeteer-based PDF renderer for generated worksheets"
```

---

## Task 7: API Endpoints — Controller + Routes

**Files:**
- Create: `backend/src/controllers/worksheetGenerationController.ts`
- Create: `backend/src/routes/worksheetGenerationRoutes.ts`
- Modify: `backend/src/index.ts` (register routes)

**Step 1: Create controller**

`backend/src/controllers/worksheetGenerationController.ts`:

```typescript
import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { generateWorksheets } from '../services/worksheetGenerationService';
import { renderBatchPdfs } from '../services/worksheetPdfService';

/**
 * POST /api/worksheet-generation/generate
 * Body: { studentId, days, startDate }
 */
export async function generate(req: Request, res: Response): Promise<Response> {
    const { studentId, days, startDate } = req.body;

    if (!studentId || !days || !startDate) {
        return res.status(400).json({ success: false, error: 'studentId, days, and startDate required' });
    }

    if (days < 1 || days > 30) {
        return res.status(400).json({ success: false, error: 'days must be 1-30' });
    }

    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student) {
        return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const result = await generateWorksheets(studentId, days, new Date(startDate));

    // Kick off PDF rendering in the background (don't await)
    if (result.worksheetIds.length > 0) {
        renderBatchPdfs(result.worksheetIds).catch(err => {
            console.error('[worksheet-gen] PDF batch render error:', err);
        });
    }

    return res.json({
        success: true,
        data: {
            worksheetIds: result.worksheetIds,
            status: result.status,
            errors: result.errors
        }
    });
}

/**
 * GET /api/worksheet-generation/student/:studentId
 * List generated worksheets for a student.
 */
export async function listForStudent(req: Request, res: Response): Promise<Response> {
    const { studentId } = req.params;

    const worksheets = await prisma.generatedWorksheet.findMany({
        where: { studentId },
        orderBy: { scheduledDate: 'asc' },
        select: {
            id: true,
            scheduledDate: true,
            status: true,
            pdfUrl: true,
            newSkillId: true,
            reviewSkill1Id: true,
            reviewSkill2Id: true,
            createdAt: true
        }
    });

    // Enrich with skill names
    const skillIds = new Set<string>();
    worksheets.forEach(w => {
        skillIds.add(w.newSkillId);
        skillIds.add(w.reviewSkill1Id);
        skillIds.add(w.reviewSkill2Id);
    });

    const skills = await prisma.mathSkill.findMany({
        where: { id: { in: Array.from(skillIds) } },
        select: { id: true, name: true }
    });
    const skillMap = new Map(skills.map(s => [s.id, s.name]));

    return res.json({
        success: true,
        data: worksheets.map(w => ({
            ...w,
            newSkillName: skillMap.get(w.newSkillId) ?? null,
            reviewSkill1Name: skillMap.get(w.reviewSkill1Id) ?? null,
            reviewSkill2Name: skillMap.get(w.reviewSkill2Id) ?? null
        }))
    });
}

/**
 * GET /api/worksheet-generation/:id/pdf
 * Redirect to PDF URL.
 */
export async function getPdf(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;

    const ws = await prisma.generatedWorksheet.findUnique({
        where: { id },
        select: { pdfUrl: true, status: true }
    });

    if (!ws) {
        return res.status(404).json({ success: false, error: 'Worksheet not found' });
    }

    if (ws.status !== 'COMPLETED' || !ws.pdfUrl) {
        return res.json({ success: false, status: ws.status, error: 'PDF not ready yet' });
    }

    return res.redirect(ws.pdfUrl);
}
```

**Step 2: Create routes**

`backend/src/routes/worksheetGenerationRoutes.ts`:

```typescript
import express from 'express';
import { UserRole } from '@prisma/client';
import { generate, listForStudent, getPdf } from '../controllers/worksheetGenerationController';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

router.use(auth);
router.use(authorizeRoles([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]));

router.post('/generate', asHandler(generate));
router.get('/student/:studentId', asHandler(listForStudent));
router.get('/:id/pdf', asHandler(getPdf));

export default router;
```

**Step 3: Register in index.ts**

Add to `backend/src/index.ts`:

```typescript
import worksheetGenerationRoutes from './routes/worksheetGenerationRoutes';
// ... in routes section:
app.use('/api/worksheet-generation', worksheetGenerationRoutes);
```

**Step 4: Verify compilation + commit**

```bash
cd backend && npx tsc --noEmit
git add backend/src/controllers/worksheetGenerationController.ts backend/src/routes/worksheetGenerationRoutes.ts backend/src/index.ts
git commit -m "feat: add worksheet generation API endpoints"
```

---

## Task 8: Frontend UI — Generate Worksheets Page

**Files:**
- Create: `web-app/lib/api/worksheetGeneration.ts`
- Create: `web-app/app/dashboard/superadmin/mastery/generate/page.tsx`
- Modify: `web-app/app/dashboard/superadmin/layout.tsx` (add nav link)

**Step 1: Create API client**

`web-app/lib/api/worksheetGeneration.ts`:

```typescript
import { fetchAPI } from './utils';

export interface GeneratedWorksheet {
    id: string;
    scheduledDate: string;
    status: 'PENDING' | 'QUESTIONS_READY' | 'RENDERING' | 'COMPLETED' | 'FAILED';
    pdfUrl: string | null;
    newSkillId: string;
    newSkillName: string | null;
    reviewSkill1Id: string;
    reviewSkill1Name: string | null;
    reviewSkill2Id: string;
    reviewSkill2Name: string | null;
    createdAt: string;
}

export const worksheetGenerationAPI = {
    generate: async (studentId: string, days: number, startDate: string) => {
        return fetchAPI<{ success: boolean; data: { worksheetIds: string[]; status: string; errors: string[] } }>(
            '/worksheet-generation/generate',
            { method: 'POST', body: JSON.stringify({ studentId, days, startDate }) }
        );
    },

    listForStudent: async (studentId: string) => {
        return fetchAPI<{ success: boolean; data: GeneratedWorksheet[] }>(
            `/worksheet-generation/student/${studentId}`
        );
    }
};
```

**Step 2: Create the generation page**

Create `web-app/app/dashboard/superadmin/mastery/generate/page.tsx`:

This page allows the admin to:
1. Select school → class → student
2. Choose days (1/5/20) and start date
3. Click "Generate"
4. See status of generated worksheets with PDF download links

The page will follow the same filtering patterns as the analytics pages (school → class → student select), then show a generation form and results table.

(Full implementation: standard Next.js page with `useState`, `useEffect`, Select components, Button, Card, Table — following existing patterns from `analytics/students/page.tsx`.)

**Step 3: Add nav link**

In `web-app/app/dashboard/superadmin/layout.tsx`, add after the "Student Mastery" link:

```tsx
<Link href="/dashboard/superadmin/mastery/generate" className="block p-2 rounded hover:bg-gray-100">
    Generate Worksheets
</Link>
```

**Step 4: Verify build + commit**

```bash
cd web-app && npx next build
git add web-app/lib/api/worksheetGeneration.ts web-app/app/dashboard/superadmin/mastery/generate/ web-app/app/dashboard/superadmin/layout.tsx
git commit -m "feat: add worksheet generation UI page"
```

---

## Task 9: End-to-End Verification

**Step 1: Run migration**
```bash
cd backend && npx prisma migrate deploy && npx prisma generate
```

**Step 2: Deploy CF worker**
```bash
cd cloudflare/question-generator && npm install && npx wrangler deploy
```
Set secrets: `npx wrangler secret put BACKEND_WORKER_TOKEN` and `npx wrangler secret put GEMINI_API_KEY`

**Step 3: Set backend env var**
Add `QUESTION_GENERATOR_WORKER_URL=https://question-generator.<your-subdomain>.workers.dev` to backend `.env`

**Step 4: Test question generation**
```bash
curl -X POST http://localhost:5100/internal/question-bank/generate \
  -H "Content-Type: application/json" \
  -H "X-Grading-Worker-Token: <token>" \
  -d '{"mathSkillId": "<any-skill-id>"}'
```
Verify questions appear in QuestionBank table.

**Step 5: Test worksheet generation**
```bash
curl -X POST http://localhost:5100/api/worksheet-generation/generate \
  -H "Authorization: Bearer <admin-token>" \
  -H "Content-Type: application/json" \
  -d '{"studentId": "<student-id>", "days": 1, "startDate": "2026-03-06"}'
```
Verify GeneratedWorksheet row created, PDF rendered, downloadable.

**Step 6: Test UI**
Navigate to `/dashboard/superadmin/mastery/generate`, select a student, generate 1 day, verify PDF download works.
