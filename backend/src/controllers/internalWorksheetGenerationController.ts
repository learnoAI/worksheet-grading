import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { onWorksheetPdfComplete } from '../services/worksheetBatchService';

// Prisma's `notIn` typing wants a mutable array — declaring as a const
// readonly tuple and spreading at call-sites is cleaner than the
// `as unknown as` cast we'd otherwise need.
const TERMINAL_STATUSES = ['COMPLETED', 'FAILED'] as const;
type TerminalStatus = typeof TERMINAL_STATUSES[number];

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
 * `{ success: true, idempotent: true }` so the consumer can ack and the
 * caller can monitor redelivery rate via PostHog.
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
        where: { id, status: { notIn: [...TERMINAL_STATUSES] as TerminalStatus[] } },
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
        // we don't double-count.
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
        where: { id, status: { notIn: [...TERMINAL_STATUSES] as TerminalStatus[] } },
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
