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
 * Intentionally does **not** call `assembleAndEnqueuePdfs` — that helper
 * depends on the worksheet generation + PDF rendering queues and will ship
 * with the full `/internal/question-bank/*` port. Callers must run the
 * follow-up step themselves (or, for now, leave batches stuck on
 * `RENDERING_PDFS` until the Express dispatch loop picks them up).
 */
export async function incrementBatchCompletedSkills(
  prisma: PrismaClient,
  batchId: string
): Promise<{ completedSkills: number; pendingSkills: number; flipped: boolean }> {
  const batch = await prisma.worksheetBatch.update({
    where: { id: batchId },
    data: { completedSkills: { increment: 1 } },
  });

  if (batch.completedSkills < batch.pendingSkills) {
    return {
      completedSkills: batch.completedSkills,
      pendingSkills: batch.pendingSkills,
      flipped: false,
    };
  }

  await prisma.worksheetBatch.update({
    where: { id: batchId },
    data: { status: 'RENDERING_PDFS' },
  });

  return {
    completedSkills: batch.completedSkills,
    pendingSkills: batch.pendingSkills,
    flipped: true,
  };
}
