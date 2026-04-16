import { Hono } from 'hono';
import { ProcessingStatus, UserRole, Prisma, GradingJobStatus } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { validateQuery, validateJson } from '../validation';
import { callPython } from '../adapters/pythonApi';
import {
  findWorksheetQuerySchema,
  historyQuerySchema,
  gradeWorksheetSchema,
  updateAdminCommentsSchema,
  checkRepeatedSchema,
  batchSaveSchema,
  pythonImagesSchema,
  pythonGradingDetailsSchema,
  totalAiGradedSchema,
} from '../schemas/worksheets';
import type { AppBindings } from '../types';

function parseDateInputToUtcStart(dateInput: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (dateOnly) {
    return new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]), 0, 0, 0, 0));
  }
  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCHours(0, 0, 0, 0);
  return parsed;
}

function parseDateInputToUtcEndExclusive(dateInput: string): Date | null {
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateInput);
  if (dateOnly) {
    return new Date(Date.UTC(Number(dateOnly[1]), Number(dateOnly[2]) - 1, Number(dateOnly[3]) + 1, 0, 0, 0, 0));
  }
  const parsed = new Date(dateInput);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCHours(0, 0, 0, 0);
  parsed.setUTCDate(parsed.getUTCDate() + 1);
  return parsed;
}

/**
 * Worksheet routes — port of `backend/src/routes/worksheetRoutes.ts`.
 *
 * Mounted under `/api/worksheets`. This file ships the simpler CRUD and
 * query endpoints. Complex endpoints (class-date summary with fallback
 * recommendation chain, incorrect-grading review, Python-API utilities,
 * batch save, and the Multer upload) stay on Express until their service
 * dependencies are available here — tracked in the migration plan.
 *
 * Route order matters: literal paths (`/find`, `/find-all`, `/history`,
 * `/templates`) go before `/:id` so they are not swallowed by the dynamic
 * param. Static sub-paths (`/class/:classId`, `/student/:studentId`,
 * `/teacher/:teacherId/classes`, `/class/:classId/students`) likewise
 * declared above the single-segment `/:id`.
 */
const worksheets = new Hono<AppBindings>();

worksheets.use('*', authenticate);

const authoringRoles = [UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN];
const requireAuthoringRole = authorize(authoringRoles);

const WORKSHEET_LIST_INCLUDE = {
  submittedBy: { select: { id: true, username: true, role: true } },
  class: { select: { id: true, name: true } },
  images: true,
} as const;

worksheets.get(
  '/find',
  requireAuthoringRole,
  validateQuery(findWorksheetQuerySchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const { classId, studentId, startDate, endDate } = c.req.valid('query');
    try {
      const worksheet = await prisma.worksheet.findFirst({
        where: {
          classId,
          studentId,
          submittedOn: { gte: new Date(startDate), lt: new Date(endDate) },
        },
        include: {
          submittedBy: { select: { id: true, username: true, role: true } },
          class: { select: { id: true, name: true } },
          template: true,
        },
      });
      return c.json(worksheet, 200);
    } catch (error) {
      console.error('Find worksheet error:', error);
      return c.json({ message: 'Server error while finding worksheet' }, 500);
    }
  }
);

worksheets.get(
  '/find-all',
  requireAuthoringRole,
  validateQuery(findWorksheetQuerySchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const { classId, studentId, startDate, endDate } = c.req.valid('query');
    try {
      const rows = await prisma.worksheet.findMany({
        where: {
          classId,
          studentId,
          submittedOn: { gte: new Date(startDate), lt: new Date(endDate) },
        },
        include: {
          submittedBy: { select: { id: true, username: true, role: true } },
          class: { select: { id: true, name: true } },
          template: true,
          images: { orderBy: { pageNumber: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      });
      return c.json(rows, 200);
    } catch (error) {
      console.error('Find all worksheets error:', error);
      return c.json({ message: 'Server error while finding worksheets' }, 500);
    }
  }
);

worksheets.get(
  '/history',
  requireAuthoringRole,
  validateQuery(historyQuerySchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);
    const { classId, studentId, endDate } = c.req.valid('query');

    try {
      const endDateObj = new Date(endDate);
      const isFuture = endDateObj > new Date();
      const rows = await prisma.worksheet.findMany({
        where: {
          classId,
          studentId,
          ...(isFuture ? {} : { submittedOn: { lt: endDateObj } }),
          status: ProcessingStatus.COMPLETED,
        },
        include: { template: true },
        orderBy: { submittedOn: 'desc' },
      });
      return c.json(rows, 200);
    } catch (error) {
      console.error('Get previous worksheets error:', error);
      return c.json({ message: 'Server error while retrieving previous worksheets' }, 500);
    }
  }
);

worksheets.get('/templates', requireAuthoringRole, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const rows = await prisma.worksheetTemplate.findMany({
    select: { id: true, worksheetNumber: true },
    orderBy: { worksheetNumber: 'asc' },
  });
  return c.json(rows, 200);
});

worksheets.get('/class/:classId/students', requireAuthoringRole, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const classId = c.req.param('classId');
  const rows = await prisma.studentClass.findMany({
    where: { classId, student: { isArchived: false } },
    include: {
      student: {
        select: { id: true, username: true, name: true, tokenNumber: true },
      },
    },
  });
  return c.json(
    rows.map((sc) => ({
      id: sc.student.id,
      username: sc.student.username,
      name: sc.student.name,
      tokenNumber: sc.student.tokenNumber,
    })),
    200
  );
});

