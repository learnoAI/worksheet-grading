import { Hono } from 'hono';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import type { AppBindings } from '../types';

/**
 * School routes — port of `backend/src/routes/schoolRoutes.ts` (read endpoints).
 *
 * Mounted under `/api/schools`. Write endpoints (create/update/archive/delete)
 * come in Phase 5.7. All endpoints require SUPERADMIN role, matching Express.
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

export default schools;
