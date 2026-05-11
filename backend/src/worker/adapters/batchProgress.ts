/**
 * Prisma-injectable copies of the small `worksheetBatchService` helpers
 * that the ported internal worker routes need.
 *
 * The Express version of `worksheetBatchService` reads Prisma from a module
 * singleton and transitively pulls in the whole Cloudflare Queues HTTP
 * client + worksheet generation scheduler. We only need the two progress
 * counters used by the PDF-renderer callbacks, so this adapter re-implements
 * them with the caller's Prisma client. Behavior is kept 1:1 with the
 * Express versions at
 * `backend/src/services/worksheetBatchService.ts#onSkillQuestionsReady` and
 * `#onWorksheetPdfComplete` so both paths can write to the same batch rows
 * during the parallel-run window.
 *
 * Collapsing this duplication is tracked as C8a in the migration plan.
 * Full parity (including `assembleAndEnqueuePdfs` from the other half of
 * the service) lands when `/internal/question-bank/*` routes ship.
 */

import type { PrismaClient } from '@prisma/client';
import { isUniqueConstraintError } from '../lib/prismaErrors';

/**
 * Called by the PDF renderer after a single worksheet PDF is done (or
 * failed). Increments the batch's counter and flips the batch to
 * `COMPLETED` once every worksheet has finished.
 *
 * Exact translation of `worksheetBatchService.onWorksheetPdfComplete`.
 */
export async function onWorksheetPdfComplete(
  prisma: PrismaClient,
  batchId: string,
  failed: boolean
): Promise<void> {
  const updateData = failed
    ? { failedWorksheets: { increment: 1 } }
    : { completedWorksheets: { increment: 1 } };

  const batch = await prisma.worksheetBatch.update({
    where: { id: batchId },
    data: updateData,
  });

  const totalDone = batch.completedWorksheets + batch.failedWorksheets;
  if (totalDone >= batch.totalWorksheets) {
    await prisma.worksheetBatch.update({
      where: { id: batchId },
      data: { status: 'COMPLETED' },
    });
  }
}

/**
 * Called by the question-generator worker after questions for one skill
 * are stored. Increments the batch's `completedSkills` counter and, when
 * every skill in the batch has its questions, flips the batch to
 * `RENDERING_PDFS`.
 *
 * **Idempotent under CF Queue at-least-once delivery.** The
 * question-generator Worker can re-deliver a `/store` message after a
 * successful but un-acked first call (or a transient 5xx). Without a
 * dedup record, every replay double-increments `completedSkills` and
 * the batch flips to `RENDERING_PDFS` while only N-1 skills are actually
 * ready.
 *
 * The dedup insert + counter increment run together inside
 * `prisma.$transaction(...)`. If either step fails, both roll back —
 * critical because otherwise a partial failure (dedup written, counter
 * write timed out) would poison future retries: P2002 would short-
 * circuit them and the counter would be permanently short. The
 * transaction guarantees we either advance the dedup AND the counter,
 * or neither.
 *
 * Intentionally does **not** call `assembleAndEnqueuePdfs` — that helper
 * depends on the worksheet generation + PDF rendering queues and will ship
 * with the full `/internal/question-bank/*` port. The status flip itself
 * is gated on `status: 'GENERATING_QUESTIONS'` via `updateMany` so that
 * if two concurrent first-time-skill writers both observe
 * `completedSkills >= pendingSkills` and race to flip, only one wins
 * (returns `flipped: true`); the other gets `flipped: false` and skips
 * the downstream `assembleAndEnqueuePdfs` so we don't enqueue PDFs twice.
 */
export async function incrementBatchCompletedSkills(
  prisma: PrismaClient,
  batchId: string,
  mathSkillId: string
): Promise<{
  completedSkills: number;
  pendingSkills: number;
  flipped: boolean;
  idempotent: boolean;
}> {
  // 1. Atomic dedup-insert + counter-increment. Either both commit or
  //    both roll back (Postgres transaction). On P2002 inside the
  //    transaction, the rollback is implicit — Prisma surfaces the
  //    constraint error to the outer catch and the transaction is
  //    aborted server-side.
  let batch: { completedSkills: number; pendingSkills: number };
  try {
    batch = await prisma.$transaction(async (tx) => {
      await tx.batchSkillProgress.create({
        data: { batchId, mathSkillId },
      });
      return tx.worksheetBatch.update({
        where: { id: batchId },
        data: { completedSkills: { increment: 1 } },
        select: { completedSkills: true, pendingSkills: true },
      });
    });
  } catch (err) {
    if (isUniqueConstraintError(err)) {
      // Already counted on a prior call (likely CF Queue redelivery).
      // Read current state so the caller can still respond with
      // consistent figures. The batch MUST exist (the dedup row's FK is
      // ON DELETE CASCADE on batch, so a stranded BatchSkillProgress
      // row is impossible) — surface integrity issues rather than
      // hiding them behind `?? 0`.
      const current = await prisma.worksheetBatch.findUnique({
        where: { id: batchId },
        select: { completedSkills: true, pendingSkills: true },
      });
      if (!current) {
        throw new Error(
          `BatchSkillProgress hit P2002 for batch '${batchId}' but the ` +
            `batch row is missing. Integrity violation — FK should ` +
            `prevent this.`
        );
      }
      return {
        completedSkills: current.completedSkills,
        pendingSkills: current.pendingSkills,
        flipped: false,
        idempotent: true,
      };
    }
    throw err;
  }

  if (batch.completedSkills < batch.pendingSkills) {
    return {
      completedSkills: batch.completedSkills,
      pendingSkills: batch.pendingSkills,
      flipped: false,
      idempotent: false,
    };
  }

  // 2. Threshold reached. Race-safe flip: only the first caller whose
  //    increment crossed the threshold wins (count: 1). Concurrent
  //    callers that observed the same post-increment value but raced
  //    to flip will see status already RENDERING_PDFS and get count: 0,
  //    so they skip `assembleAndEnqueuePdfs` downstream.
  const flip = await prisma.worksheetBatch.updateMany({
    where: { id: batchId, status: 'GENERATING_QUESTIONS' },
    data: { status: 'RENDERING_PDFS' },
  });

  return {
    completedSkills: batch.completedSkills,
    pendingSkills: batch.pendingSkills,
    flipped: flip.count > 0,
    idempotent: false,
  };
}
