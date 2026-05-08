import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { UserRole, type Prisma } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import {
  isUniqueConstraintError,
  isRecordNotFoundError,
  getUniqueConstraintTarget,
} from '../lib/prismaErrors';
import { validateJson } from '../validation';
import {
  createUserSchema,
  updateUserSchema,
  resetPasswordSchema,
  uploadCsvSchema,
} from '../schemas/users';
import type { AppBindings } from '../types';

/**
 * User routes — port of `backend/src/routes/userRoutes.ts`.
 *
 * Mounted under `/api/users`. Covers reads + mutations:
 *   GET    /with-details         — paginated user listing (SUPERADMIN)
 *   GET    /                     — list users (any auth)
 *   GET    /:id                  — single user (any auth)
 *   POST   /                     — create user (ADMIN/SUPERADMIN)
 *   PUT    /:id                  — update user (ADMIN/SUPERADMIN)
 *   POST   /:id/reset-password   — reset password (ADMIN/SUPERADMIN)
 *   POST   /upload-csv           — bulk import students from JSON (SUPERADMIN)
 *   POST   /:id/archive          — archive student (SUPERADMIN)
 *   POST   /:id/unarchive        — unarchive student (SUPERADMIN)
 *
 * Route order matters: literal paths (`/with-details`, `/upload-csv`) come
 * before `/:id` so they are not swallowed by the dynamic param.
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
  // Preserve historical default (archived users included); callers opt in
  // to filtering with ?includeArchived=false. The reassign UI passes that.
  const includeArchived = c.req.query('includeArchived') !== 'false';
  // teacherSchools is a SUPERADMIN-only relation. Other roles get the
  // base list without school assignments.
  const isSuperadmin = c.get('user')?.role === UserRole.SUPERADMIN;

  const where: Prisma.UserWhereInput = {};
  if (isUserRole(roleParam)) where.role = roleParam;
  if (!includeArchived) where.isArchived = false;

  const baseSelect = {
    id: true,
    name: true,
    username: true,
    role: true,
    isArchived: true,
    createdAt: true,
    updatedAt: true,
  } as const;

  try {
    const rows = await prisma.user.findMany({
      where,
      select: isSuperadmin
        ? {
            ...baseSelect,
            teacherSchools: {
              select: { school: { select: { id: true, name: true } } },
            },
          }
        : baseSelect,
      orderBy: { name: 'asc' },
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

// ---------- Mutations ----------

const requireAdminOrSuper = authorize([UserRole.ADMIN, UserRole.SUPERADMIN]);
const requireSuperadmin = authorize([UserRole.SUPERADMIN]);

users.post('/', requireAdminOrSuper, validateJson(createUserSchema), async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const { name, username, password, role, tokenNumber, classId, schoolId } =
    c.req.valid('json');

  try {
    // Skip findUnique pre-checks for username / tokenNumber — both are unique
    // columns, so the create itself is authoritative. Hyperdrive's read cache
    // can return stale rows after a delete, which made the pre-checks
    // produce false-positive 400s. Disambiguate the duplicate column from
    // P2002's `meta.target`.
    const salt = await bcrypt.genSalt(10);
    const hashedPassword = await bcrypt.hash(password, salt);

    let newUser;
    try {
      newUser = await prisma.user.create({
        data: {
          name,
          username,
          password: hashedPassword,
          role: role as UserRole,
          tokenNumber: tokenNumber || null,
        },
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          tokenNumber: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        const target = getUniqueConstraintTarget(error);
        if (target.includes('username')) {
          return c.json({ message: 'Username already exists' }, 400);
        }
        if (target.includes('tokenNumber')) {
          return c.json({ message: 'Token number already exists' }, 400);
        }
        return c.json({ message: 'A user with these details already exists' }, 400);
      }
      throw error;
    }

    // Side-effect joins. Mirrors Express: not wrapped in a transaction.
    if (role === 'STUDENT' && classId) {
      await prisma.studentClass.create({
        data: { studentId: newUser.id, classId },
      });
      const cls = await prisma.class.findUnique({
        where: { id: classId },
        select: { schoolId: true },
      });
      if (cls) {
        try {
          await prisma.studentSchool.create({
            data: { studentId: newUser.id, schoolId: cls.schoolId },
          });
        } catch (error) {
          if (!isUniqueConstraintError(error)) throw error;
        }
      }
    } else if (role === 'TEACHER' && classId) {
      await prisma.teacherClass.create({
        data: { teacherId: newUser.id, classId },
      });
    }

    if (role === 'ADMIN' && schoolId) {
      await prisma.adminSchool.create({
        data: { adminId: newUser.id, schoolId },
      });
    }

    return c.json(newUser, 201);
  } catch (error) {
    console.error('Create user error:', error);
    return c.json({ message: 'Server error during user creation' }, 500);
  }
});

users.put('/:id', requireAdminOrSuper, validateJson(updateUserSchema), async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  const body = c.req.valid('json');

  try {
    // Read the existing user once for the role-change guard. We still
    // can't avoid this read because the request payload doesn't carry the
    // current role, but it's read-only — staleness here only matters for
    // the role-change guard, which is informational rather than a security
    // boundary (DB-level role enforcement would be a separate change).
    const existing = await prisma.user.findUnique({ where: { id } });
    if (!existing) return c.json({ message: 'User not found' }, 404);

    if (body.role && body.role !== existing.role) {
      return c.json({ message: 'Changing user role is not allowed' }, 400);
    }

    const data: Prisma.UserUpdateInput = {};
    if (body.name) data.name = body.name;
    if (body.username) data.username = body.username;
    if (body.password) {
      const salt = await bcrypt.genSalt(10);
      data.password = await bcrypt.hash(body.password, salt);
    }
    if (body.tokenNumber !== undefined) {
      data.tokenNumber = body.tokenNumber || null;
    }

    // Let the DB enforce uniqueness on username / tokenNumber rather than
    // pre-checking with Hyperdrive-stale findUnique calls. Disambiguate via
    // P2002's meta.target.
    let updated;
    try {
      updated = await prisma.user.update({
        where: { id },
        data,
        select: {
          id: true,
          name: true,
          username: true,
          role: true,
          tokenNumber: true,
          isArchived: true,
          createdAt: true,
          updatedAt: true,
        },
      });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        return c.json({ message: 'User not found' }, 404);
      }
      if (isUniqueConstraintError(error)) {
        const target = getUniqueConstraintTarget(error);
        if (target.includes('username')) {
          return c.json({ message: 'Username already exists' }, 400);
        }
        if (target.includes('tokenNumber')) {
          return c.json({ message: 'Token number already exists' }, 400);
        }
        return c.json({ message: 'A user with these details already exists' }, 400);
      }
      throw error;
    }
    return c.json(updated, 200);
  } catch (error) {
    console.error('Update user error:', error);
    return c.json({ message: 'Server error during user update' }, 500);
  }
});

users.post(
  '/:id/reset-password',
  requireAdminOrSuper,
  validateJson(resetPasswordSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const id = c.req.param('id');
    const { newPassword } = c.req.valid('json');

    try {
      const salt = await bcrypt.genSalt(10);
      const hashed = await bcrypt.hash(newPassword, salt);

      try {
        await prisma.user.update({ where: { id }, data: { password: hashed } });
      } catch (error) {
        if (isRecordNotFoundError(error)) {
          return c.json({ message: 'User not found' }, 404);
        }
        throw error;
      }
      return c.json({ message: 'Password reset successful' }, 200);
    } catch (error) {
      console.error('Password reset error:', error);
      return c.json({ message: 'Server error during password reset' }, 500);
    }
  }
);

users.post(
  '/upload-csv',
  requireSuperadmin,
  validateJson(uploadCsvSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { students } = c.req.valid('json');
    if (students.length === 0) {
      return c.json({ message: 'No student data provided' }, 400);
    }

    const results = { created: 0, updated: 0, errors: [] as string[] };

    try {
      for (const studentData of students) {
        const name = typeof studentData.name === 'string' ? studentData.name : undefined;
        const tokenNumber =
          typeof studentData.tokenNumber === 'string' ? studentData.tokenNumber : undefined;
        const className =
          typeof studentData.className === 'string' ? studentData.className : undefined;
        const schoolName =
          typeof studentData.schoolName === 'string' ? studentData.schoolName : undefined;

        if (!name || !tokenNumber || !className || !schoolName) {
          results.errors.push(`Missing required fields for student: ${name || tokenNumber}`);
          continue;
        }

        try {
          const school = await prisma.school.findFirst({ where: { name: schoolName } });
          if (!school) {
            results.errors.push(`School not found: ${schoolName}`);
            continue;
          }

          const cls = await prisma.class.findFirst({
            where: { name: className, schoolId: school.id },
          });
          if (!cls) {
            results.errors.push(`Class not found: ${className} in ${schoolName}`);
            continue;
          }

          const existingStudent = await prisma.user.findFirst({ where: { tokenNumber } });

          if (existingStudent) {
            if (existingStudent.name !== name) {
              await prisma.user.update({
                where: { id: existingStudent.id },
                data: { name },
              });
              results.updated++;
            }

            const existingSc = await prisma.studentClass.findUnique({
              where: {
                studentId_classId: {
                  studentId: existingStudent.id,
                  classId: cls.id,
                },
              },
            });
            if (!existingSc) {
              await prisma.studentClass.create({
                data: { studentId: existingStudent.id, classId: cls.id },
              });
            }

            const existingSs = await prisma.studentSchool.findUnique({
              where: {
                studentId_schoolId: {
                  studentId: existingStudent.id,
                  schoolId: school.id,
                },
              },
            });
            if (!existingSs) {
              await prisma.studentSchool.create({
                data: { studentId: existingStudent.id, schoolId: school.id },
              });
            }
          } else {
            const username = name.toLowerCase().replace(/\s+/g, '_') + '_' + tokenNumber;
            const password = 'saarthi@123';

            const salt = await bcrypt.genSalt(10);
            const hashed = await bcrypt.hash(password, salt);

            const newStudent = await prisma.user.create({
              data: {
                name,
                username,
                password: hashed,
                role: UserRole.STUDENT,
                tokenNumber,
              },
            });

            await prisma.studentClass.create({
              data: { studentId: newStudent.id, classId: cls.id },
            });
            await prisma.studentSchool.create({
              data: { studentId: newStudent.id, schoolId: school.id },
            });

            results.created++;
          }
        } catch (error) {
          console.error('Error processing student:', studentData, error);
          results.errors.push(`Failed to process student: ${name} (${tokenNumber})`);
        }
      }

      return c.json({ message: 'CSV processing completed', results }, 200);
    } catch (error) {
      console.error('CSV upload error:', error);
      return c.json({ message: 'Server error during CSV upload' }, 500);
    }
  }
);

users.post('/:id/archive', requireSuperadmin, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    await prisma.user.update({ where: { id }, data: { isArchived: true } });
    return c.json({ message: 'Student archived successfully' }, 200);
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      return c.json({ message: 'Student not found' }, 404);
    }
    console.error('Archive student error:', error);
    return c.json({ message: 'Server error during student archiving' }, 500);
  }
});

users.post('/:id/unarchive', requireSuperadmin, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    await prisma.user.update({ where: { id }, data: { isArchived: false } });
    return c.json({ message: 'Student unarchived successfully' }, 200);
  } catch (error) {
    if (isRecordNotFoundError(error)) {
      return c.json({ message: 'Student not found' }, 404);
    }
    console.error('Unarchive student error:', error);
    return c.json({ message: 'Server error during student unarchiving' }, 500);
  }
});

export default users;
