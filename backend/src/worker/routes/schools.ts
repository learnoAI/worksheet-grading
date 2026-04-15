import { Hono } from 'hono';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { validateJson } from '../validation';
import { createSchoolSchema, updateSchoolSchema } from '../schemas/schools';
import type { AppBindings } from '../types';

/**
 * School routes — port of `backend/src/routes/schoolRoutes.ts`.
 *
 * Mounted under `/api/schools`. Covers both read and write endpoints. All
 * endpoints require SUPERADMIN role, matching the Express router.
 *
 * Route order: literal `/archived` comes before `/:id`; mutation routes
 * keyed on `:id` (`/archive`, `/unarchive`) are handled below the GETs.
 */
const SCHOOL_LIST_SELECT = {
  id: true,
  name: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      classes: true,
      studentSchools: true,
      teacherSchools: true,
    },
  },
} as const;

const schools = new Hono<AppBindings>();

schools.use('*', authenticate);
schools.use('*', authorize([UserRole.SUPERADMIN]));

/**
 * `?includeArchived=true` returns only archived; anything else returns only
 * active. This matches the existing Express behavior (it is a toggle, not a
 * union — the "archived" view is mutually exclusive with "active").
 */
schools.get('/', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) {
    return c.json({ message: 'Database is not available' }, 500);
  }
  const includeArchived = c.req.query('includeArchived') === 'true';
  try {
    const rows = await prisma.school.findMany({
      where: { isArchived: includeArchived },
      select: SCHOOL_LIST_SELECT,
      orderBy: { name: 'asc' },
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error getting schools:', error);
    return c.json({ message: 'Server error while retrieving schools' }, 500);
  }
});

schools.get('/archived', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) {
    return c.json({ message: 'Database is not available' }, 500);
  }
  try {
    const rows = await prisma.school.findMany({
      where: { isArchived: true },
      select: SCHOOL_LIST_SELECT,
      orderBy: { name: 'asc' },
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error fetching archived schools:', error);
    return c.json({ message: 'Server error while retrieving archived schools' }, 500);
  }
});

schools.get('/:id', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) {
    return c.json({ message: 'Database is not available' }, 500);
  }
  const id = c.req.param('id');
  try {
    const school = await prisma.school.findUnique({
      where: { id },
      include: {
        classes: {
          select: {
            id: true,
            name: true,
            isArchived: true,
            _count: {
              select: {
                studentClasses: true,
                teacherClasses: true,
              },
            },
          },
        },
        _count: {
          select: {
            classes: true,
            studentSchools: true,
            teacherSchools: true,
          },
        },
      },
    });

    if (!school) {
      return c.json({ message: 'School not found' }, 404);
    }
    return c.json(school, 200);
  } catch (error) {
    console.error('Error fetching school details:', error);
    return c.json({ message: 'Server error while retrieving school details' }, 500);
  }
});

schools.post('/', validateJson(createSchoolSchema), async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const { name } = c.req.valid('json');
  const trimmed = name.trim();

  try {
    const existing = await prisma.school.findFirst({
      where: { name: { equals: trimmed, mode: 'insensitive' } },
    });
    if (existing) {
      return c.json({ message: 'A school with this name already exists' }, 400);
    }
    const created = await prisma.school.create({ data: { name: trimmed } });
    return c.json(created, 201);
  } catch (error) {
    console.error('Error creating school:', error);
    return c.json({ message: 'Server error while creating school' }, 500);
  }
});

schools.put('/:id', validateJson(updateSchoolSchema), async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  const { name } = c.req.valid('json');

  try {
    const existing = await prisma.school.findUnique({ where: { id } });
    if (!existing) return c.json({ message: 'School not found' }, 404);

    if (name) {
      const trimmed = name.trim();
      const duplicate = await prisma.school.findFirst({
        where: { name: { equals: trimmed, mode: 'insensitive' }, id: { not: id } },
      });
      if (duplicate) {
        return c.json({ message: 'A school with this name already exists' }, 400);
      }
      const updated = await prisma.school.update({
        where: { id },
        data: { name: trimmed },
      });
      return c.json(updated, 200);
    }

    // No-op update preserves Express behavior of returning the row even when
    // the body has no updatable fields.
    return c.json(existing, 200);
  } catch (error) {
    console.error('Error updating school:', error);
    return c.json({ message: 'Server error while updating school' }, 500);
  }
});

/**
 * Archive a school AND its classes AND any students that have no other
 * active school. The Express version wraps all of this in a $transaction;
 * we mirror that to keep the operation atomic.
 */
schools.post('/:id/archive', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const existing = await prisma.school.findUnique({ where: { id } });
    if (!existing) return c.json({ message: 'School not found' }, 404);

    await prisma.$transaction(async (tx) => {
      await tx.school.update({ where: { id }, data: { isArchived: true } });
      await tx.class.updateMany({
        where: { schoolId: id },
        data: { isArchived: true },
      });

      const studentSchools = await tx.studentSchool.findMany({
        where: { schoolId: id },
        select: { studentId: true },
      });

      for (const { studentId } of studentSchools) {
        const activeElsewhere = await tx.studentSchool.count({
          where: {
            studentId,
            schoolId: { not: id },
            school: { isArchived: false },
          },
        });
        if (activeElsewhere === 0) {
          await tx.user.update({
            where: { id: studentId },
            data: { isArchived: true },
          });
        }
      }
    });

    return c.json(
      { message: 'School and all associated classes and students archived successfully' },
      200
    );
  } catch (error) {
    console.error('Archive school error:', error);
    return c.json({ message: 'Server error during school archiving' }, 500);
  }
});

schools.post('/:id/unarchive', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const existing = await prisma.school.findUnique({ where: { id } });
    if (!existing) return c.json({ message: 'School not found' }, 404);
    await prisma.school.update({ where: { id }, data: { isArchived: false } });
    return c.json({ message: 'School unarchived successfully' }, 200);
  } catch (error) {
    console.error('Unarchive school error:', error);
    return c.json({ message: 'Server error during school unarchiving' }, 500);
  }
});

/**
 * Hard delete only when the school has no classes/students/teachers/admins;
 * otherwise return 400 telling the caller to archive instead. Matches the
 * Express version 1:1.
 */
schools.delete('/:id', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const existing = await prisma.school.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            classes: true,
            studentSchools: true,
            teacherSchools: true,
            adminSchools: true,
          },
        },
      },
    });
    if (!existing) return c.json({ message: 'School not found' }, 404);

    const { _count } = existing;
    if (
      _count.classes > 0 ||
      _count.studentSchools > 0 ||
      _count.teacherSchools > 0 ||
      _count.adminSchools > 0
    ) {
      return c.json(
        {
          message:
            'Cannot delete school with associated classes or users. Please archive it instead.',
        },
        400
      );
    }

    await prisma.school.delete({ where: { id } });
    return c.json({ message: 'School deleted successfully' }, 200);
  } catch (error) {
    console.error('Delete school error:', error);
    return c.json({ message: 'Server error during school deletion' }, 500);
  }
});

export default schools;
