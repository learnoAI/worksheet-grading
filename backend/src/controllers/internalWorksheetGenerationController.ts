import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { onWorksheetPdfComplete } from '../services/worksheetBatchService';

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
 */
export async function completeWorksheet(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const { pdfUrl, batchId } = req.body;

    if (!pdfUrl) {
        return res.status(400).json({ success: false, error: 'pdfUrl required' });
    }

    await prisma.generatedWorksheet.update({
        where: { id },
        data: { pdfUrl, status: 'COMPLETED' }
    });

    if (batchId) {
        try {
            await onWorksheetPdfComplete(batchId, false);
        } catch (err) {
            console.error(`[ws-gen] onWorksheetPdfComplete error:`, err);
        }
    }

    return res.json({ success: true });
}

/**
 * POST /internal/worksheet-generation/:id/fail
 * Called by PDF renderer worker on failure.
 * Body: { error, batchId? }
 */
export async function failWorksheet(req: Request, res: Response): Promise<Response> {
    const { id } = req.params;
    const { batchId } = req.body;

    await prisma.generatedWorksheet.update({
        where: { id },
        data: { status: 'FAILED' }
    });

    if (batchId) {
        try {
            await onWorksheetPdfComplete(batchId, true);
        } catch (err) {
            console.error(`[ws-gen] onWorksheetPdfComplete error:`, err);
        }
    }

    return res.json({ success: true });
}
