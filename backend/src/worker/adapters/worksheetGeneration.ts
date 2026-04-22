import { Prisma, type PrismaClient } from '@prisma/client';
import { planWorksheets } from './worksheetScheduler';
import { publishToQueue } from './queues';
import type { WorkerEnv } from '../types';

/**
 * Worksheet generation adapter — port of
 * `backend/src/services/worksheetGenerationService.ts` and
 * `backend/src/services/worksheetBatchService.ts`.
 *
 * Scope matches the Express services except for one deliberate change:
 * `generateWorksheets` used to call `renderBatchPdfs` (puppeteer-based) in
 * a fire-and-forget Promise. That path does not run in Workers (no
 * puppeteer), so we publish each worksheet to the PDF rendering queue
 * instead — the same pattern `createClassBatch` already uses. The CF
 * PDF-rendering worker consumes from that queue and uploads the result.
 */

export interface SectionData {
  skillId: string;
  skillName: string;
  instruction: string;
  questions: { question: string; answer: string }[];
}

export interface GenerationResult {
  worksheetIds: string[];
  status: 'PENDING' | 'COMPLETED' | 'PARTIAL';
  errors: string[];
}

export interface BatchResult {
  batchId: string;
  totalWorksheets: number;
  skillsToGenerate: number;
  errors: string[];
}

interface PdfRenderQueueMessage {
  v: 1;
  worksheetId: string;
  batchId: string;
  enqueuedAt: string;
}

interface QuestionGenQueueMessage {
  v: 1;
  mathSkillId: string;
  skillName: string;
  topicName: string;
  count: number;
  batchId: string;
  enqueuedAt: string;
}

/**
 * Draw questions for a worksheet's 4 sections. Matches the Express
 * implementation: section A+C = new skill (10+10), B = review1 (10),
 * D = review2 (10). Columns/rows in the PDF are the renderer's problem.
 */
export async function buildSections(
  prisma: PrismaClient,
  newSkillId: string,
  review1Id: string,
  review2Id: string
): Promise<SectionData[]> {
  const drawQuestions = async (skillId: string, count: number) => {
    const questions = await prisma.questionBank.findMany({
      where: { mathSkillId: skillId },
      orderBy: { usedCount: 'asc' },
      take: count,
      select: { id: true, question: true, answer: true, instruction: true },
    });

    if (questions.length > 0) {
      await prisma.questionBank.updateMany({
        where: { id: { in: questions.map((q) => q.id) } },
        data: { usedCount: { increment: 1 } },
      });
    }
    return questions;
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
      questions: newQuestions.slice(0, 10).map((q) => ({ question: q.question, answer: q.answer })),
    },
    {
      skillId: review1Id,
      skillName: review1Name,
      instruction: review1Instruction,
      questions: review1Questions.map((q) => ({ question: q.question, answer: q.answer })),
    },
    {
      skillId: newSkillId,
      skillName: newName,
      instruction: newInstruction,
      questions: newQuestions.slice(10, 20).map((q) => ({ question: q.question, answer: q.answer })),
    },
    {
      skillId: review2Id,
      skillName: review2Name,
      instruction: review2Instruction,
      questions: review2Questions.map((q) => ({ question: q.question, answer: q.answer })),
    },
  ];
}

/**
 * Make sure each skill has ≥30 questions in the bank. If not, call the
 * question-gen CF worker synchronously (matches Express behavior for the
 * single-student flow).
 */
