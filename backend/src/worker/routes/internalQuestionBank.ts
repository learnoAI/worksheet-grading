import { Hono } from 'hono';
import { z } from 'zod';
import { requireWorksheetCreationToken } from '../middleware/workerTokens';
import { validateJson } from '../validation';
import { incrementBatchCompletedSkills } from '../adapters/batchProgress';
import { assembleAndEnqueuePdfs } from '../adapters/worksheetSections';
import { capturePosthogException } from '../adapters/posthog';
import type { AppBindings } from '../types';

/**
 * Internal question-bank routes — port of
 * `backend/src/routes/internalQuestionBankRoutes.ts`. Authenticated via
 * the shared-secret `X-Worksheet-Creation-Token` header: the CF
 * question-generator Worker uses these endpoints to deposit questions
 * back into the system, and the `/generate` endpoint kicks off a new
 * generation run.
 *
 * Mounted at `/internal/question-bank`. Two endpoints:
 *   POST /store    — insert questions, trigger batch progress
 *   POST /generate — call the CF question-gen worker, insert results
 *
 * The batch-progress trigger chain (question arrival → completedSkills
 * increment → batch status flip → PDF rendering) uses the
 * `batchProgress` + `worksheetSections` adapters so both the Hono worker
 * and the original Express service file run identical code paths
 * against the same database during the parallel-run window.
 */

const storeQuestionsSchema = z.object({
  mathSkillId: z.string().min(1),
  questions: z
    .array(
      z.object({
        question: z.string(),
        answer: z.string(),
        instruction: z.string().optional(),
      })
    )
    .min(1, { message: 'questions[] must not be empty' }),
  batchId: z.string().optional(),
});

const generateQuestionsSchema = z.object({
  mathSkillId: z.string().min(1, { message: 'mathSkillId is required' }),
  count: z.number().int().positive().optional(),
});

const internalQuestionBank = new Hono<AppBindings>();

internalQuestionBank.use('*', requireWorksheetCreationToken);

/**
 * `POST /internal/question-bank/store`
 *
 * The question-generator CF Worker posts newly-minted questions here.
 * When a `batchId` is provided, we increment the batch's completedSkills
 * counter — if that increment closes the batch, kick off PDF assembly
 * for every PENDING worksheet in it. Failures during assembly are
 * logged but never bubble up; the response always 200s when the
 * questions themselves were stored successfully.
 */
internalQuestionBank.post(
  '/store',
  validateJson(storeQuestionsSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

    const { mathSkillId, questions, batchId } = c.req.valid('json');

    try {
      const created = await prisma.questionBank.createMany({
        data: questions.map((q) => ({
          mathSkillId,
          question: q.question,
          answer: q.answer,
          instruction: q.instruction,
        })),
      });

      if (batchId) {
        try {
          const progress = await incrementBatchCompletedSkills(prisma, batchId);
          if (progress.flipped) {
            // All skills ready — assemble PDFs for worksheets in this batch.
            const assembleResult = await assembleAndEnqueuePdfs(prisma, c.env ?? {}, batchId);
            if (assembleResult.errors.length > 0) {
              console.error(
                '[question-bank] assembleAndEnqueuePdfs errors:',
                assembleResult.errors
              );
            }
          }
        } catch (err) {
          console.error('[question-bank] batch progress error:', err);
          await capturePosthogException(c.env ?? {}, err, {
            distinctId: batchId,
            stage: 'question_bank_batch_progress',
            extra: { batchId, mathSkillId },
          });
        }
      }

      return c.json({ success: true, stored: created.count }, 200);
    } catch (error) {
      console.error('[question-bank-store]', error);
      await capturePosthogException(c.env ?? {}, error, {
        distinctId: batchId ?? mathSkillId,
        stage: 'question_bank_store',
        extra: { batchId, mathSkillId },
      });
      return c.json({ success: false, error: 'Failed to store questions' }, 500);
    }
  }
);

/**
 * `POST /internal/question-bank/generate`
 *
 * Calls the question-generator CF Worker synchronously, waits for its
 * response, and persists whatever questions come back. This is the
 * "backfill on demand" path used by admin tools — the primary path is
 * the async generation pipeline that ends in `POST /store` above.
 */
internalQuestionBank.post(
  '/generate',
  validateJson(generateQuestionsSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

    const { mathSkillId, count } = c.req.valid('json');

    const skill = await prisma.mathSkill.findUnique({
      where: { id: mathSkillId },
      include: { mainTopic: true },
    });
    if (!skill) {
      return c.json({ success: false, error: 'Skill not found' }, 404);
    }

    const workerUrl = c.env?.QUESTION_GENERATOR_WORKER_URL;
    if (!workerUrl) {
      return c.json(
        {
          success: false,
          error: 'QUESTION_GENERATOR_WORKER_URL not configured',
        },
        500
      );
    }

    try {
      const response = await fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Worksheet-Creation-Token': c.env?.WORKSHEET_CREATION_WORKER_TOKEN ?? '',
        },
        body: JSON.stringify({
          mathSkillId: skill.id,
          skillName: skill.name,
          topicName: skill.mainTopic?.name ?? 'Math',
          count: count ?? 30,
        }),
      });

      if (!response.ok) {
        const text = await response.text().catch(() => '');
        return c.json(
          { success: false, error: `Worker error: ${response.status} ${text}` },
          502
        );
      }

      const result = (await response.json()) as {
        success?: boolean;
        questions?: Array<{ question: string; answer: string; instruction?: string }>;
        error?: string;
      };

      if (result.success && Array.isArray(result.questions)) {
        const created = await prisma.questionBank.createMany({
          data: result.questions.map((q) => ({
            mathSkillId,
            question: q.question,
            answer: q.answer,
            instruction: q.instruction,
          })),
        });
        return c.json({ success: true, stored: created.count }, 200);
      }

      return c.json(
        { success: false, error: result.error ?? 'No questions returned' },
        502
      );
    } catch (err) {
      console.error('[question-bank-generate]', err);
      await capturePosthogException(c.env ?? {}, err, {
        distinctId: mathSkillId,
        stage: 'question_bank_generate',
        extra: { mathSkillId },
      });
      const message = err instanceof Error ? err.message : 'Unknown error';
      return c.json({ success: false, error: message }, 500);
    }
  }
);

export default internalQuestionBank;