worksheets.get('/class/:classId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const classId = c.req.param('classId');
  try {
    const rows = await prisma.worksheet.findMany({
      where: { classId },
      include: WORKSHEET_LIST_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Get worksheets by class error:', error);
    return c.json({ message: 'Server error while retrieving worksheets' }, 500);
  }
});

worksheets.get('/student/:studentId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const studentId = c.req.param('studentId');
  try {
    const student = await prisma.user.findFirst({
      where: { id: studentId, role: 'STUDENT' },
    });
    if (!student) return c.json({ message: 'Student not found' }, 404);

    const rows = await prisma.worksheet.findMany({
      where: { studentId },
      include: {
        ...WORKSHEET_LIST_INCLUDE,
        template: { select: { id: true, worksheetNumber: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Get worksheets by student error:', error);
    return c.json({ message: 'Server error while retrieving worksheets' }, 500);
  }
});

worksheets.get('/teacher/:teacherId/classes', requireAuthoringRole, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const teacherId = c.req.param('teacherId');
  const rows = await prisma.teacherClass.findMany({
    where: { teacherId, class: { isArchived: false } },
    include: { class: { include: { school: true } } },
  });
  return c.json(
    rows.map((tc) => ({
      id: tc.class.id,
      name: `${tc.class.school.name} - ${tc.class.name}`,
    })),
    200
  );
});

worksheets.get('/:id', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const id = c.req.param('id');
  try {
    const row = await prisma.worksheet.findUnique({
      where: { id },
      include: {
        ...WORKSHEET_LIST_INCLUDE,
        template: { select: { id: true, worksheetNumber: true } },
      },
    });
    if (!row) return c.json({ message: 'Worksheet not found' }, 404);
    return c.json(row, 200);
  } catch (error) {
    console.error('Get worksheet by ID error:', error);
    return c.json({ message: 'Server error while retrieving worksheet' }, 500);
  }
});

// ---------- Mutations ----------

const requireSuperadmin = authorize([UserRole.SUPERADMIN]);

worksheets.post(
  '/grade',
  requireAuthoringRole,
  validateJson(gradeWorksheetSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const body = c.req.valid('json');
    const user = c.get('user')!;
    const submittedById = user.userId;

    const submittedOnDate = body.submittedOn ? new Date(body.submittedOn) : new Date();
    submittedOnDate.setUTCHours(0, 0, 0, 0);

    try {
      if (body.isAbsent) {
        const row = await prisma.worksheet.upsert({
          where: {
            unique_worksheet_per_student_day: {
              studentId: body.studentId,
              classId: body.classId,
              worksheetNumber: 0,
              submittedOn: submittedOnDate,
            },
          },
          update: {
            grade: 0,
            notes: body.notes || 'Student absent',
            status: ProcessingStatus.COMPLETED,
            isAbsent: true,
            worksheetNumber: 0,
          },
          create: {
            classId: body.classId,
            studentId: body.studentId,
            submittedById,
            worksheetNumber: 0,
            grade: 0,
            notes: body.notes || 'Student absent',
            status: ProcessingStatus.COMPLETED,
            outOf: 40,
            submittedOn: submittedOnDate,
            isAbsent: true,
            isRepeated: false,
            isIncorrectGrade: false,
          },
        });
        return c.json(row, 201);
      }

      const worksheetNum = Number(body.worksheetNumber);
      if (!Number.isFinite(worksheetNum) || worksheetNum <= 0) {
        return c.json(
          { message: 'Valid worksheet number is required for non-absent students' },
          400
        );
      }
      const gradeValue = Number(body.grade);
      if (!Number.isFinite(gradeValue) || gradeValue < 0 || gradeValue > 40) {
        return c.json(
          { message: 'Valid grade between 0 and 40 is required for non-absent students' },
          400
        );
      }

      const template = await prisma.worksheetTemplate.findFirst({
        where: { worksheetNumber: worksheetNum },
      });

      const row = await prisma.worksheet.upsert({
        where: {
          unique_worksheet_per_student_day: {
            studentId: body.studentId,
            classId: body.classId,
            worksheetNumber: worksheetNum,
            submittedOn: submittedOnDate,
          },
        },
        update: {
          grade: gradeValue,
          notes: body.notes ?? undefined,
          status: ProcessingStatus.COMPLETED,
          isIncorrectGrade: body.isIncorrectGrade ?? false,
          isRepeated: body.isRepeated ?? false,
          gradingDetails:
            body.gradingDetails === undefined
              ? undefined
              : (body.gradingDetails as Prisma.InputJsonValue) || Prisma.DbNull,
          wrongQuestionNumbers: body.wrongQuestionNumbers ?? null,
          worksheetNumber: worksheetNum,
        },
        create: {
          classId: body.classId,
          studentId: body.studentId,
          submittedById,
          templateId: template?.id,
          worksheetNumber: worksheetNum,
          grade: gradeValue,
          notes: body.notes ?? undefined,
          status: ProcessingStatus.COMPLETED,
          outOf: 40,
          submittedOn: submittedOnDate,
          isAbsent: false,
          isRepeated: body.isRepeated ?? false,
          isIncorrectGrade: body.isIncorrectGrade ?? false,
          gradingDetails:
            body.gradingDetails === undefined
              ? undefined
              : (body.gradingDetails as Prisma.InputJsonValue) || Prisma.DbNull,
          wrongQuestionNumbers: body.wrongQuestionNumbers ?? null,
        },
      });
      return c.json(row, 201);
    } catch (error) {
      console.error('Create graded worksheet error:', error);
      return c.json({ message: 'Server error while creating worksheet' }, 500);
    }
  }
);

worksheets.put(
  '/grade/:id',
  requireAuthoringRole,
  validateJson(gradeWorksheetSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const id = c.req.param('id');
    const body = c.req.valid('json');
    const user = c.get('user')!;
    const submittedById = user.userId;

    try {
      const existing = await prisma.worksheet.findUnique({ where: { id } });
      if (!existing) return c.json({ message: 'No worksheet found to update' }, 404);

      if (body.isAbsent) {
        const row = await prisma.worksheet.update({
          where: { id },
          data: {
            class: { connect: { id: body.classId } },
            student: { connect: { id: body.studentId } },
            submittedBy: { connect: { id: submittedById } },
            grade: 0,
            notes: body.notes || 'Student absent',
            status: ProcessingStatus.COMPLETED,
            outOf: 40,
            template: { disconnect: true },
            submittedOn: body.submittedOn ? new Date(body.submittedOn) : undefined,
            isAbsent: true,
            isRepeated: false,
            isIncorrectGrade: false,
            gradingDetails: Prisma.DbNull,
            wrongQuestionNumbers: null,
          },
        });
        return c.json(row, 200);
      }

      const worksheetNum = Number(body.worksheetNumber);
      if (!Number.isFinite(worksheetNum) || worksheetNum <= 0) {
        return c.json(
          { message: 'Valid worksheet number is required for non-absent students' },
          400
        );
      }
      const gradeValue = Number(body.grade);
      if (!Number.isFinite(gradeValue) || gradeValue < 0 || gradeValue > 40) {
        return c.json(
          { message: 'Valid grade between 0 and 40 is required for non-absent students' },
          400
        );
      }

      const template = await prisma.worksheetTemplate.findFirst({
        where: { worksheetNumber: worksheetNum },
      });

      // Preserve prior values when the caller omits gradingDetails /
      // wrongQuestionNumbers — mirrors the Express semantics where
      // `undefined` means "no change" and explicit `null` means "clear".
      const gradingDetails =
        body.gradingDetails === undefined
          ? undefined
          : (body.gradingDetails as Prisma.InputJsonValue) || Prisma.DbNull;
      const wrongQuestionNumbers =
        body.wrongQuestionNumbers === undefined
          ? undefined
          : body.wrongQuestionNumbers;

      const row = await prisma.worksheet.update({
        where: { id },
        data: {
          class: { connect: { id: body.classId } },
          student: { connect: { id: body.studentId } },
          submittedBy: { connect: { id: submittedById } },
          grade: gradeValue,
          worksheetNumber: worksheetNum,
          notes: body.notes ?? undefined,
          status: ProcessingStatus.COMPLETED,
          outOf: 40,
          ...(template ? { template: { connect: { id: template.id } } } : {}),
          submittedOn: body.submittedOn ? new Date(body.submittedOn) : undefined,
          isAbsent: false,
          isRepeated: body.isRepeated ?? false,
          isIncorrectGrade: body.isIncorrectGrade ?? false,
          gradingDetails,
          wrongQuestionNumbers,
        },
      });
      return c.json(row, 200);
    } catch (error) {
      console.error('Update graded worksheet error:', error);
      return c.json({ message: 'Server error while updating worksheet' }, 500);
    }
  }
);

worksheets.delete('/:id', requireAuthoringRole, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);
  const id = c.req.param('id');
  try {
    await prisma.worksheet.delete({ where: { id } });
    return c.json({ message: 'Worksheet deleted successfully' }, 200);
  } catch (error) {
    console.error('Delete graded worksheet error:', error);
    return c.json({ message: 'Server error while deleting worksheet' }, 500);
  }
});

worksheets.patch(
  '/:id/admin-comments',
  requireSuperadmin,
  validateJson(updateAdminCommentsSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const id = c.req.param('id');
    const { adminComments } = c.req.valid('json');

    try {
      const existing = await prisma.worksheet.findUnique({ where: { id } });
      if (!existing) return c.json({ message: 'Worksheet not found' }, 404);

      const updated = await prisma.worksheet.update({
        where: { id },
        data: {
          adminComments: adminComments || null,
          updatedAt: new Date(),
        },
      });
      return c.json(
        { message: 'Admin comments updated successfully', worksheet: updated },
        200
      );
    } catch (error) {
      console.error('Update worksheet admin comments error:', error);
      return c.json({ message: 'Server error while updating admin comments' }, 500);
    }
  }
);

worksheets.patch('/:id/mark-correct', requireSuperadmin, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const existing = await prisma.worksheet.findUnique({ where: { id } });
    if (!existing) return c.json({ message: 'Worksheet not found' }, 404);

    const updated = await prisma.worksheet.update({
      where: { id },
      data: { isIncorrectGrade: false, updatedAt: new Date() },
    });
    return c.json(
      { message: 'Worksheet marked as correctly graded', worksheet: updated },
      200
    );
  } catch (error) {
    console.error('Mark worksheet as correctly graded error:', error);
    return c.json(
      { message: 'Server error while updating worksheet grading status' },
      500
    );
  }
});