async function ensureQuestionsForSkills(
  prisma: PrismaClient,
  env: WorkerEnv,
  skillIds: string[],
  errors: string[]
): Promise<void> {
  for (const skillId of skillIds) {
    const count = await prisma.questionBank.count({ where: { mathSkillId: skillId } });
    if (count >= 30) continue;

    const skill = await prisma.mathSkill.findUnique({
      where: { id: skillId },
      include: { mainTopic: true },
    });
    if (!skill) continue;

    const workerUrl = env.QUESTION_GENERATOR_WORKER_URL;
    if (!workerUrl) {
      errors.push(
        `QUESTION_GENERATOR_WORKER_URL not set, cannot generate for ${skill.name}`
      );
      continue;
    }

    try {
      const response = await fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worksheet-Creation-Token': env.WORKSHEET_CREATION_WORKER_TOKEN ?? '',
        },
        body: JSON.stringify({
          mathSkillId: skill.id,
          skillName: skill.name,
          topicName: skill.mainTopic?.name ?? 'Math',
          count: 30,
        }),
      });
      if (!response.ok) {
        errors.push(`Question generation failed for ${skill.name}: ${response.status}`);
        continue;
      }
      const result = (await response.json()) as {
        success?: boolean;
        questions?: Array<{ question: string; answer: string; instruction: string }>;
        error?: string;
      };
      if (result.success && Array.isArray(result.questions) && result.questions.length > 0) {
        await prisma.questionBank.createMany({
          data: result.questions.map((q) => ({
            mathSkillId: skillId,
            question: q.question,
            answer: q.answer,
            instruction: q.instruction,
          })),
        });
      } else {
        errors.push(
          `No questions returned for ${skill.name}: ${result.error ?? 'empty response'}`
        );
      }
    } catch (err) {
      errors.push(`Question generation error for ${skill.name}: ${String(err)}`);
    }
  }
}

/**
 * Plan + generate GeneratedWorksheet rows for a single student, then
 * enqueue each one for PDF rendering (replaces the Express in-process
 * `renderBatchPdfs(ids)` fire-and-forget). `batchId` on the queue message
 * is left blank — single-student runs aren't part of a batch.
 */
export async function generateWorksheets(
  prisma: PrismaClient,
  env: WorkerEnv,
  studentId: string,
  days: number,
  startDate: Date
): Promise<GenerationResult> {
  const errors: string[] = [];

  const { plans, errors: planErrors } = await planWorksheets(
    prisma,
    studentId,
    days,
    startDate
  );
  errors.push(...planErrors);

  if (plans.length === 0) {
    return { worksheetIds: [], status: 'COMPLETED', errors };
  }

  const skillIds = new Set<string>();
  for (const plan of plans) {
    skillIds.add(plan.newSkillId);
    skillIds.add(plan.reviewSkill1Id);
    skillIds.add(plan.reviewSkill2Id);
  }

  await ensureQuestionsForSkills(prisma, env, Array.from(skillIds), errors);

  const worksheetIds: string[] = [];
  for (const plan of plans) {
    try {
      const sections = await buildSections(
        prisma,
        plan.newSkillId,
        plan.reviewSkill1Id,
        plan.reviewSkill2Id
      );
      const ws = await prisma.generatedWorksheet.create({
        data: {
          studentId,
          scheduledDate: plan.scheduledDate,
          newSkillId: plan.newSkillId,
          reviewSkill1Id: plan.reviewSkill1Id,
          reviewSkill2Id: plan.reviewSkill2Id,
          sectionsJson: sections as unknown as Prisma.InputJsonValue,
          status: 'QUESTIONS_READY',
        },
      });
      worksheetIds.push(ws.id);
    } catch (err) {
      errors.push(
        `Failed to create worksheet for ${plan.scheduledDate.toISOString()}: ${String(err)}`
      );
    }
  }

  // Enqueue PDF rendering for each successfully-created worksheet.
  // Failures to enqueue are non-fatal — the generation itself succeeded;
  // users will see "PDF not ready" until an operator intervenes or the
  // record is retried.
  for (const worksheetId of worksheetIds) {
    const msg: PdfRenderQueueMessage = {
      v: 1,
      worksheetId,
      batchId: '',
      enqueuedAt: new Date().toISOString(),
    };
    try {
      await publishToQueue(env, 'PDF_RENDERING_QUEUE_ID', msg);
    } catch (err) {
      errors.push(`Failed to enqueue PDF render for ${worksheetId}: ${String(err)}`);
    }
  }

  return {
    worksheetIds,
    status: errors.length > 0 ? 'PARTIAL' : 'COMPLETED',
    errors,
  };
}

