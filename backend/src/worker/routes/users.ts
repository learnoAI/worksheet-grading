import { Hono } from 'hono';
import { UserRole, type Prisma } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import type { AppBindings } from '../types';

/**
 * User routes — port of `backend/src/routes/userRoutes.ts` (read endpoints).
 *
 * Mounted under `/api/users`. Only GET endpoints are ported in this phase;
 * mutation endpoints (create/update/reset-password/archive/CSV upload) come
 * in Phase 5.7 / 5.8.
 *
 * Route order matters: Hono matches sequentially, so `/with-details` is
 * declared before `/:id` so it is not swallowed by the dynamic param.
 */
const users = new Hono<AppBindings>();

users.use('*', authenticate);

const USER_SELECT = {
  id: true,
  username: true,
  role: true,
  createdAt: true,
  updatedAt: true,
} as const;

const USER_BY_ID_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
  tokenNumber: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
} as const;

const USER_WITH_DETAILS_SELECT = {
  id: true,
  name: true,
  username: true,
  role: true,
  tokenNumber: true,
  isArchived: true,
  createdAt: true,
  updatedAt: true,
  studentClasses: {
    include: { class: { include: { school: { select: { id: true, name: true } } } } },
  },
  studentSchools: { include: { school: { select: { id: true, name: true } } } },
  teacherClasses: {
    include: { class: { include: { school: { select: { id: true, name: true } } } } },
  },
  adminSchools: { include: { school: { select: { id: true, name: true } } } },
} as const;

function isUserRole(value: string | undefined): value is UserRole {
  if (!value) return false;
  return (Object.values(UserRole) as string[]).includes(value);
}

users.get('/with-details', authorize([UserRole.SUPERADMIN]), async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const pageRaw = Number.parseInt(c.req.query('page') ?? '', 10);
  const limitRaw = Number.parseInt(c.req.query('limit') ?? '', 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? limitRaw : 30;
  const offset = (page - 1) * limit;

  const roleParam = c.req.query('role');
  const archivedParam = c.req.query('isArchived');
  const search = c.req.query('search');

  const where: Prisma.UserWhereInput = {};
  if (isUserRole(roleParam)) where.role = roleParam;
  if (archivedParam === 'true') where.isArchived = true;
  else if (archivedParam === 'false') where.isArchived = false;
  if (search) {
    where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { username: { contains: search, mode: 'insensitive' } },
      { tokenNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

  try {
    const [totalCount, rows] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        select: USER_WITH_DETAILS_SELECT,
        orderBy: [{ isArchived: 'asc' }, { role: 'asc' }, { name: 'asc' }],
        skip: offset,
        take: limit,
      }),
    ]);

    const totalPages = Math.ceil(totalCount / limit);
    return c.json(
      {
        users: rows,
        pagination: {
          currentPage: page,
          totalPages,
          totalCount,
          hasNextPage: page < totalPages,
          hasPrevPage: page > 1,
        },
      },
      200
    );
  } catch (error) {
    console.error('Get users with details error:', error);
    return c.json({ message: 'Server error while retrieving users' }, 500);
  }
});

users.get('/', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const roleParam = c.req.query('role');
  const where: Prisma.UserWhereInput = {};
  if (isUserRole(roleParam)) where.role = roleParam;

  try {
    const rows = await prisma.user.findMany({
      where,
      select: USER_SELECT,
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Get users error:', error);
    return c.json({ message: 'Server error while retrieving users' }, 500);
  }
});

users.get('/:id', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const user = await prisma.user.findUnique({
      where: { id },
      select: USER_BY_ID_SELECT,
    });
    if (!user) return c.json({ message: 'User not found' }, 404);
    return c.json(user, 200);
  } catch (error) {
    console.error('Get user by ID error:', error);
    return c.json({ message: 'Server error while retrieving user' }, 500);
  }
});

export default users;