// ---------- Python API utility endpoints ----------

worksheets.post(
  '/images',
  requireAuthoringRole,
  validateJson(pythonImagesSchema),
  async (c) => {
    const { token_no, worksheet_name } = c.req.valid('json');
    const pythonApiUrl = c.env?.PYTHON_API_URL;
    if (!pythonApiUrl) {
      return c.json(
        { message: 'Server configuration error: PYTHON_API_URL not set' },
        500
      );
    }

    try {
      const result = await callPython(`${pythonApiUrl}/get-worksheet-images`, {
        method: 'POST',
        json: { token_no, worksheet_name },
      });
      return c.json(result as object, 200);
    } catch (error) {
      console.error('Get worksheet images error:', error);
      const status = (error as { status?: number } | null)?.status;
      if (typeof status === 'number' && status >= 400 && status < 500) {
        return c.json(
          { message: 'Failed to fetch images from Python API' },
          status as 400 | 401 | 403 | 404
        );
      }
      return c.json({ message: 'Server error while fetching worksheet images' }, 500);
    }
  }
);

worksheets.post(
  '/total-ai-graded',
  requireSuperadmin,
  validateJson(totalAiGradedSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { startDate, endDate } = c.req.valid('json');
    const startBoundary = startDate ? parseDateInputToUtcStart(String(startDate)) : null;
    const endBoundaryExclusive = endDate
      ? parseDateInputToUtcEndExclusive(String(endDate))
      : null;

    if ((startDate && !startBoundary) || (endDate && !endBoundaryExclusive)) {
      return c.json({ message: 'Invalid startDate/endDate values' }, 400);
    }
    if (startBoundary && endBoundaryExclusive && startBoundary >= endBoundaryExclusive) {
      return c.json({ message: 'startDate must be before or equal to endDate' }, 400);
    }

    const where: Prisma.GradingJobWhereInput = {
      status: GradingJobStatus.COMPLETED,
    };
    if (startBoundary || endBoundaryExclusive) {
      const dateRange: { gte?: Date; lt?: Date } = {};
      if (startBoundary) dateRange.gte = startBoundary;
      if (endBoundaryExclusive) dateRange.lt = endBoundaryExclusive;
      where.AND = [{ OR: [{ submittedOn: dateRange }, { createdAt: dateRange }] }];
    }

    try {
      const totalAiGraded = await prisma.gradingJob.count({ where });
      return c.json({ total_ai_graded: totalAiGraded }, 200);
    } catch (error) {
      console.error('Get total AI graded error:', error);
      return c.json(
        { message: 'Server error while fetching total AI graded count from database' },
        500
      );
    }
  }
);

