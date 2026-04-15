import { Hono } from 'hono';
import { UserRole, type Prisma } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import type { AppBindings } from '../types';

/**
 * Class routes — port of `backend/src/routes/classRoutes.ts` (read endpoints).
 *
 * Mounted under `/api/classes`. All endpoints are SUPERADMIN-only. Only GETs
 * are ported here; mutation endpoints (create/archive/add teacher/add
 * student/CSV uploads) come in Phase 5.7 / 5.8.
 *
 * Route order matters: static + more-specific paths go before `/:id`.
 */
const classes = new Hono<AppBindings>();

classes.use('*', authenticate);
classes.use('*', authorize([UserRole.SUPERADMIN]));

const CLASS_LIST_INCLUDE = {
  school: { select: { id: true, name: true } },
  _count: {
    select: {
      studentClasses: true,
      teacherClasses: true,
      worksheets: true,
    },
  },
} as const;

classes.get('/', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const includeArchived = c.req.query('includeArchived') === 'true';
  const schoolId = c.req.query('schoolId');

  const where: Prisma.ClassWhereInput = {};
  if (!includeArchived) where.isArchived = false;
  if (schoolId) where.schoolId = schoolId;

  try {
    const rows = await prisma.class.findMany({
      where,
      include: CLASS_LIST_INCLUDE,
      orderBy: [
        { isArchived: 'asc' },
        { school: { name: 'asc' } },
        { name: 'asc' },
      ],
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error fetching classes:', error);
    return c.json({ message: 'Server error while retrieving classes' }, 500);
  }
});

classes.get('/archived', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const schoolId = c.req.query('schoolId');
  const where: Prisma.ClassWhereInput = { isArchived: true };
  if (schoolId) where.schoolId = schoolId;

  try {
    const rows = await prisma.class.findMany({
      where,
      include: CLASS_LIST_INCLUDE,
      orderBy: [{ school: { name: 'asc' } }, { name: 'asc' }],
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error fetching archived classes:', error);
    return c.json({ message: 'Server error while retrieving archived classes' }, 500);
  }
});

classes.get('/teachers/available/:classId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('classId');
  try {
    const teachers = await prisma.user.findMany({
      where: {
        role: 'TEACHER',
        isArchived: false,
        teacherClasses: { none: { classId } },
      },
      select: { id: true, name: true, username: true, createdAt: true },
      orderBy: { name: 'asc' },
    });
    return c.json(teachers, 200);
  } catch (error) {
    console.error('Error getting available teachers:', error);
    return c.json({ message: 'Server error while retrieving available teachers' }, 500);
  }
});

classes.get('/students/available/:classId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('classId');
  try {
    const classEntity = await prisma.class.findUnique({
      where: { id: classId },
      select: { schoolId: true },
    });
    if (!classEntity) {
      return c.json({ message: 'Class not found' }, 404);
    }

    const students = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        isArchived: false,
        studentClasses: { none: { classId } },
        studentSchools: { some: { schoolId: classEntity.schoolId } },
      },
      select: {
        id: true,
        name: true,
        username: true,
        tokenNumber: true,
        createdAt: true,
      },
      orderBy: { tokenNumber: 'asc' },
    });
    return c.json(students, 200);
  } catch (error) {
    console.error('Error getting available students:', error);
    return c.json({ message: 'Server error while retrieving available students' }, 500);
  }
});

classes.get('/:id', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const row = await prisma.class.findUnique({
      where: { id },
      include: {
        school: { select: { id: true, name: true } },
        studentClasses: {
          include: {
            student: {
              select: { id: true, name: true, username: true, tokenNumber: true },
            },
          },
        },
        teacherClasses: {
          include: {
            teacher: { select: { id: true, name: true, username: true } },
          },
        },
        _count: { select: { worksheets: true } },
      },
    });

    if (!row) return c.json({ message: 'Class not found' }, 404);
    return c.json(row, 200);
  } catch (error) {
    console.error('Error fetching class details:', error);
    return c.json({ message: 'Server error while retrieving class details' }, 500);
  }
});

classes.get('/:id/teachers', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('id');
  try {
    const teachers = await prisma.user.findMany({
      where: {
        role: 'TEACHER',
        teacherClasses: { some: { classId } },
      },
      select: { id: true, name: true, username: true, createdAt: true },
    });
    return c.json(teachers, 200);
  } catch (error) {
    console.error('Error getting class teachers:', error);
    return c.json({ message: 'Server error while retrieving class teachers' }, 500);
  }
});

classes.get('/:id/students', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('id');
  try {
    const students = await prisma.user.findMany({
      where: {
        role: 'STUDENT',
        studentClasses: { some: { classId } },
      },
      select: {
        id: true,
        name: true,
        username: true,
        tokenNumber: true,
        isArchived: true,
        createdAt: true,
      },
      orderBy: { tokenNumber: 'asc' },
    });
    return c.json(students, 200);
  } catch (error) {
    console.error('Error getting class students:', error);
    return c.json({ message: 'Server error while retrieving class students' }, 500);
  }
});

export default classes;
