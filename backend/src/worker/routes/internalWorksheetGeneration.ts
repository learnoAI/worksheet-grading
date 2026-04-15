import { Hono } from 'hono';
import { z } from 'zod';
import { requireWorksheetCreationToken } from '../middleware/workerTokens';
import { validateJson } from '../validation';
import { onWorksheetPdfComplete } from '../adapters/batchProgress';
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
 * Batch progress tracking goes through `adapters/batchProgress`, a
 * prisma-injected copy of the matching helper in `worksheetBatchService`.
 * Express and Worker paths write to the same `WorksheetBatch` rows so
 * progress stays consistent during the parallel-run window.
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
        await onWorksheetPdfComplete(c.get('prisma')!, batchId, false);
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
        await onWorksheetPdfComplete(c.get('prisma')!, batchId, true);
      } catch (err) {
        console.error('[ws-gen] onWorksheetPdfComplete error:', err);
      }
    }

    return c.json({ success: true }, 200);
  }
);

export default internalWorksheetGeneration;