worksheets.post(
  '/student-grading-details',
  requireSuperadmin,
  validateJson(pythonGradingDetailsSchema),
  async (c) => {
    const { token_no, worksheet_name, overall_score } = c.req.valid('json');
    const pythonApiUrl = c.env?.PYTHON_API_URL;
    if (!pythonApiUrl) {
      return c.json(
        { message: 'Server configuration error: PYTHON_API_URL not set' },
        500
      );
    }

    const body: Record<string, unknown> = { token_no, worksheet_name };
    if (overall_score !== undefined && overall_score !== null) {
      body.overall_score = overall_score;
    }

    try {
      const result = await callPython(`${pythonApiUrl}/student-grading-details`, {
        method: 'POST',
        json: body,
      });
      return c.json(result as object, 200);
    } catch (error) {
      console.error('Get student grading details error:', error);
      return c.json(
        { message: 'Server error while fetching student grading details' },
        500
      );
    }
  }
);

// ---------- Derived queries + batch operations ----------

worksheets.post(
  '/check-repeated',
  requireAuthoringRole,
  validateJson(checkRepeatedSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { classId, studentId, worksheetNumber, beforeDate } = c.req.valid('json');
    const worksheetNum =
      typeof worksheetNumber === 'number' ? worksheetNumber : parseInt(worksheetNumber, 10);
    if (!Number.isFinite(worksheetNum) || worksheetNum <= 0) {
      return c.json({ message: 'Invalid worksheet number' }, 400);
    }

    try {
      const template = await prisma.worksheetTemplate.findFirst({
        where: { worksheetNumber: worksheetNum },
      });

      if (!template) {
        return c.json(
          { isRepeated: false, reason: 'Template not found for this worksheet number' },
          200
        );
      }

      const dateFilter: { lt?: Date } = {};
      if (beforeDate) {
        const d = new Date(beforeDate);
        d.setUTCHours(23, 59, 59, 999);
        dateFilter.lt = d;
      }

      const existing = await prisma.worksheet.findFirst({
        where: {
          classId,
          studentId,
          templateId: template.id,
          status: ProcessingStatus.COMPLETED,
          isAbsent: false,
          grade: { not: null },
          ...(beforeDate ? { submittedOn: dateFilter } : {}),
        },
        select: { id: true, grade: true, submittedOn: true },
        orderBy: { submittedOn: 'desc' },
      });

      return c.json(
        {
          isRepeated: !!existing,
          previousWorksheet: existing
            ? { id: existing.id, grade: existing.grade, submittedOn: existing.submittedOn }
            : null,
        },
        200
      );
    } catch (error) {
      console.error('Check is repeated error:', error);
      return c.json({ message: 'Server error while checking repeated status' }, 500);
    }
  }
);

