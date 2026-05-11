import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { onWorksheetPdfComplete } from '../services/worksheetBatchService';

// Statuses considered terminal — replays of /complete or /fail on rows
// in these states no-op idempotently. Same shape as the matching
// constant in `backend/src/worker/routes/internalWorksheetGeneration.ts`.
const TERMINAL_STATUSES: ('COMPLETED' | 'FAILED')[] = ['COMPLETED', 'FAILED'];

/**
 * GET /internal/worksheet-generation/:id/data
 * Returns worksheet sectionsJson for PDF rendering worker.
 */
export async function getWorksheetData(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;

    const ws = await prisma.generatedWorksheet.findUnique({
        where: { id },
        select: {
            id: true,
            studentId: true,
            batchId: true,
            sectionsJson: true,
            status: true
        }
    });

    if (!ws) {
        return res.status(404).json({ success: false, error: 'Worksheet not found' });
    }

    return res.json({ success: true, data: ws });
}

/**
 * POST /internal/worksheet-generation/:id/complete
 * Called by PDF renderer worker after successful rendering.
 * Body: { pdfUrl, batchId? }
 *
 * Idempotent under CF Queue at-least-once redelivery. The PDF-renderer
 * CF Worker can deliver the same message multiple times (puppeteer is
 * slow → wall-clock limit can expire after a successful /complete but
 * before `message.ack()` registers; CF Queue also documents that
 * successful messages may be redelivered). Without a status guard, every
 * replay double-increments `WorksheetBatch.completedWorksheets` and
 * can flip the batch to `COMPLETED` before all worksheets are done.
 *
 * Replays of an already-terminal worksheet return
 * `{ success: true, idempotent: true }` and log a structured warning
 * for redelivery-rate monitoring (oncall can grep `wrangler tail` /
 * app_logs on `[ws-gen] idempotent replay`; the worker mirror also
 * fires a PostHog `worksheet_pdf_callback_replayed` event for the
 * dashboard).
 *
 * **First-write wins on `pdfUrl`** — a replay with a different
 * `pdfUrl` value silently drops the second value (the conditional
 * WHERE excludes terminal rows from the update). Consumers that
 * regenerate to a new R2 key on retry MUST treat the first persisted
 * value as authoritative; do not assume `pdfUrl` is the most-recent.
 */
export async function completeWorksheet(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const { pdfUrl, batchId } = req.body;

    if (!pdfUrl) {
        return res.status(400).json({ success: false, error: 'pdfUrl required' });
    }

    // Conditional UPDATE: only transition non-terminal rows. Atomic at
    // the row level (single SQL statement, no TOCTOU between read +
    // update). When `count === 0` either the row doesn't exist OR the
    // status was already terminal — differentiate with a follow-up
    // findUnique so legitimate 404s still surface.
    const result = await prisma.generatedWorksheet.updateMany({
        where: { id, status: { notIn: TERMINAL_STATUSES } },
        data: { pdfUrl, status: 'COMPLETED' }
    });

    if (result.count === 0) {
        const exists = await prisma.generatedWorksheet.findUnique({
            where: { id },
            select: { id: true }
        });
        if (!exists) {
            return res.status(404).json({ success: false, error: 'Worksheet not found' });
        }
        // Row exists and was already terminal — idempotent replay. Skip
        // the batch counter increment (it fired on the first call) so
        // we don't double-count. The structured log is the
        // observability signal for CF Queue redelivery rate; the worker
        // mirror fires a PostHog event for the dashboard.
        console.warn('[ws-gen] idempotent replay', {
            id,
            route: 'complete',
            batchId: batchId ?? null,
        });
        return res.json({ success: true, idempotent: true });
    }

    // First-time transition only — fire side effects.
    if (batchId) {
        try {
            await onWorksheetPdfComplete(batchId, false);
        } catch (err) {
            // Pre-existing leak: if this throws, the row is COMPLETED
            // but the batch counter never increments and won't on retry
            // (the conditional update above will be a no-op next time).
            // The original code had the same behaviour — out of scope
            // for the idempotency fix; addressing it would require a
            // transactional bundle of the worksheet update + counter.
            console.error(`[ws-gen] onWorksheetPdfComplete error:`, err);
        }
    }

    return res.json({ success: true });
}

/**
 * POST /internal/worksheet-generation/:id/fail
 * Called by PDF renderer worker on failure.
 * Body: { error, batchId? }
 *
 * Idempotent — see `completeWorksheet`. First-write wins: a `/fail`
 * after a `/complete` (or vice versa) is a no-op idempotent return,
 * so a consumer that mis-recovers from a transient 503 by calling
 * `/fail` after `/complete` succeeded server-side cannot corrupt the
 * batch counters.
 */
export async function failWorksheet(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const { batchId } = req.body;

    const result = await prisma.generatedWorksheet.updateMany({
        where: { id, status: { notIn: TERMINAL_STATUSES } },
        data: { status: 'FAILED' }
    });

    if (result.count === 0) {
        const exists = await prisma.generatedWorksheet.findUnique({
            where: { id },
            select: { id: true }
        });
        if (!exists) {
            return res.status(404).json({ success: false, error: 'Worksheet not found' });
        }
        console.warn('[ws-gen] idempotent replay', {
            id,
            route: 'fail',
            batchId: batchId ?? null,
        });
        return res.json({ success: true, idempotent: true });
    }

    if (batchId) {
        try {
            await onWorksheetPdfComplete(batchId, true);
        } catch (err) {
            console.error(`[ws-gen] onWorksheetPdfComplete error:`, err);
        }
    }

    return res.json({ success: true });
}