/**
 * Create a batch of worksheets for an entire class. Enqueues question
 * generation for any skills below threshold; otherwise assembles
 * sections immediately and enqueues PDF rendering for each worksheet.
 */
export async function createClassBatch(
  prisma: PrismaClient,
  env: WorkerEnv,
  classId: string,
  days: number,
  startDate: Date
): Promise<BatchResult> {
  const errors: string[] = [];

  const studentClasses = await prisma.studentClass.findMany({
    where: { classId },
    select: { studentId: true },
  });

  if (studentClasses.length === 0) {
    return {
      batchId: '',
      totalWorksheets: 0,
      skillsToGenerate: 0,
      errors: ['No students in class'],
    };
  }

  const batch = await prisma.worksheetBatch.create({
    data: {
      classId,
      days,
      startDate,
      status: 'PENDING',
      totalWorksheets: 0,
    },
  });

  const allSkillIds = new Set<string>();
  let totalWorksheets = 0;

  for (const { studentId } of studentClasses) {
    const { plans, errors: planErrors } = await planWorksheets(
      prisma,
      studentId,
      days,
      startDate
    );
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
          status: 'PENDING',
        },
      });
      totalWorksheets++;
      allSkillIds.add(plan.newSkillId);
      allSkillIds.add(plan.reviewSkill1Id);
      allSkillIds.add(plan.reviewSkill2Id);
    }
  }

  const skillsNeedingGeneration: { id: string; name: string; topicName: string }[] = [];
  for (const skillId of allSkillIds) {
    const count = await prisma.questionBank.count({ where: { mathSkillId: skillId } });
    if (count >= 30) continue;

    const skill = await prisma.mathSkill.findUnique({
      where: { id: skillId },
      include: { mainTopic: true },
    });
    if (!skill) continue;

    skillsNeedingGeneration.push({
      id: skill.id,
      name: skill.name,
      topicName: skill.mainTopic?.name ?? 'Math',
    });
  }

  await prisma.worksheetBatch.update({
    where: { id: batch.id },
    data: {
      totalWorksheets,
      pendingSkills: skillsNeedingGeneration.length,
      status:
        skillsNeedingGeneration.length > 0 ? 'GENERATING_QUESTIONS' : 'RENDERING_PDFS',
    },
  });

  if (skillsNeedingGeneration.length === 0) {
    await assembleAndEnqueuePdfs(prisma, env, batch.id, errors);
  } else {
    for (const skill of skillsNeedingGeneration) {
      try {
        const msg: QuestionGenQueueMessage = {
          v: 1,
          mathSkillId: skill.id,
          skillName: skill.name,
          topicName: skill.topicName,
          count: 30,
          batchId: batch.id,
          enqueuedAt: new Date().toISOString(),
        };
        await publishToQueue(env, 'QUESTION_GENERATION_QUEUE_ID', msg);
      } catch (err) {
        errors.push(`Failed to enqueue generation for ${skill.name}: ${String(err)}`);
      }
    }
  }

  return {
    batchId: batch.id,
    totalWorksheets,
    skillsToGenerate: skillsNeedingGeneration.length,
    errors,
  };
}

async function assembleAndEnqueuePdfs(
  prisma: PrismaClient,
  env: WorkerEnv,
  batchId: string,
  errors: string[]
): Promise<void> {
  const worksheets = await prisma.generatedWorksheet.findMany({
    where: { batchId, status: 'PENDING' },
  });

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

      const msg: PdfRenderQueueMessage = {
        v: 1,
        worksheetId: ws.id,
        batchId,
        enqueuedAt: new Date().toISOString(),
      };
      await publishToQueue(env, 'PDF_RENDERING_QUEUE_ID', msg);
    } catch (err) {
      console.error(`[batch] Failed to assemble worksheet ${ws.id}:`, err);
      await prisma.generatedWorksheet.update({
        where: { id: ws.id },
        data: { status: 'FAILED' },
      });
      await prisma.worksheetBatch.update({
        where: { id: batchId },
        data: { failedWorksheets: { increment: 1 } },
      });
      errors.push(`Failed to assemble worksheet ${ws.id}: ${String(err)}`);
    }
  }
}