/**
 * Batch save worksheets for a class on a given day. Each row can be a
 * grade save, an absent marker, or a delete. Mirrors the Express
 * implementation 1:1 — failures on individual rows are captured in the
 * per-row `errors` array and the rest of the batch continues.
 */
worksheets.post(
  '/batch-save',
  requireAuthoringRole,
  validateJson(batchSaveSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { classId, submittedOn, worksheets: rows } = c.req.valid('json');
    const user = c.get('user')!;
    const submittedById = user.userId;

    const submittedOnDate = new Date(submittedOn);
    submittedOnDate.setUTCHours(0, 0, 0, 0);

    const results = {
      saved: 0,
      updated: 0,
      deleted: 0,
      failed: 0,
      errors: [] as { studentId: string; error: string }[],
    };

    try {
      for (const raw of rows) {
        const ws = raw as Record<string, unknown>;
        const studentId = typeof ws.studentId === 'string' ? ws.studentId : undefined;
        if (!studentId) {
          results.failed++;
          results.errors.push({ studentId: 'unknown', error: 'Missing studentId' });
          continue;
        }
        const action = ws.action;
        const isAbsent = Boolean(ws.isAbsent);
        const isRepeated = Boolean(ws.isRepeated);
        const isIncorrectGrade = Boolean(ws.isIncorrectGrade);
        const gradingDetails = ws.gradingDetails;
        const wrongQuestionNumbers = ws.wrongQuestionNumbers as number[] | null | undefined;

        try {
          if (action === 'delete') {
            const del = await prisma.worksheet.deleteMany({
              where: { classId, studentId, submittedOn: submittedOnDate },
            });
            if (del.count > 0) results.deleted += del.count;
            continue;
          }

          if (isAbsent) {
            await prisma.worksheet.upsert({
              where: {
                unique_worksheet_per_student_day: {
                  studentId,
                  classId,
                  worksheetNumber: 0,
                  submittedOn: submittedOnDate,
                },
              },
              update: {
                grade: 0,
                isAbsent: true,
                status: ProcessingStatus.COMPLETED,
                worksheetNumber: 0,
              },
              create: {
                classId,
                studentId,
                submittedById,
                worksheetNumber: 0,
                grade: 0,
                isAbsent: true,
                isRepeated: false,
                status: ProcessingStatus.COMPLETED,
                outOf: 40,
                submittedOn: submittedOnDate,
              },
            });
            results.saved++;
            continue;
          }

          const worksheetNum =
            typeof ws.worksheetNumber === 'number'
              ? ws.worksheetNumber
              : parseInt(String(ws.worksheetNumber ?? ''), 10);
          if (!Number.isFinite(worksheetNum) || worksheetNum <= 0) {
            results.failed++;
            results.errors.push({ studentId, error: 'Invalid worksheet number' });
            continue;
          }

          const gradeValue = parseFloat(String(ws.grade ?? ''));
          if (!Number.isFinite(gradeValue) || gradeValue < 0 || gradeValue > 40) {
            results.failed++;
            results.errors.push({ studentId, error: 'Invalid grade (must be 0-40)' });
            continue;
          }

          const template = await prisma.worksheetTemplate.findFirst({
            where: { worksheetNumber: worksheetNum },
          });

          const existing = await prisma.worksheet.findFirst({
            where: {
              studentId,
              classId,
              worksheetNumber: worksheetNum,
              submittedOn: submittedOnDate,
            },
          });

          await prisma.worksheet.upsert({
            where: {
              unique_worksheet_per_student_day: {
                studentId,
                classId,
                worksheetNumber: worksheetNum,
                submittedOn: submittedOnDate,
              },
            },
            update: {
              grade: gradeValue,
              status: ProcessingStatus.COMPLETED,
              isRepeated,
              isIncorrectGrade,
              gradingDetails: (gradingDetails as Prisma.InputJsonValue) || undefined,
              wrongQuestionNumbers: wrongQuestionNumbers || undefined,
              worksheetNumber: worksheetNum,
            },
            create: {
              classId,
              studentId,
              submittedById,
              templateId: template?.id,
              worksheetNumber: worksheetNum,
              grade: gradeValue,
              status: ProcessingStatus.COMPLETED,
              outOf: 40,
              submittedOn: submittedOnDate,
              isAbsent: false,
              isRepeated,
              isIncorrectGrade,
              gradingDetails: (gradingDetails as Prisma.InputJsonValue) || undefined,
              wrongQuestionNumbers: wrongQuestionNumbers || undefined,
            },
          });

          if (existing) results.updated++;
          else results.saved++;
        } catch (rowErr) {
          results.failed++;
          results.errors.push({
            studentId,
            error: rowErr instanceof Error ? rowErr.message : 'Unknown error',
          });
        }
      }

      return c.json({ success: true, ...results }, 200);
    } catch (error) {
      console.error('Batch save worksheets error:', error);
      return c.json({ message: 'Server error while saving worksheets' }, 500);
    }
  }
);

export default worksheets;
