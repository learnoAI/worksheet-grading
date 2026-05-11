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
 * Both /complete and /fail are idempotent under CF Queue at-least-once
 * redelivery — conditional updateMany on a non-terminal status guard
 * ensures every replay returns `{ success: true, idempotent: true }` and
 * skips the WorksheetBatch counter increment. See the matching Express
 * controller at `internalWorksheetGenerationController.ts` for the full
 * rationale + cross-runtime invariants.
 *
 * Batch progress tracking goes through `adapters/batchProgress`, a
 * prisma-injected copy of the matching helper in `worksheetBatchService`.
 * Express and Worker paths write to the same `WorksheetBatch` rows so
 * progress stays consistent during the parallel-run window.
 */

// Status values considered terminal — replays for rows in these states
// no-op idempotently. Mirrors the Express controller constant.
const TERMINAL_STATUSES: ('COMPLETED' | 'FAILED')[] = ['COMPLETED', 'FAILED'];

// `batchId` uses `.nullish()` (string | null | undefined) because the
// pdf-renderer Worker types it as `string | null` and serializes JSON `null`
// when a worksheet has no batch (single-render flow). The Express route
// tolerated `null` via permissive manual parsing; matching that here.
const completeSchema = z.object({
  pdfUrl: z.string().min(1, { message: 'pdfUrl required' }),
  batchId: z.string().nullish(),
});

const failSchema = z.object({
  error: z.string().optional(),
  batchId: z.string().nullish(),
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

    // Conditional UPDATE: only transition non-terminal rows. Atomic at
    // the row level (single SQL statement). When `count === 0` either
    // the row doesn't exist OR the status was already terminal —
    // differentiate with a follow-up findUnique so legitimate 404s
    // still surface.
    const result = await prisma.generatedWorksheet.updateMany({
      where: { id, status: { notIn: TERMINAL_STATUSES } },
      data: { pdfUrl, status: 'COMPLETED' },
    });

    if (result.count === 0) {
      const exists = await prisma.generatedWorksheet.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) {
        return c.json({ success: false, error: 'Worksheet not found' }, 404);
      }
      // Row exists and was already terminal — idempotent replay. Skip
      // the batch counter increment (it fired on the first call) so
      // we don't double-count CF Queue redeliveries.
      return c.json({ success: true, idempotent: true }, 200);
    }

    // First-time transition only — fire side effects.
    if (batchId) {
      try {
        await onWorksheetPdfComplete(prisma, batchId, false);
      } catch (err) {
        // Pre-existing leak: see matching comment in the Express
        // controller. Out of scope for the idempotency fix.
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

    // Idempotent — first-write wins. /fail after a successful /complete
    // returns idempotent without incrementing failedWorksheets, so a
    // consumer that mis-recovers from a transient 503 on /complete by
    // calling /fail cannot corrupt the batch counter.
    const result = await prisma.generatedWorksheet.updateMany({
      where: { id, status: { notIn: TERMINAL_STATUSES } },
      data: { status: 'FAILED' },
    });

    if (result.count === 0) {
      const exists = await prisma.generatedWorksheet.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) {
        return c.json({ success: false, error: 'Worksheet not found' }, 404);
      }
      return c.json({ success: true, idempotent: true }, 200);
    }

    if (batchId) {
      try {
        await onWorksheetPdfComplete(prisma, batchId, true);
      } catch (err) {
        console.error('[ws-gen] onWorksheetPdfComplete error:', err);
      }
    }

    return c.json({ success: true }, 200);
  }
);

export default internalWorksheetGeneration;
