import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { UserRole, type Prisma } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { validateJson } from '../validation';
import {
  createClassSchema,
  archiveByYearSchema,
  uploadClassTeachersSchema,
  uploadStudentClassesSchema,
} from '../schemas/classes';
import type { AppBindings } from '../types';

/**
 * Class routes — port of `backend/src/routes/classRoutes.ts`.
 *
 * Mounted under `/api/classes`. All endpoints require SUPERADMIN. Covers
 * reads + mutations (create, archive/unarchive, member management, bulk
 * archive by year, CSV imports for class-teacher and student-class
 * mappings).
 *
 * Route order matters: literal paths and more-specific paths come before
 * `/:id` so they are not swallowed by the dynamic param.
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

// ---------- Mutations ----------

const CLASS_DETAIL_INCLUDE = {
  school: { select: { id: true, name: true } },
  _count: {
    select: {
      studentClasses: true,
      teacherClasses: true,
      worksheets: true,
    },
  },
} as const;

classes.post('/archive-by-year', validateJson(archiveByYearSchema), async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const { academicYear, schoolId } = c.req.valid('json');
  const trimmedYear = academicYear.trim();

  const where: Prisma.ClassWhereInput = {
    academicYear: trimmedYear,
    isArchived: false,
  };
  if (schoolId) where.schoolId = schoolId;

  try {
    const activeClasses = await prisma.class.findMany({
      where,
      select: { id: true, name: true, schoolId: true },
    });
    if (activeClasses.length === 0) {
      return c.json(
        {
          message: `No active classes found for academic year ${trimmedYear}${
            schoolId ? ' in selected school' : ''
          }`,
        },
        404
      );
    }

    const classIds = activeClasses.map((cl) => cl.id);

    const result = await prisma.$transaction(async (tx) => {
      const archivedCount = await tx.class.updateMany({
        where: { id: { in: classIds } },
        data: { isArchived: true },
      });

      const studentClasses = await tx.studentClass.findMany({
        where: { classId: { in: classIds } },
        select: { studentId: true },
      });
      const uniqueStudentIds = [...new Set(studentClasses.map((sc) => sc.studentId))];

      const stillActive = await tx.studentClass.findMany({
        where: {
          studentId: { in: uniqueStudentIds },
          class: { isArchived: false },
        },
        select: { studentId: true },
        distinct: ['studentId'],
      });
      const activeStudentIds = new Set(stillActive.map((sc) => sc.studentId));
      const studentIdsToArchive = uniqueStudentIds.filter(
        (id) => !activeStudentIds.has(id)
      );

      let archivedStudentCount = 0;
      if (studentIdsToArchive.length > 0) {
        const r = await tx.user.updateMany({
          where: { id: { in: studentIdsToArchive } },
          data: { isArchived: true },
        });
        archivedStudentCount = r.count;
      }

      return {
        archivedClassCount: archivedCount.count,
        archivedStudentCount,
      };
    });

    return c.json(
      {
        message: `Archived ${result.archivedClassCount} classes and ${result.archivedStudentCount} students for academic year ${trimmedYear}`,
        ...result,
      },
      200
    );
  } catch (error) {
    console.error('Error bulk archiving classes:', error);
    return c.json({ message: 'Server error while bulk archiving classes' }, 500);
  }
});

classes.post(
  '/upload-class-teachers',
  validateJson(uploadClassTeachersSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { schoolId, rows } = c.req.valid('json');
    if (rows.length === 0) {
      return c.json({ message: 'No data provided' }, 400);
    }

    const results = {
      classesCreated: 0,
      teachersAssigned: 0,
      errors: [] as string[],
    };

    try {
      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!school) return c.json({ message: 'School not found' }, 404);

      for (const row of rows) {
        const className = typeof row.className === 'string' ? row.className : undefined;
        const academicYear =
          typeof row.academicYear === 'string' ? row.academicYear : undefined;
        const teacherUsername =
          typeof row.teacherUsername === 'string' ? row.teacherUsername : undefined;

        if (!className || !academicYear || !teacherUsername) {
          results.errors.push(`Missing required fields in row: ${JSON.stringify(row)}`);
          continue;
        }

        try {
          let cls = await prisma.class.findFirst({
            where: {
              name: className.trim(),
              schoolId,
              academicYear: academicYear.trim(),
            },
          });
          if (!cls) {
            cls = await prisma.class.create({
              data: {
                name: className.trim(),
                schoolId,
                academicYear: academicYear.trim(),
              },
            });
            results.classesCreated++;
          }

          const teacher = await prisma.user.findFirst({
            where: { username: teacherUsername.trim(), role: 'TEACHER' },
          });
          if (!teacher) {
            results.errors.push(`Teacher not found: ${teacherUsername}`);
            continue;
          }

          const existingTc = await prisma.teacherClass.findUnique({
            where: { teacherId_classId: { teacherId: teacher.id, classId: cls.id } },
          });
          if (!existingTc) {
            await prisma.teacherClass.create({
              data: { teacherId: teacher.id, classId: cls.id },
            });

            const existingTs = await prisma.teacherSchool.findUnique({
              where: { teacherId_schoolId: { teacherId: teacher.id, schoolId } },
            });
            if (!existingTs) {
              await prisma.teacherSchool.create({
                data: { teacherId: teacher.id, schoolId },
              });
            }
            results.teachersAssigned++;
          }
        } catch (error) {
          console.error('Error processing row:', row, error);
          results.errors.push(`Failed to process: ${className} / ${teacherUsername}`);
        }
      }

      return c.json(
        {
          message: `Created ${results.classesCreated} classes, assigned ${results.teachersAssigned} teachers`,
          results,
        },
        200
      );
    } catch (error) {
      console.error('Error uploading class-teacher CSV:', error);
      return c.json({ message: 'Server error during class-teacher CSV upload' }, 500);
    }
  }
);

classes.post(
  '/upload-student-classes',
  validateJson(uploadStudentClassesSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { schoolId, rows } = c.req.valid('json');
    if (rows.length === 0) {
      return c.json({ message: 'No data provided' }, 400);
    }

    const results = {
      studentsAssigned: 0,
      studentsCreated: 0,
      errors: [] as string[],
    };

    try {
      const school = await prisma.school.findUnique({ where: { id: schoolId } });
      if (!school) return c.json({ message: 'School not found' }, 404);

      for (const row of rows) {
        const tokenNumber =
          typeof row.tokenNumber === 'string' ? row.tokenNumber : undefined;
        const studentName =
          typeof row.studentName === 'string' ? row.studentName : undefined;
        const className = typeof row.className === 'string' ? row.className : undefined;
        const academicYear =
          typeof row.academicYear === 'string' ? row.academicYear : undefined;

        if (!tokenNumber || !studentName || !className || !academicYear) {
          results.errors.push(`Missing required fields in row: ${JSON.stringify(row)}`);
          continue;
        }

        try {
          const cls = await prisma.class.findFirst({
            where: {
              name: className.trim(),
              schoolId,
              academicYear: academicYear.trim(),
            },
          });
          if (!cls) {
            results.errors.push(
              `Class not found: ${className} (${academicYear}) — upload class-teacher CSV first`
            );
            continue;
          }

          let student = await prisma.user.findFirst({
            where: { tokenNumber: tokenNumber.trim() },
          });

          if (!student) {
            const username =
              studentName.trim().toLowerCase().replace(/\s+/g, '_') + '_' + tokenNumber.trim();
            const salt = await bcrypt.genSalt(10);
            const hashed = await bcrypt.hash('saarthi@123', salt);
            student = await prisma.user.create({
              data: {
                name: studentName.trim(),
                username,
                password: hashed,
                role: 'STUDENT',
                tokenNumber: tokenNumber.trim(),
              },
            });
            results.studentsCreated++;
          } else if (student.isArchived) {
            await prisma.user.update({
              where: { id: student.id },
              data: { isArchived: false },
            });
          }

          const existingSc = await prisma.studentClass.findUnique({
            where: {
              studentId_classId: { studentId: student.id, classId: cls.id },
            },
          });
          if (!existingSc) {
            await prisma.studentClass.create({
              data: { studentId: student.id, classId: cls.id },
            });
            results.studentsAssigned++;
          }

          const existingSs = await prisma.studentSchool.findUnique({
            where: { studentId_schoolId: { studentId: student.id, schoolId } },
          });
          if (!existingSs) {
            await prisma.studentSchool.create({
              data: { studentId: student.id, schoolId },
            });
          }
        } catch (error) {
          console.error('Error processing row:', row, error);
          results.errors.push(
            `Failed to process student: ${studentName} (${tokenNumber})`
          );
        }
      }

      return c.json(
        {
          message: `Assigned ${results.studentsAssigned} students (${results.studentsCreated} newly created)`,
          results,
        },
        200
      );
    } catch (error) {
      console.error('Error uploading student-class CSV:', error);
      return c.json({ message: 'Server error during student-class CSV upload' }, 500);
    }
  }
);

classes.post('/', validateJson(createClassSchema), async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const { name, schoolId, academicYear } = c.req.valid('json');
  const trimmedName = name.trim();
  const trimmedYear = academicYear.trim();

  try {
    const school = await prisma.school.findUnique({ where: { id: schoolId } });
    if (!school) return c.json({ message: 'School not found' }, 404);

    const duplicate = await prisma.class.findFirst({
      where: { name: trimmedName, schoolId, academicYear: trimmedYear },
    });
    if (duplicate) {
      return c.json(
        {
          message:
            'A class with this name already exists in this school for this academic year',
        },
        400
      );
    }

    const created = await prisma.class.create({
      data: { name: trimmedName, schoolId, academicYear: trimmedYear },
      include: CLASS_DETAIL_INCLUDE,
    });
    return c.json(created, 201);
  } catch (error) {
    console.error('Error creating class:', error);
    return c.json({ message: 'Server error while creating class' }, 500);
  }
});

classes.post('/:id/archive', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const existing = await prisma.class.findUnique({
      where: { id },
      include: { school: { select: { name: true } } },
    });
    if (!existing) return c.json({ message: 'Class not found' }, 404);
    if (existing.isArchived) {
      return c.json({ message: 'Class is already archived' }, 400);
    }

    const archived = await prisma.$transaction(async (tx) => {
      const row = await tx.class.update({
        where: { id },
        data: { isArchived: true },
        include: CLASS_DETAIL_INCLUDE,
      });

      const studentClasses = await tx.studentClass.findMany({
        where: { classId: id },
        select: { studentId: true },
      });

      for (const { studentId } of studentClasses) {
        const activeElsewhere = await tx.studentClass.count({
          where: {
            studentId,
            classId: { not: id },
            class: { isArchived: false },
          },
        });
        if (activeElsewhere === 0) {
          await tx.user.update({
            where: { id: studentId },
            data: { isArchived: true },
          });
        }
      }

      return row;
    });

    return c.json(
      {
        message: `Class "${existing.name}" from ${existing.school.name} and all associated students have been archived`,
        class: archived,
      },
      200
    );
  } catch (error) {
    console.error('Error archiving class:', error);
    return c.json({ message: 'Server error while archiving class' }, 500);
  }
});

classes.post('/:id/unarchive', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const existing = await prisma.class.findUnique({
      where: { id },
      include: { school: { select: { name: true } } },
    });
    if (!existing) return c.json({ message: 'Class not found' }, 404);
    if (!existing.isArchived) {
      return c.json({ message: 'Class is not archived' }, 400);
    }

    const unarchived = await prisma.class.update({
      where: { id },
      data: { isArchived: false },
      include: CLASS_DETAIL_INCLUDE,
    });

    return c.json(
      {
        message: `Class "${existing.name}" from ${existing.school.name} has been unarchived`,
        class: unarchived,
      },
      200
    );
  } catch (error) {
    console.error('Error unarchiving class:', error);
    return c.json({ message: 'Server error while unarchiving class' }, 500);
  }
});

classes.post('/:id/teachers/:teacherId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('id');
  const teacherId = c.req.param('teacherId');

  try {
    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) return c.json({ message: 'Class not found' }, 404);

    const teacher = await prisma.user.findUnique({
      where: { id: teacherId, role: 'TEACHER' },
    });
    if (!teacher) return c.json({ message: 'Teacher not found' }, 404);

    const existing = await prisma.teacherClass.findUnique({
      where: { teacherId_classId: { teacherId, classId } },
    });
    if (existing) {
      return c.json({ message: 'Teacher is already assigned to this class' }, 400);
    }

    const created = await prisma.teacherClass.create({
      data: { teacherId, classId },
    });

    const existingTs = await prisma.teacherSchool.findUnique({
      where: { teacherId_schoolId: { teacherId, schoolId: cls.schoolId } },
    });
    if (!existingTs) {
      await prisma.teacherSchool.create({
        data: { teacherId, schoolId: cls.schoolId },
      });
    }

    return c.json(created, 201);
  } catch (error) {
    console.error('Error adding teacher to class:', error);
    return c.json({ message: 'Server error while adding teacher to class' }, 500);
  }
});

classes.delete('/:id/teachers/:teacherId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('id');
  const teacherId = c.req.param('teacherId');

  try {
    const existing = await prisma.teacherClass.findUnique({
      where: { teacherId_classId: { teacherId, classId } },
    });
    if (!existing) {
      return c.json({ message: 'Teacher is not assigned to this class' }, 404);
    }
    await prisma.teacherClass.delete({
      where: { teacherId_classId: { teacherId, classId } },
    });
    return c.json({ message: 'Teacher removed from class successfully' }, 200);
  } catch (error) {
    console.error('Error removing teacher from class:', error);
    return c.json({ message: 'Server error while removing teacher from class' }, 500);
  }
});

classes.post('/:id/students/:studentId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('id');
  const studentId = c.req.param('studentId');

  try {
    const cls = await prisma.class.findUnique({ where: { id: classId } });
    if (!cls) return c.json({ message: 'Class not found' }, 404);

    const student = await prisma.user.findUnique({
      where: { id: studentId, role: 'STUDENT' },
    });
    if (!student) return c.json({ message: 'Student not found' }, 404);

    const existing = await prisma.studentClass.findUnique({
      where: { studentId_classId: { studentId, classId } },
    });
    if (existing) {
      return c.json({ message: 'Student is already assigned to this class' }, 400);
    }

    const created = await prisma.studentClass.create({
      data: { studentId, classId },
    });

    const existingSs = await prisma.studentSchool.findUnique({
      where: { studentId_schoolId: { studentId, schoolId: cls.schoolId } },
    });
    if (!existingSs) {
      await prisma.studentSchool.create({
        data: { studentId, schoolId: cls.schoolId },
      });
    }

    return c.json(created, 201);
  } catch (error) {
    console.error('Error adding student to class:', error);
    return c.json({ message: 'Server error while adding student to class' }, 500);
  }
});

classes.delete('/:id/students/:studentId', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const classId = c.req.param('id');
  const studentId = c.req.param('studentId');

  try {
    const existing = await prisma.studentClass.findUnique({
      where: { studentId_classId: { studentId, classId } },
    });
    if (!existing) {
      return c.json({ message: 'Student is not assigned to this class' }, 404);
    }
    await prisma.studentClass.delete({
      where: { studentId_classId: { studentId, classId } },
    });
    return c.json({ message: 'Student removed from class successfully' }, 200);
  } catch (error) {
    console.error('Error removing student from class:', error);
    return c.json({ message: 'Server error while removing student from class' }, 500);
  }
});

export default classes;
