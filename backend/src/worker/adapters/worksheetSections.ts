/**
 * Worksheet section builder + PDF render dispatcher.
 *
 * Ports two tightly-coupled functions from the Express services:
 *
 *   - `services/worksheetGenerationService.buildSections`
 *   - `services/worksheetBatchService.assembleAndEnqueuePdfs`
 *
 * Both read Prisma via the module-level singleton on the Express side; the
 * worker needs them parameterized so we keep the same behavior without
 * touching the original service files. The two are in the same adapter
 * because `assembleAndEnqueuePdfs` is the sole caller of `buildSections`
 * in the PDF-rendering path — splitting them into separate modules would
 * add import friction without cleaning anything up.
 *
 * `assembleAndEnqueuePdfs` talks to the Cloudflare PDF rendering queue
 * via `adapters/queues.publishToQueue`. The queue id comes from
 * `env.PDF_RENDERING_QUEUE_ID` (must be set in `wrangler.toml` before the
 * `/internal/question-bank/*` routes can ship to production).
 */

import { Prisma, type PrismaClient } from '@prisma/client';
import { publishToQueue, QueueError } from './queues';
import type { WorkerEnv } from '../types';

export interface SectionData {
  skillId: string;
  skillName: string;
  instruction: string;
  questions: { question: string; answer: string }[];
}

/**
 * Draw questions from the `QuestionBank` and shape them into the 4-section
 * worksheet layout (new skill split across A + C, review skills in B + D).
 *
 * Matches the Express version exactly:
 *   - Sections ordered [newA, review1, newC, review2]
 *   - `orderBy usedCount asc` so the least-used questions are drawn first
 *   - After a successful draw, `usedCount` is incremented in one updateMany
 *   - Instruction falls back to the first drawn question's `instruction`;
 *     if no questions were drawn, "Solve the following." (matches Express).
 */
export async function buildSections(
  prisma: PrismaClient,
  newSkillId: string,
  review1Id: string,
  review2Id: string
): Promise<SectionData[]> {
  const drawQuestions = async (skillId: string, count: number) => {
    const rows = await prisma.questionBank.findMany({
      where: { mathSkillId: skillId },
      orderBy: { usedCount: 'asc' },
      take: count,
      select: { id: true, question: true, answer: true, instruction: true },
    });
    if (rows.length > 0) {
      await prisma.questionBank.updateMany({
        where: { id: { in: rows.map((q) => q.id) } },
        data: { usedCount: { increment: 1 } },
      });
    }
    return rows;
  };

  const getSkillName = async (skillId: string) => {
    const s = await prisma.mathSkill.findUnique({
      where: { id: skillId },
      select: { name: true },
    });
    return s?.name ?? 'Math';
  };

  const newQuestions = await drawQuestions(newSkillId, 20);
  const newName = await getSkillName(newSkillId);
  const newInstruction = newQuestions[0]?.instruction ?? 'Solve the following.';

  const review1Questions = await drawQuestions(review1Id, 10);
  const review1Name = await getSkillName(review1Id);
  const review1Instruction = review1Questions[0]?.instruction ?? 'Solve the following.';

  const review2Questions = await drawQuestions(review2Id, 10);
  const review2Name = await getSkillName(review2Id);
  const review2Instruction = review2Questions[0]?.instruction ?? 'Solve the following.';

  return [
    {
      skillId: newSkillId,
      skillName: newName,
      instruction: newInstruction,
      questions: newQuestions.slice(0, 10).map((q) => ({
        question: q.question,
        answer: q.answer,
      })),
    },
    {
      skillId: review1Id,
      skillName: review1Name,
      instruction: review1Instruction,
      questions: review1Questions.map((q) => ({
        question: q.question,
        answer: q.answer,
      })),
    },
    {
      skillId: newSkillId,
      skillName: newName,
      instruction: newInstruction,
      questions: newQuestions.slice(10, 20).map((q) => ({
        question: q.question,
        answer: q.answer,
      })),
    },
    {
      skillId: review2Id,
      skillName: review2Name,
      instruction: review2Instruction,
      questions: review2Questions.map((q) => ({
        question: q.question,
        answer: q.answer,
      })),
    },
  ];
}

export interface PdfRenderMessage {
  v: 1;
  worksheetId: string;
  batchId: string;
  enqueuedAt: string;
}

function createPdfRenderMessage(
  worksheetId: string,
  batchId: string
): PdfRenderMessage {
  return {
    v: 1,
    worksheetId,
    batchId,
    enqueuedAt: new Date().toISOString(),
  };
}

export interface AssembleResult {
  assembled: number;
  failed: number;
  errors: string[];
}

/**
 * For each `PENDING` worksheet in a batch, build its sections, persist
 * them on the `GeneratedWorksheet` row, and enqueue a PDF rendering
 * message. On per-worksheet failure, the worksheet is marked `FAILED` and
 * the batch's `failedWorksheets` counter is incremented — the batch as a
 * whole keeps going.
 *
 * Returns a summary the caller can use for logging / PostHog. Errors for
 * individual worksheets are never thrown — they go into the `errors`
 * array so they can be surfaced per-row.
 */
export async function assembleAndEnqueuePdfs(
  prisma: PrismaClient,
  env: WorkerEnv,
  batchId: string
): Promise<AssembleResult> {
  const worksheets = await prisma.generatedWorksheet.findMany({
    where: { batchId, status: 'PENDING' },
  });

  const result: AssembleResult = {
    assembled: 0,
    failed: 0,
    errors: [],
  };

  for (const ws of worksheets) {
    try {
      const sections = await buildSections(
        prisma,
        ws.newSkillId,
        ws.reviewSkill1Id,
        ws.reviewSkill2Id
      );
      await prisma.generatedWorksheet.update({
        where: { id: ws.id },
        data: {
          sectionsJson: sections as unknown as Prisma.InputJsonValue,
          status: 'QUESTIONS_READY',
        },
      });

      const msg = createPdfRenderMessage(ws.id, batchId);
      try {
        await publishToQueue(env, 'PDF_RENDERING_QUEUE_ID', msg);
        result.assembled++;
      } catch (queueErr) {
        // Queue publish failed — don't roll back the `QUESTIONS_READY` row
        // (it is still useful), but surface the error. The dispatch loop
        // can re-enqueue by scanning for `QUESTIONS_READY` rows with no
        // corresponding PDF callback.
        const message =
          queueErr instanceof QueueError
            ? `${queueErr.code}: ${queueErr.message}`
            : queueErr instanceof Error
            ? queueErr.message
            : String(queueErr);
        result.errors.push(`Queue publish failed for ${ws.id}: ${message}`);
      }
    } catch (err) {
      result.failed++;
      const message = err instanceof Error ? err.message : String(err);
      result.errors.push(`Failed to assemble worksheet ${ws.id}: ${message}`);
      await prisma.generatedWorksheet
        .update({
          where: { id: ws.id },
          data: { status: 'FAILED' },
        })
        .catch(() => {
          /* best effort */
        });
      await prisma.worksheetBatch
        .update({
          where: { id: batchId },
          data: { failedWorksheets: { increment: 1 } },
        })
        .catch(() => {
          /* best effort */
        });
    }
  }

  return result;
}
