import { Hono } from 'hono';
import { z } from 'zod';
import { requireWorksheetCreationToken } from '../middleware/workerTokens';
import { validateJson } from '../validation';
import { onWorksheetPdfComplete } from '../adapters/batchProgress';
import { captureGradingPipelineEvent } from '../adapters/posthog';
import { safeWaitUntil } from '../lib/safeWaitUntil';
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
 * Replays fire a PostHog `grading_pipeline.stage=worksheet_pdf_callback_replayed`
 * event so the dashboard captures the CF Queue redelivery rate — the
 * whole point of this fix is to absorb redelivery silently, but we
 * still want to *measure* it so an unexpected spike (e.g., consumer
 * regression) is visible.
 *
 * **First-write wins on `pdfUrl`** — a replay with a different
 * `pdfUrl` value silently drops the second value (the conditional
 * WHERE excludes terminal rows from the update). Consumers that
 * regenerate to a new R2 key on retry MUST treat the first persisted
 * value as authoritative; do not assume `pdfUrl` is the most-recent.
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

    // Transactional bundle: the row transition and the batch-counter
    // increment commit together or roll back together. Without this,
    // a transient failure on `onWorksheetPdfComplete` after the
    // status flip would leave the row terminal forever while the
    // counter stayed short — the idempotency guard above means
    // subsequent retries would find the row already terminal and
    // skip the counter, leaving the batch permanently stuck on
    // `RENDERING_PDFS`. With the transaction, a counter failure
    // rolls the status back to non-terminal, the CF Queue redelivers,
    // and the next attempt re-runs both writes.
    //
    // Conditional UPDATE: only transition non-terminal rows. Atomic at
    // the row level (single SQL statement under Postgres
    // READ COMMITTED). When `count === 0` either the row doesn't
    // exist OR the status was already terminal — differentiate with a
    // follow-up findUnique outside the transaction so legitimate 404s
    // still surface.
    let txResult: { transitioned: boolean };
    try {
      txResult = await prisma.$transaction(async (tx) => {
        const update = await tx.generatedWorksheet.updateMany({
          where: { id, status: { notIn: TERMINAL_STATUSES } },
          data: { pdfUrl, status: 'COMPLETED' },
        });

        if (update.count === 0) {
          return { transitioned: false as const };
        }

        if (batchId) {
          await onWorksheetPdfComplete(tx, batchId, false);
        }
        return { transitioned: true as const };
      });
    } catch (err) {
      // Transaction rolled back. Returning 503 (not 500) so the
      // pdf-renderer Worker's existing retry-token match
      // (`errorMsg.includes('503')`) triggers `message.retry()` on the
      // CF Queue; the next attempt sees the row still non-terminal
      // and retries both writes together. 500 would otherwise fall
      // through to `message.ack()` and the failure would be lost.
      console.error('[ws-gen] /complete transaction failed:', err);
      return c.json({ success: false, error: 'Failed to record completion' }, 503);
    }

    if (!txResult.transitioned) {
      const exists = await prisma.generatedWorksheet.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) {
        return c.json({ success: false, error: 'Worksheet not found' }, 404);
      }
      // Row exists and was already terminal — idempotent replay. Skip
      // the batch counter increment (it fired on the first call) so
      // we don't double-count CF Queue redeliveries. Fire a PostHog
      // event so the redelivery rate is observable on the dashboard.
      await safeWaitUntil(
        c,
        captureGradingPipelineEvent(
          c.env ?? {},
          'worksheet_pdf_callback_replayed',
          id,
          { route: 'complete', batchId: batchId ?? null }
        )
      );
      return c.json({ success: true, idempotent: true }, 200);
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
    //
    // Transactional bundle — same rationale as /complete above. The
    // row transition and the batch-counter increment commit together
    // or roll back together; a transient failure on
    // `onWorksheetPdfComplete` no longer strands the row in a
    // terminal state while the counter stays short.
    let txResult: { transitioned: boolean };
    try {
      txResult = await prisma.$transaction(async (tx) => {
        const update = await tx.generatedWorksheet.updateMany({
          where: { id, status: { notIn: TERMINAL_STATUSES } },
          data: { status: 'FAILED' },
        });

        if (update.count === 0) {
          return { transitioned: false as const };
        }

        if (batchId) {
          await onWorksheetPdfComplete(tx, batchId, true);
        }
        return { transitioned: true as const };
      });
    } catch (err) {
      // 503 so the renderer's retry-token match triggers; see
      // `/complete` for the rationale.
      console.error('[ws-gen] /fail transaction failed:', err);
      return c.json({ success: false, error: 'Failed to record failure' }, 503);
    }

    if (!txResult.transitioned) {
      const exists = await prisma.generatedWorksheet.findUnique({
        where: { id },
        select: { id: true },
      });
      if (!exists) {
        return c.json({ success: false, error: 'Worksheet not found' }, 404);
      }
      await safeWaitUntil(
        c,
        captureGradingPipelineEvent(
          c.env ?? {},
          'worksheet_pdf_callback_replayed',
          id,
          { route: 'fail', batchId: batchId ?? null }
        )
      );
      return c.json({ success: true, idempotent: true }, 200);
    }

    return c.json({ success: true }, 200);
  }
);

export default internalWorksheetGeneration;
