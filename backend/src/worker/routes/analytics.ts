import { Hono } from 'hono';
import { UserRole, Prisma } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import type { AppBindings } from '../types';

/**
 * Analytics routes — full port of `backend/src/routes/analyticsRoutes.ts`.
 *
 * All endpoints require SUPERADMIN. Includes:
 *   GET /schools                        — school list for filter dropdowns
 *   GET /schools/:schoolId/classes      — class list for a school
 *   GET /overall                        — aggregated grading metrics
 *   GET /students                       — paginated student-level analytics
 *   GET /students/download              — CSV export of student analytics
 *
 * The Express version had an in-process cache (5-min TTL with `setInterval`
 * cleanup). That cache was **already commented out** in production code, so
 * the Hono port simply omits it — every request hits the DB. If we need
 * caching later, a per-isolate Map or KV layer can be added without route
 * changes.
 */

function convertToFullDayRange(startDateStr: string, endDateStr: string) {
  const start = new Date(startDateStr);
  const end = new Date(endDateStr);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}
const analytics = new Hono<AppBindings>();

analytics.use('*', authenticate);
analytics.use('*', authorize([UserRole.SUPERADMIN]));

analytics.get('/schools', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const includeArchived = c.req.query('includeArchived') === 'true';
  const where: Prisma.SchoolWhereInput = includeArchived ? {} : { isArchived: false };

  try {
    const rows = await prisma.school.findMany({
      where,
      select: { id: true, name: true, isArchived: true },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error getting schools:', error);
    return c.json({ message: 'Server error while retrieving schools' }, 500);
  }
});

analytics.get('/schools/:schoolId/classes', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const schoolId = c.req.param('schoolId');
  const includeArchived = c.req.query('includeArchived') === 'true';

  const where: Prisma.ClassWhereInput = { schoolId };
  if (!includeArchived) {
    where.isArchived = false;
    // Match Express behavior: also exclude classes under archived schools.
    where.school = { isArchived: false };
  }

  try {
    const rows = await prisma.class.findMany({
      where,
      select: { id: true, name: true, schoolId: true, isArchived: true },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error getting classes by school:', error);
    return c.json({ message: 'Server error while retrieving classes' }, 500);
  }
});

// ---------- Heavy analytics ----------

analytics.get('/overall', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const schoolIdsRaw = c.req.queries('schoolIds');

  if (!startDate || !endDate) {
    return c.json({ message: 'Start date and end date are required' }, 400);
  }

  try {
    const { start, end } = convertToFullDayRange(startDate, endDate);

    const filter: Prisma.WorksheetWhereInput = {
      submittedOn: { gte: start, lte: end },
      class: {
        isArchived: false,
        school: { isArchived: false },
      },
    };

    if (schoolIdsRaw && schoolIdsRaw.length > 0) {
      const schoolIdArray = Array.isArray(schoolIdsRaw) ? schoolIdsRaw.flat() : [schoolIdsRaw];
      filter.class = {
        ...filter.class as object,
        schoolId: { in: schoolIdArray as string[] },
      };
    }

    const [
      totalStats,
      absentStats,
      repeatedStats,
      gradedStats,
      highScoreStats,
      excellenceStats,
    ] = await Promise.all([
      prisma.worksheet.count({
        where: {
          ...filter,
          NOT: { AND: [{ isAbsent: false }, { grade: null }] },
        },
      }),
      prisma.worksheet.count({ where: { ...filter, isAbsent: true } }),
      prisma.worksheet.count({ where: { ...filter, isRepeated: true } }),
      prisma.worksheet.count({
        where: { ...filter, grade: { not: null }, isAbsent: false },
      }),
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count
        FROM "Worksheet" w
        LEFT JOIN "Class" c ON w."classId" = c.id
        LEFT JOIN "School" s ON c."schoolId" = s.id
        WHERE w."submittedOn" >= ${start}::timestamp
        AND w."submittedOn" <= ${end}::timestamp
        AND w.grade IS NOT NULL
        AND w."isAbsent" = false
        AND w.grade >= (COALESCE(w."outOf", 40) * 0.8)
        AND c."isArchived" = false
        AND s."isArchived" = false
        ${
          schoolIdsRaw && schoolIdsRaw.length > 0
            ? Prisma.sql`AND c."schoolId" = ANY(${schoolIdsRaw.flat()}::text[])`
            : Prisma.empty
        }
      `,
      prisma.$queryRaw<Array<{ count: bigint }>>`
        SELECT COUNT(*)::bigint as count
        FROM "Worksheet" w
        LEFT JOIN "Class" c ON w."classId" = c.id
        LEFT JOIN "School" s ON c."schoolId" = s.id
        WHERE w."submittedOn" >= ${start}::timestamp
        AND w."submittedOn" <= ${end}::timestamp
        AND w.grade IS NOT NULL
        AND w."isAbsent" = false
        AND w.grade >= (COALESCE(w."outOf", 40) * 0.9)
        AND c."isArchived" = false
        AND s."isArchived" = false
        ${
          schoolIdsRaw && schoolIdsRaw.length > 0
            ? Prisma.sql`AND c."schoolId" = ANY(${schoolIdsRaw.flat()}::text[])`
            : Prisma.empty
        }
      `,
    ]);

    const totalWorksheets = totalStats;
    const totalAbsent = absentStats;
    const totalRepeated = repeatedStats;
    const totalGraded = gradedStats;
    const absentPercentage = totalWorksheets > 0 ? (totalAbsent / totalWorksheets) * 100 : 0;
    const repetitionRate =
      totalWorksheets - totalAbsent > 0
        ? (totalRepeated / (totalWorksheets - totalAbsent)) * 100
        : 0;
    const highScoreCount = Number(highScoreStats[0]?.count || 0);
    const highScorePercentage = totalGraded > 0 ? (highScoreCount / totalGraded) * 100 : 0;
    const excellenceScoreCount = Number(excellenceStats[0]?.count || 0);
    const excellenceScorePercentage = totalGraded > 0 ? (excellenceScoreCount / totalGraded) * 100 : 0;
    const needsRepetitionCount = totalGraded - highScoreCount;
    const needsRepetitionPercentage = totalGraded > 0 ? (needsRepetitionCount / totalGraded) * 100 : 0;

    return c.json(
      {
        totalWorksheets,
        totalAbsent,
        absentPercentage,
        totalRepeated,
        repetitionRate,
        highScoreCount,
        highScorePercentage,
        excellenceScoreCount,
        excellenceScorePercentage,
        totalGraded,
        needsRepetitionCount,
        needsRepetitionPercentage,
      },
      200
    );
  } catch (error) {
    console.error('Error getting overall analytics:', error);
    return c.json({ message: 'Server error while retrieving analytics data' }, 500);
  }
});

analytics.get('/students/download', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const schoolId = c.req.query('schoolId');
  const classId = c.req.query('classId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const format = c.req.query('format') ?? 'csv';

  try {
    const filter: Prisma.UserWhereInput = {
      role: 'STUDENT',
      isArchived: false,
      studentClasses: {
        some: {
          class: {
            isArchived: false,
            school: { isArchived: false },
            ...(classId ? { id: classId } : {}),
            ...(schoolId && !classId ? { schoolId } : {}),
          },
        },
      },
    };

    const dateWhere =
      startDate && endDate
        ? (() => {
            const { start, end } = convertToFullDayRange(startDate, endDate);
            return { submittedOn: { gte: start, lte: end } };
          })()
        : {};

    const students = await prisma.user.findMany({
      where: filter,
      select: {
        id: true,
        username: true,
        name: true,
        tokenNumber: true,
        isArchived: true,
        studentClasses: {
          where: {
            class: { isArchived: false, school: { isArchived: false } },
          },
          include: { class: { include: { school: true } } },
        },
        studentWorksheets: {
          select: {
            id: true,
            submittedOn: true,
            isAbsent: true,
            isRepeated: true,
            grade: true,
            class: {
              select: {
                isArchived: true,
                school: { select: { isArchived: true } },
              },
            },
          },
          where: {
            ...dateWhere,
            class: { isArchived: false, school: { isArchived: false } },
          },
          orderBy: { submittedOn: 'asc' },
        },
      },
    });

    const rows = students
      .map((student) => {
        const worksheets = student.studentWorksheets;
        const allWorksheets = worksheets.length;
        const absences = worksheets.filter((w) => w.isAbsent).length;
        const repetitions = worksheets.filter((w) => w.isRepeated).length;
        const totalWorksheets = allWorksheets - absences;
        const gradedNonAbsent = worksheets.filter((w) => !w.isAbsent && w.grade !== null);
        const averageGrade =
          gradedNonAbsent.length > 0
            ? gradedNonAbsent.reduce((s, w) => s + (w.grade || 0), 0) / gradedNonAbsent.length
            : 0;
        const datedWorksheets = worksheets.filter((w) => w.submittedOn !== null);
        const first = datedWorksheets[0];
        const last = datedWorksheets.at(-1);
        const primaryClass = student.studentClasses[0]?.class;
        if (!primaryClass?.school) return null;
        return {
          name: student.name,
          username: student.username,
          tokenNumber: student.tokenNumber ?? '',
          school: primaryClass.school.name,
          class: primaryClass.name,
          isArchived: student.isArchived,
          totalWorksheets,
          absentCount: absences,
          absentPercentage: allWorksheets > 0 ? Number(((absences / allWorksheets) * 100).toFixed(2)) : 0,
          repeatedCount: repetitions,
          repetitionRate:
            allWorksheets - absences > 0
              ? Number(((repetitions / (allWorksheets - absences)) * 100).toFixed(2))
              : 0,
          averageGrade: Number(averageGrade.toFixed(2)),
          firstWorksheetDate: first?.submittedOn?.toISOString().split('T')[0] ?? '',
          lastWorksheetDate: last?.submittedOn?.toISOString().split('T')[0] ?? '',
        };
      })
      .filter((r): r is NonNullable<typeof r> => r !== null);

    if (format === 'csv') {
      const headers = [
        'Name',
        'Username',
        'Token Number',
        'School',
        'Class',
        'Status',
        'Total Worksheets',
        'Absent Count',
        'Absent Percentage (%)',
        'Repeated Count',
        'Repetition Rate (%)',
        'Average Grade',
        'First Worksheet Date',
        'Last Worksheet Date',
      ];
      const csvRows = rows.map((r) =>
        [
          `"${r.name}"`,
          `"${r.username}"`,
          `"${r.tokenNumber}"`,
          `"${r.school}"`,
          `"${r.class}"`,
          r.isArchived ? 'Archived' : 'Active',
          r.totalWorksheets,
          r.absentCount,
          r.absentPercentage,
          r.repeatedCount,
          r.repetitionRate,
          r.averageGrade,
          `"${r.firstWorksheetDate}"`,
          `"${r.lastWorksheetDate}"`,
        ].join(',')
      );
      const csvContent = [headers.join(','), ...csvRows].join('\n');
      const timestamp = new Date().toISOString().split('T')[0];
      let filename = `student_analytics_${timestamp}.csv`;
      if (startDate && endDate) {
        const s = new Date(startDate).toISOString().split('T')[0];
        const e = new Date(endDate).toISOString().split('T')[0];
        filename = `student_analytics_${s}_to_${e}.csv`;
      }
      return new Response(csvContent, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="${filename}"`,
        },
      });
    }

    return c.json(rows, 200);
  } catch (error) {
    console.error('Error downloading student analytics:', error);
    return c.json(
      { message: 'Server error while downloading student analytics data' },
      500
    );
  }
});

