import { Hono } from 'hono';
import { z } from 'zod';
import type { PrismaClient } from '@prisma/client';
import { requireWorksheetCreationToken } from '../middleware/workerTokens';
import { validateJson } from '../validation';
import type { AppBindings } from '../types';

/**
 * Internal worksheet-generation routes — port of
 * `backend/src/routes/internalWorksheetGenerationRoutes.ts`. Authenticated
 * with the shared-secret `X-Worksheet-Creation-Token` header (the PDF
 * renderer CF Worker calls this endpoint to report back).
 *
 * Mounted under `/internal/worksheet-generation`. Three endpoints:
 *   GET  /:id/data       — worksheet content (sectionsJson) for the renderer
 *   POST /:id/complete   — mark rendered + record pdfUrl
 *   POST /:id/fail       — mark rendering failed
 *
 * The Express controller delegates batch progress tracking to
 * `worksheetBatchService.onWorksheetPdfComplete`. That helper is small and
 * pure prisma, so we inline it here rather than introduce a service-layer
 * indirection. The logic is duplicated across Express and Worker during the
 * parallel-run window; both paths call the same tables so they stay
 * consistent. This duplication is tracked as C8 in the migration plan and
 * will be collapsed in Phase 5.10 (service adaptations).
 */

const completeSchema = z.object({
  pdfUrl: z.string().min(1, { message: 'pdfUrl required' }),
  batchId: z.string().optional(),
});

const failSchema = z.object({
  error: z.string().optional(),
  batchId: z.string().optional(),
});

const internalWorksheetGeneration = new Hono<AppBindings>();

internalWorksheetGeneration.use('*', requireWorksheetCreationToken);

internalWorksheetGeneration.get('/:id/data', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

  const id = c.req.param('id');
  const ws = await prisma.generatedWorksheet.findUnique({
    where: { id },
    select: {
      id: true,
      studentId: true,
      batchId: true,
      sectionsJson: true,
      status: true,
    },
  });

  if (!ws) return c.json({ success: false, error: 'Worksheet not found' }, 404);
  return c.json({ success: true, data: ws }, 200);
});

internalWorksheetGeneration.post(
  '/:id/complete',
  validateJson(completeSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

    const id = c.req.param('id');
    const { pdfUrl, batchId } = c.req.valid('json');

    await prisma.generatedWorksheet.update({
      where: { id },
      data: { pdfUrl, status: 'COMPLETED' },
    });

    if (batchId) {
      try {
        await onWorksheetPdfCompleteInline(c.get('prisma')!, batchId, false);
      } catch (err) {
        console.error('[ws-gen] onWorksheetPdfComplete error:', err);
      }
    }

    return c.json({ success: true }, 200);
  }
);

internalWorksheetGeneration.post(
  '/:id/fail',
  validateJson(failSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);

    const id = c.req.param('id');
    const { batchId } = c.req.valid('json');

    await prisma.generatedWorksheet.update({
      where: { id },
      data: { status: 'FAILED' },
    });

    if (batchId) {
      try {
        await onWorksheetPdfCompleteInline(c.get('prisma')!, batchId, true);
      } catch (err) {
        console.error('[ws-gen] onWorksheetPdfComplete error:', err);
      }
    }

    return c.json({ success: true }, 200);
  }
);

/**
 * Inlined copy of `services/worksheetBatchService.onWorksheetPdfComplete`
 * that accepts the caller's prisma client. Keep in sync until Phase 5.10
 * collapses both into a prisma-injected service helper.
 */
async function onWorksheetPdfCompleteInline(
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

export default internalWorksheetGeneration;
