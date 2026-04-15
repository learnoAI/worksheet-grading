import { Hono } from 'hono';
import { ProcessingStatus, UserRole } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { validateQuery } from '../validation';
import {
  findWorksheetQuerySchema,
  historyQuerySchema,
} from '../schemas/worksheets';
import type { AppBindings } from '../types';

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

export default worksheets;