analytics.get('/students', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const schoolId = c.req.query('schoolId');
  const classId = c.req.query('classId');
  const startDate = c.req.query('startDate');
  const endDate = c.req.query('endDate');
  const pageRaw = Number.parseInt(c.req.query('page') ?? '', 10);
  const pageSizeRaw = Number.parseInt(c.req.query('pageSize') ?? '', 10);
  const search = (c.req.query('search') ?? '').trim().toLowerCase();
  const showArchived = c.req.query('showArchived') ?? 'active';

  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const pageSize = Number.isFinite(pageSizeRaw) && pageSizeRaw > 0 ? Math.min(pageSizeRaw, 100) : 20;
  const skip = (page - 1) * pageSize;

  try {
    const filter: Prisma.UserWhereInput = { role: 'STUDENT' };

    if (showArchived === 'active') filter.isArchived = false;
    else if (showArchived === 'archived') filter.isArchived = true;

    if (search) {
      filter.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { username: { contains: search, mode: 'insensitive' } },
        { tokenNumber: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (classId) {
      filter.studentClasses = {
        some: {
          classId,
          class: { isArchived: false, school: { isArchived: false } },
        },
      };
    } else if (schoolId) {
      filter.studentSchools = {
        some: { schoolId, school: { isArchived: false } },
      };
    }

    const dateWhere =
      startDate && endDate
        ? (() => {
            const { start, end } = convertToFullDayRange(startDate, endDate);
            return { submittedOn: { gte: start, lte: end } };
          })()
        : {};

    const [total, students] = await Promise.all([
      prisma.user.count({ where: filter }),
      prisma.user.findMany({
        where: filter,
        select: {
          id: true,
          username: true,
          name: true,
          tokenNumber: true,
          isArchived: true,
          studentClasses: {
            where: {
              class: { isArchived: false, school: { isArchived: false } },
            },
            include: { class: { include: { school: true } } },
          },
          studentWorksheets: {
            select: {
              id: true,
              submittedOn: true,
              isAbsent: true,
              isRepeated: true,
              grade: true,
            },
            where: {
              ...dateWhere,
              class: { isArchived: false, school: { isArchived: false } },
            },
            orderBy: { submittedOn: 'asc' },
          },
        },
        orderBy: { tokenNumber: 'asc' },
        skip,
        take: pageSize,
      }),
    ]);

    const studentsWithAnalytics = students.map((student) => {
      const worksheets = student.studentWorksheets;
      const allWorksheets = worksheets.length;
      const absences = worksheets.filter((w) => w.isAbsent).length;
      const repetitions = worksheets.filter((w) => w.isRepeated).length;
      const totalWorksheets = allWorksheets - absences;
      const datedWorksheets = worksheets.filter((w) => w.submittedOn !== null);
      const first = datedWorksheets[0];
      const last = datedWorksheets.at(-1);
      const primaryClass = student.studentClasses[0]?.class;
      return {
        id: student.id,
        name: student.name,
        username: student.username,
        tokenNumber: student.tokenNumber,
        isArchived: student.isArchived || false,
        class: primaryClass ? primaryClass.name : 'No Active Class',
        school: primaryClass ? primaryClass.school.name : 'No Active School',
        totalWorksheets,
        absentCount: absences,
        absentPercentage: allWorksheets > 0 ? (absences / allWorksheets) * 100 : 0,
        repeatedCount: repetitions,
        repetitionRate:
          allWorksheets - absences > 0
            ? (repetitions / (allWorksheets - absences)) * 100
            : 0,
        firstWorksheetDate: first?.submittedOn?.toISOString() ?? null,
        lastWorksheetDate: last?.submittedOn?.toISOString() ?? null,
      };
    });

    return c.json(
      {
        students: studentsWithAnalytics,
        total,
        page,
        pageSize,
        totalPages: Math.ceil(total / pageSize),
      },
      200
    );
  } catch (error) {
    console.error('Error fetching student analytics:', error);
    return c.json(
      { message: 'Server error while retrieving student analytics data' },
      500
    );
  }
});

export default analytics;
