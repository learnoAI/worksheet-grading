import { Hono } from 'hono';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { capturePosthogException } from '../adapters/posthog';
import {
  generateWorksheets,
  createClassBatch,
} from '../adapters/worksheetGeneration';
import type { AppBindings } from '../types';

/**
 * Worksheet generation routes — port of
 * `backend/src/routes/worksheetGenerationRoutes.ts`
 * (controller: `backend/src/controllers/worksheetGenerationController.ts`).
 *
 * Mounted under `/api/worksheet-generation`. Covers:
 *   POST /generate           — N days of worksheets for a student
 *   POST /generate-class     — batch worksheets for a whole class
 *   GET  /batch/:batchId     — batch progress
 *   GET  /student/:studentId — list generated worksheets with skill names
 *   GET  /:id/pdf            — 302 to the stored PDF (or "not ready")
 *
 * All routes require authentication + TEACHER/ADMIN/SUPERADMIN role,
 * matching the Express middleware chain.
 *
 * Route order: static/literal paths (`/generate`, `/generate-class`,
 * `/batch/...`, `/student/...`) are declared before `/:id/pdf` so the
 * param route doesn't swallow them.
 */
const worksheetGeneration = new Hono<AppBindings>();

worksheetGeneration.use('*', authenticate);
worksheetGeneration.use(
  '*',
  authorize([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN])
);

worksheetGeneration.post('/generate', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'studentId, days, and startDate required' },
      400
    );
  }

  const { studentId, days, startDate } = (body ?? {}) as {
    studentId?: string;
    days?: number;
    startDate?: string;
  };

  if (!studentId || !days || !startDate) {
    return c.json(
      { success: false, error: 'studentId, days, and startDate required' },
      400
    );
  }
  if (days < 1 || days > 30) {
    return c.json({ success: false, error: 'days must be 1-30' }, 400);
  }

  try {
    const student = await prisma.user.findUnique({ where: { id: studentId } });
    if (!student) {
      return c.json({ success: false, error: 'Student not found' }, 404);
    }

    const result = await generateWorksheets(
      prisma,
      c.env ?? {},
      studentId,
      days,
      new Date(startDate)
    );

    return c.json({
      success: true,
      data: {
        worksheetIds: result.worksheetIds,
        status: result.status,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error('[worksheet-generation] generate error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'worksheetGeneration.generate',
    });
    return c.json({ success: false, error: 'Server error' }, 500);
  }
});

worksheetGeneration.post('/generate-class', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      { success: false, error: 'classId, days, and startDate required' },
      400
    );
  }

  const { classId, days, startDate } = (body ?? {}) as {
    classId?: string;
    days?: number;
    startDate?: string;
  };

  if (!classId || !days || !startDate) {
    return c.json(
      { success: false, error: 'classId, days, and startDate required' },
      400
    );
  }
  if (days < 1 || days > 30) {
    return c.json({ success: false, error: 'days must be 1-30' }, 400);
  }

  try {
    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) {
      return c.json({ success: false, error: 'Class not found' }, 404);
    }

    const result = await createClassBatch(
      prisma,
      c.env ?? {},
      classId,
      days,
      new Date(startDate)
    );

    return c.json({
      success: true,
      data: {
        batchId: result.batchId,
        totalWorksheets: result.totalWorksheets,
        skillsToGenerate: result.skillsToGenerate,
        errors: result.errors,
      },
    });
  } catch (error) {
    console.error('[worksheet-generation] generateClass error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'worksheetGeneration.generateClass',
    });
    return c.json({ success: false, error: 'Server error' }, 500);
  }
});

worksheetGeneration.get('/batch/:batchId', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const batchId = c.req.param('batchId');
  try {
    const batch = await prisma.worksheetBatch.findUnique({
      where: { id: batchId },
    });
    if (!batch) {
      return c.json({ success: false, error: 'Batch not found' }, 404);
    }
    return c.json({ success: true, data: batch });
  } catch (error) {
    console.error('[worksheet-generation] getBatchStatus error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'worksheetGeneration.getBatchStatus',
    });
    return c.json({ success: false, error: 'Server error' }, 500);
  }
});

worksheetGeneration.get('/student/:studentId', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const studentId = c.req.param('studentId');
  try {
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
        createdAt: true,
      },
    });

    const skillIds = new Set<string>();
    for (const w of worksheets) {
      skillIds.add(w.newSkillId);
      skillIds.add(w.reviewSkill1Id);
      skillIds.add(w.reviewSkill2Id);
    }

    const skills = await prisma.mathSkill.findMany({
      where: { id: { in: Array.from(skillIds) } },
      select: { id: true, name: true },
    });
    const skillMap = new Map(skills.map((s) => [s.id, s.name]));

    return c.json({
      success: true,
      data: worksheets.map((w) => ({
        ...w,
        newSkillName: skillMap.get(w.newSkillId) ?? null,
        reviewSkill1Name: skillMap.get(w.reviewSkill1Id) ?? null,
        reviewSkill2Name: skillMap.get(w.reviewSkill2Id) ?? null,
      })),
    });
  } catch (error) {
    console.error('[worksheet-generation] listForStudent error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'worksheetGeneration.listForStudent',
    });
    return c.json({ success: false, error: 'Server error' }, 500);
  }
});

worksheetGeneration.get('/:id/pdf', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const ws = await prisma.generatedWorksheet.findUnique({
      where: { id },
      select: { pdfUrl: true, status: true },
    });

    if (!ws) {
      return c.json({ success: false, error: 'Worksheet not found' }, 404);
    }

    if (ws.status !== 'COMPLETED' || !ws.pdfUrl) {
      return c.json({
        success: false,
        status: ws.status,
        error: 'PDF not ready yet',
      });
    }

    return c.redirect(ws.pdfUrl, 302);
  } catch (error) {
    console.error('[worksheet-generation] getPdf error:', error);
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: user.userId,
      stage: 'worksheetGeneration.getPdf',
    });
    return c.json({ success: false, error: 'Server error' }, 500);
  }
});

export default worksheetGeneration;
