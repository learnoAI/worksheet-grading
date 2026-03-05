import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { generateWorksheets } from '../services/worksheetGenerationService';
import { renderBatchPdfs } from '../services/worksheetPdfService';

/**
 * POST /api/worksheet-generation/generate
 * Body: { studentId, days, startDate }
 */
export async function generate(req: Request, res: Response): Promise<Response> {
    const { studentId, days, startDate } = req.body;

    if (!studentId || !days || !startDate) {
        return res.status(400).json({ success: false, error: 'studentId, days, and startDate required' });
    }

    if (days < 1 || days > 30) {
        return res.status(400).json({ success: false, error: 'days must be 1-30' });
    }

    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student) {
        return res.status(404).json({ success: false, error: 'Student not found' });
    }

    const result = await generateWorksheets(studentId, days, new Date(startDate));

    // Kick off PDF rendering in the background (don't await)
    if (result.worksheetIds.length > 0) {
        renderBatchPdfs(result.worksheetIds).catch(err => {
            console.error('[worksheet-gen] PDF batch render error:', err);
        });
    }

    return res.json({
        success: true,
        data: {
            worksheetIds: result.worksheetIds,
            status: result.status,
            errors: result.errors
        }
    });
}

/**
 * GET /api/worksheet-generation/student/:studentId
 * List generated worksheets for a student.
 */
export async function listForStudent(req: Request, res: Response): Promise<Response> {
    const { studentId } = req.params;

    const worksheets = await prisma.generatedWorksheet.findMany({
        where: { studentId },
        orderBy: { scheduledDate: 'asc' },
        select: {
            id: true,
            scheduledDate: true,
            status: true,
            pdfUrl: true,
            newSkillId: true,
            reviewSkill1Id: true,
            reviewSkill2Id: true,
            createdAt: true
        }
    });

    // Enrich with skill names
    const skillIds = new Set<string>();
    worksheets.forEach(w => {
        skillIds.add(w.newSkillId);
        skillIds.add(w.reviewSkill1Id);
        skillIds.add(w.reviewSkill2Id);
    });

    const skills = await prisma.mathSkill.findMany({
        where: { id: { in: Array.from(skillIds) } },
        select: { id: true, name: true }
    });
    const skillMap = new Map(skills.map(s => [s.id, s.name]));

    return res.json({
        success: true,
        data: worksheets.map(w => ({
            ...w,
            newSkillName: skillMap.get(w.newSkillId) ?? null,
            reviewSkill1Name: skillMap.get(w.reviewSkill1Id) ?? null,
            reviewSkill2Name: skillMap.get(w.reviewSkill2Id) ?? null
        }))
    });
}

/**
 * GET /api/worksheet-generation/:id/pdf
 * Redirect to PDF URL.
 */
export async function getPdf(req: Request, res: Response): Promise<Response | void> {
    const { id } = req.params;

    const ws = await prisma.generatedWorksheet.findUnique({
        where: { id },
        select: { pdfUrl: true, status: true }
    });

    if (!ws) {
        return res.status(404).json({ success: false, error: 'Worksheet not found' });
    }

    if (ws.status !== 'COMPLETED' || !ws.pdfUrl) {
        return res.json({ success: false, status: ws.status, error: 'PDF not ready yet' });
    }

    return res.redirect(ws.pdfUrl);
}
