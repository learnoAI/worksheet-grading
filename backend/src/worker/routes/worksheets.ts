import { Hono } from 'hono';
import { ProcessingStatus, UserRole, Prisma, GradingJobStatus } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import { validateQuery, validateJson } from '../validation';
import { callPython } from '../adapters/pythonApi';
import { uploadObject, StorageError } from '../adapters/storage';
import { parseMultipartFiles, imageOnlyFilter, UploadError } from '../uploads';
import {
  buildWorksheetRecommendationFromHistory,
  getEffectiveWorksheetNumber,
  type WorksheetHistoryEntry,
} from '../adapters/worksheetRecommendation';
import {
  findWorksheetQuerySchema,
  historyQuerySchema,
  classDateQuerySchema,
  gradeWorksheetSchema,
  updateAdminCommentsSchema,
  checkRepeatedSchema,
  batchSaveSchema,
  pythonImagesSchema,
  pythonGradingDetailsSchema,
  totalAiGradedSchema,
  recommendNextSchema,
  incorrectGradingQuerySchema,
} from '../schemas/worksheets';
import type { AppBindings } from '../types';

function getFirstPositiveNumber(
  ...values: Array<number | null | undefined>
): number | null {
  for (const value of values) {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
      return value;
    }
  }
  return null;
}

function parseWorksheetNumberFromNotes(
  notes: string | null | undefined
): number | null {
  if (!notes) return null;
  const match = notes.match(/worksheet\s*#?\s*(\d+)/i);
  if (!match) return null;
  const parsed = Number.parseInt(match[1], 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

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
const requireSuperadmin = authorize([UserRole.SUPERADMIN]);

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

/**
 * `GET /api/worksheets/class-date` — batched class-day summary.
 *
 * For every student in a class, returns (a) their worksheets from the
 * given calendar day, or (b) a progression recommendation computed from
 * their history when they have no worksheets that day. The recommendation
 * has a fallback chain: current-class history → any-class latest-day
 * history, to keep students on track after academic-year class moves.
 *
 * All date math is UTC-anchored; the input `submittedOn` is treated as a
 * local-date string and converted to `[startOfDay, startOfNextDay)` range
 * against UTC — matching Express exactly.
 */
worksheets.get(
  '/class-date',
  requireAuthoringRole,
  validateQuery(classDateQuerySchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { classId, submittedOn: dateStr } = c.req.valid('query');
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) {
      return c.json({ message: 'submittedOn must be a valid date' }, 400);
    }
    const startDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())
    );
    const endDate = new Date(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1)
    );

    try {
      // Students in the class (excluding archived)
      const studentClasses = await prisma.studentClass.findMany({
        where: { classId, student: { isArchived: false } },
        include: {
          student: { select: { id: true, name: true, tokenNumber: true } },
        },
      });
      const students = studentClasses.map((sc) => sc.student);
      const studentIds = students.map((s) => s.id);

      // Worksheets for the day
      const worksheetsOnDate = await prisma.worksheet.findMany({
        where: {
          classId,
          studentId: { in: studentIds },
          submittedOn: { gte: startDate, lt: endDate },
        },
        include: {
          template: { select: { id: true, worksheetNumber: true } },
          images: { orderBy: { pageNumber: 'asc' } },
        },
        orderBy: { createdAt: 'asc' },
      });

      // Group by student
      const worksheetsByStudent: Record<string, typeof worksheetsOnDate> = {};
      for (const ws of worksheetsOnDate) {
        if (!ws.studentId) continue;
        if (!worksheetsByStudent[ws.studentId]) worksheetsByStudent[ws.studentId] = [];
        worksheetsByStudent[ws.studentId].push(ws);
      }

      // Stats
      const studentsWithWorksheets = new Set<string>();
      let gradedCount = 0;
      let absentCount = 0;
      let pendingCount = 0;
      for (const ws of worksheetsOnDate) {
        if (ws.studentId) studentsWithWorksheets.add(ws.studentId);
        if (ws.isAbsent) {
          absentCount++;
        } else if (ws.grade !== null && ws.status === ProcessingStatus.COMPLETED) {
          gradedCount++;
        } else if (
          ws.status === ProcessingStatus.PENDING ||
          ws.status === ProcessingStatus.PROCESSING
        ) {
          pendingCount++;
        }
      }
      const stats = {
        totalStudents: students.length,
        studentsWithWorksheets: studentsWithWorksheets.size,
        gradedCount,
        absentCount,
        pendingCount,
      };

      // Recommendations for students without worksheets today
      const studentsWithoutWorksheets = studentIds.filter(
        (id) => !worksheetsByStudent[id]
      );

      const studentSummaries: Record<
        string,
        {
          lastWorksheetNumber: number | null;
          lastGrade: number | null;
          completedWorksheetNumbers: number[];
          recommendedWorksheetNumber: number;
          isRecommendedRepeated: boolean;
        }
      > = {};

      if (studentsWithoutWorksheets.length > 0) {
        const endDateForHistory = new Date(dateStr);
        endDateForHistory.setHours(23, 59, 59, 999);
        const progressionThresholdRaw = Number.parseInt(
          c.env?.PROGRESSION_THRESHOLD ?? '',
          10
        );
        const progressionThreshold =
          Number.isFinite(progressionThresholdRaw) && progressionThresholdRaw > 0
            ? progressionThresholdRaw
            : 32;

        // Current-class history
        const historyData = await prisma.worksheet.findMany({
          where: {
            classId,
            studentId: { in: studentsWithoutWorksheets },
            submittedOn: { lt: endDateForHistory },
            status: ProcessingStatus.COMPLETED,
            isAbsent: false,
            grade: { not: null },
          },
          select: {
            studentId: true,
            grade: true,
            submittedOn: true,
            createdAt: true,
            worksheetNumber: true,
            template: { select: { worksheetNumber: true } },
          },
          orderBy: [
            { submittedOn: 'desc' },
            { createdAt: 'desc' },
            { worksheetNumber: 'desc' },
          ],
        });

        // Students with NO current-class history need prior-class fallback.
        const studentIdsWithHistory = new Set(historyData.map((h) => h.studentId));
        const newStudentIds = studentsWithoutWorksheets.filter(
          (id) => !studentIdsWithHistory.has(id)
        );

        const priorClassHistoryMap = new Map<string, WorksheetHistoryEntry[]>();
        if (newStudentIds.length > 0) {
          const latestDates = await Promise.all(
            newStudentIds.map((sid) =>
              prisma.worksheet.findFirst({
                where: {
                  studentId: sid,
                  submittedOn: { lt: endDateForHistory },
                  status: ProcessingStatus.COMPLETED,
                  isAbsent: false,
                  grade: { not: null },
                },
                select: { studentId: true, submittedOn: true },
                orderBy: { submittedOn: 'desc' },
              })
            )
          );

          const dayQueries = latestDates
            .filter(
              (r): r is { studentId: string | null; submittedOn: Date } =>
                r !== null && r.submittedOn !== null
            )
            .map((r) =>
              prisma.worksheet.findMany({
                where: {
                  studentId: r.studentId!,
                  submittedOn: r.submittedOn!,
                  status: ProcessingStatus.COMPLETED,
                  isAbsent: false,
                  grade: { not: null },
                },
                select: {
                  studentId: true,
                  worksheetNumber: true,
                  grade: true,
                  submittedOn: true,
                  createdAt: true,
                  template: { select: { worksheetNumber: true } },
                },
              })
            );
          const dayResults = await Promise.all(dayQueries);

          for (const worksheets of dayResults) {
            if (worksheets.length > 0) {
              const sid = worksheets[0].studentId!;
              priorClassHistoryMap.set(
                sid,
                worksheets.map((w) => ({
                  grade: w.grade,
                  submittedOn: w.submittedOn,
                  createdAt: w.createdAt,
                  effectiveWorksheetNumber: getEffectiveWorksheetNumber(
                    w.worksheetNumber,
                    w.template?.worksheetNumber ?? null
                  ),
                }))
              );
            }
          }
        }

        for (const studentId of studentsWithoutWorksheets) {
          const studentHistory = historyData
            .filter((h) => h.studentId === studentId)
            .map((h) => ({
              grade: h.grade,
              submittedOn: h.submittedOn,
              createdAt: h.createdAt,
              effectiveWorksheetNumber: getEffectiveWorksheetNumber(
                h.worksheetNumber,
                h.template?.worksheetNumber ?? null
              ),
            }));

          const priorHistory = priorClassHistoryMap.get(studentId);
          const historyForRecommendation =
            studentHistory.length > 0 ? studentHistory : (priorHistory ?? []);

          const recommendation = buildWorksheetRecommendationFromHistory(
            historyForRecommendation,
            progressionThreshold
          );

          studentSummaries[studentId] = {
            lastWorksheetNumber: recommendation.lastWorksheetNumber,
            lastGrade: recommendation.lastGrade,
            completedWorksheetNumbers: recommendation.completedWorksheetNumbers,
            recommendedWorksheetNumber: recommendation.recommendedWorksheetNumber,
            isRecommendedRepeated: recommendation.isRecommendedRepeated,
          };
        }
      }

      return c.json(
        { students, worksheetsByStudent, studentSummaries, stats },
        200
      );
    } catch (error) {
      console.error('Get class worksheets for date error:', error);
      return c.json(
        { message: 'Server error while retrieving class worksheets' },
        500
      );
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

/**
 * `GET /api/worksheets/incorrect-grading` — paginated moderation feed.
 *
 * Returns worksheets flagged with `isIncorrectGrade=true` that have
 * completed grading. Images come from three possible sources, in order of
 * preference:
 *   1. Directly attached `WorksheetImage` rows.
 *   2. `GradingJobImage` rows on a linked `GradingJob` (same `worksheetId`).
 *   3. `GradingJobImage` rows on a *matching* GradingJob found by
 *      (studentId, classId, worksheetNumber, same UTC day) when the
 *      worksheet row itself has no explicit `worksheetId` link — this
 *      happens for legacy rows that predate the lease-based lifecycle.
 *
 * All three paths mirror the Express implementation 1:1; the fallback
 * logic handles production data that has accumulated over multiple
 * grading-pipeline migrations.
 */
worksheets.get(
  '/incorrect-grading',
  requireSuperadmin,
  validateQuery(incorrectGradingQuerySchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { page = 1, pageSize = 10, startDate, endDate } = c.req.valid('query');

    const where: Prisma.WorksheetWhereInput = {
      isIncorrectGrade: true,
      status: ProcessingStatus.COMPLETED,
    };

    const startBoundary = startDate ? parseDateInputToUtcStart(String(startDate)) : null;
    const endBoundary = endDate ? parseDateInputToUtcEndExclusive(String(endDate)) : null;

    if ((startDate && !startBoundary) || (endDate && !endBoundary)) {
      return c.json({ message: 'Invalid startDate/endDate values' }, 400);
    }
    if (startBoundary && endBoundary && startBoundary >= endBoundary) {
      return c.json({ message: 'startDate must be before or equal to endDate' }, 400);
    }

    if (startBoundary || endBoundary) {
      const dateRange: { gte?: Date; lt?: Date } = {};
      if (startBoundary) dateRange.gte = startBoundary;
      if (endBoundary) dateRange.lt = endBoundary;
      where.AND = [{ OR: [{ submittedOn: dateRange }, { createdAt: dateRange }] }];
    }

    const skip = (page - 1) * pageSize;

    try {
      const [total, worksheetsRows] = await prisma.$transaction([
        prisma.worksheet.count({ where }),
        prisma.worksheet.findMany({
          where,
          select: {
            id: true,
            notes: true,
            grade: true,
            submittedOn: true,
            classId: true,
            studentId: true,
            createdAt: true,
            updatedAt: true,
            gradingDetails: true,
            wrongQuestionNumbers: true,
            adminComments: true,
            worksheetNumber: true,
            student: { select: { id: true, name: true, tokenNumber: true } },
            submittedBy: { select: { name: true, username: true } },
            class: { select: { name: true } },
            template: { select: { worksheetNumber: true } },
            images: {
              select: { imageUrl: true, pageNumber: true },
              orderBy: { pageNumber: 'asc' },
            },
          },
          orderBy: [
            { submittedOn: 'desc' },
            { worksheetNumber: 'asc' },
            { updatedAt: 'desc' },
            { id: 'asc' },
          ],
          skip,
          take: pageSize,
        }),
      ]);

      const worksheetIds = worksheetsRows.map((w) => w.id);
      const gradingJobsWithImages =
        worksheetIds.length > 0
          ? await prisma.gradingJob.findMany({
              where: {
                worksheetId: { in: worksheetIds },
                status: GradingJobStatus.COMPLETED,
              },
              select: {
                worksheetId: true,
                worksheetNumber: true,
                updatedAt: true,
                images: {
                  select: { imageUrl: true, pageNumber: true },
                  orderBy: { pageNumber: 'asc' },
                },
              },
            })
          : [];

      // Pick the "best" linked job per worksheet: most images, then newest.
      const jobContextByWorksheet = new Map<
        string,
        {
          updatedAtMs: number;
          images: Array<{ imageUrl: string; pageNumber: number }>;
          worksheetNumber: number | null;
        }
      >();
      for (const job of gradingJobsWithImages) {
        if (!job.worksheetId || job.images.length === 0) continue;
        const updatedAtMs = job.updatedAt.getTime();
        const jobWsNum = getFirstPositiveNumber(job.worksheetNumber);
        const existing = jobContextByWorksheet.get(job.worksheetId);
        if (!existing) {
          jobContextByWorksheet.set(job.worksheetId, {
            updatedAtMs,
            images: job.images,
            worksheetNumber: jobWsNum,
          });
          continue;
        }
        const shouldReplace =
          job.images.length > existing.images.length ||
          (job.images.length === existing.images.length &&
            updatedAtMs > existing.updatedAtMs) ||
          (existing.worksheetNumber === null && jobWsNum !== null);
        if (shouldReplace) {
          jobContextByWorksheet.set(job.worksheetId, {
            updatedAtMs,
            images: job.images,
            worksheetNumber: jobWsNum,
          });
        }
      }

      // Fallback: for worksheets without direct images AND without a
      // linked-job match, search by (studentId, classId, worksheetNumber, day).
      const unresolvedWorksheets = worksheetsRows.filter((w) => {
        if (w.images.length > 0) return false;
        const imgs = jobContextByWorksheet.get(w.id)?.images ?? [];
        return imgs.length === 0;
      });

      if (unresolvedWorksheets.length > 0) {
        const unresolvedStudentIds = Array.from(
          new Set(
            unresolvedWorksheets
              .map((w) => w.studentId)
              .filter((sid): sid is string => !!sid)
          )
        );
        const unresolvedClassIds = Array.from(
          new Set(unresolvedWorksheets.map((w) => w.classId))
        );
        const unresolvedWorksheetNumbers = Array.from(
          new Set(
            unresolvedWorksheets
              .map((w) =>
                getFirstPositiveNumber(
                  w.worksheetNumber,
                  w.template?.worksheetNumber ?? null,
                  jobContextByWorksheet.get(w.id)?.worksheetNumber ?? null,
                  parseWorksheetNumberFromNotes(w.notes)
                )
              )
              .filter((n): n is number => n !== null)
          )
        );

        if (
          unresolvedStudentIds.length > 0 &&
          unresolvedClassIds.length > 0 &&
          unresolvedWorksheetNumbers.length > 0
        ) {
          const fallbackJobs = await prisma.gradingJob.findMany({
            where: {
              status: GradingJobStatus.COMPLETED,
              studentId: { in: unresolvedStudentIds },
              classId: { in: unresolvedClassIds },
              worksheetNumber: { in: unresolvedWorksheetNumbers },
            },
            select: {
              studentId: true,
              classId: true,
              worksheetNumber: true,
              submittedOn: true,
              updatedAt: true,
              images: {
                select: { imageUrl: true, pageNumber: true },
                orderBy: { pageNumber: 'asc' },
              },
            },
          });

          const getUtcDayBounds = (date: Date): { start: Date; endExclusive: Date } => {
            const start = new Date(
              Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
            );
            const endExclusive = new Date(start);
            endExclusive.setUTCDate(endExclusive.getUTCDate() + 1);
            return { start, endExclusive };
          };

          for (const w of unresolvedWorksheets) {
            const worksheetNumberForMatching = getFirstPositiveNumber(
              w.worksheetNumber,
              w.template?.worksheetNumber ?? null,
              jobContextByWorksheet.get(w.id)?.worksheetNumber ?? null,
              parseWorksheetNumberFromNotes(w.notes)
            );
            if (!w.studentId || !worksheetNumberForMatching) continue;

            const worksheetDateBase = w.submittedOn || w.createdAt;
            const { start, endExclusive } = getUtcDayBounds(worksheetDateBase);

            const candidates = fallbackJobs.filter(
              (job) =>
                job.studentId === w.studentId &&
                job.classId === w.classId &&
                job.worksheetNumber === worksheetNumberForMatching &&
                job.submittedOn >= start &&
                job.submittedOn < endExclusive &&
                job.images.length > 0
            );
            if (candidates.length === 0) continue;

            candidates.sort((a, b) => {
              if (b.images.length !== a.images.length) {
                return b.images.length - a.images.length;
              }
              return b.updatedAt.getTime() - a.updatedAt.getTime();
            });
            const best = candidates[0];
            jobContextByWorksheet.set(w.id, {
              updatedAtMs: best.updatedAt.getTime(),
              images: best.images,
              worksheetNumber: getFirstPositiveNumber(best.worksheetNumber),
            });
          }
        }
      }

      // Shape the response. Express returns a flattened DTO, not the full
      // row — mirror that shape exactly so the admin UI doesn't break.
      const data = worksheetsRows.map((w) => {
        const linkedJobContext = jobContextByWorksheet.get(w.id);
        const effectiveWorksheetNumber =
          getFirstPositiveNumber(
            w.worksheetNumber,
            w.template?.worksheetNumber ?? null,
            linkedJobContext?.worksheetNumber ?? null,
            parseWorksheetNumberFromNotes(w.notes)
          ) || 0;
        return {
          id: w.id,
          worksheetNumber: effectiveWorksheetNumber,
          grade: w.grade || 0,
          submittedOn: w.submittedOn,
          adminComments: w.adminComments,
          wrongQuestionNumbers: w.wrongQuestionNumbers,
          student: {
            name: w.student?.name || 'Unknown',
            tokenNumber: w.student?.tokenNumber || 'N/A',
          },
          submittedBy: {
            name: w.submittedBy.name,
            username: w.submittedBy.username,
          },
          class: { name: w.class.name },
          gradingDetails: w.gradingDetails,
          images: w.images.length > 0 ? w.images : linkedJobContext?.images || [],
        };
      });

      return c.json({ data, total, page, pageSize }, 200);
    } catch (error) {
      console.error('Get incorrect grading worksheets error:', error);
      return c.json(
        { message: 'Server error while retrieving incorrect grading worksheets' },
        500
      );
    }
  }
);

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

// ---------- Multipart worksheet upload ----------

/**
 * `POST /api/worksheets/upload` — multipart upload of worksheet page images.
 *
 * Mirrors the existing Express handler (`uploadWorksheet` in
 * `worksheetController.ts`):
 *   1. Validate class (and optional student-class membership).
 *   2. Create a Worksheet row in PENDING status.
 *   3. Upload each image buffer to R2.
 *   4. Create WorksheetImage rows.
 *   5. Return the created worksheet.
 *
 * Behavioral note: the Express version calls `enqueueWorksheet` (legacy
 * Bull queue). Bull is disabled in production (`ENABLE_LEGACY_BULL_QUEUE=false`),
 * so the enqueue is a no-op there too. We skip it here; the grading
 * dispatch loop picks up PENDING worksheets through its own path.
 */
worksheets.post('/upload', requireAuthoringRole, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  // Parse multipart body, filtered to images only with a 5 MB per-file cap
  // — matches the existing Multer config in `worksheetRoutes.ts`.
  let parsed;
  try {
    parsed = await parseMultipartFiles(c.req.raw, {
      fieldName: 'images',
      maxCount: 10,
      maxFileSizeBytes: 5 * 1024 * 1024,
      fileFilter: imageOnlyFilter,
      requireAtLeastOne: true,
    });
  } catch (err) {
    if (err instanceof UploadError) {
      if (err.code === 'LIMIT_FILE_SIZE' || err.code === 'LIMIT_FILE_COUNT') {
        return c.json({ message: err.message }, 400);
      }
      if (err.code === 'FILTER_REJECTED') {
        return c.json({ message: 'Only image files are allowed' }, 400);
      }
      if (err.code === 'NO_FILES_PROVIDED') {
        return c.json({ message: 'No files uploaded' }, 400);
      }
      if (err.code === 'NO_MULTIPART_BODY') {
        return c.json(
          { message: 'Expected Content-Type to be multipart/form-data' },
          400
        );
      }
    }
    throw err;
  }

  const { files, fields } = parsed;
  const classId = fields.classId;
  const studentId = fields.studentId || null;
  const notes = fields.notes || null;
  const user = c.get('user')!;

  if (!classId) {
    return c.json({ message: 'Class ID is required' }, 400);
  }

  try {
    const classExists = await prisma.class.findUnique({ where: { id: classId } });
    if (!classExists) return c.json({ message: 'Class not found' }, 404);

    if (studentId) {
      const student = await prisma.user.findFirst({
        where: {
          id: studentId,
          role: 'STUDENT',
          studentClasses: { some: { classId } },
        },
      });
      if (!student) {
        return c.json({ message: 'Student not found in this class' }, 404);
      }
    }

    const worksheet = await prisma.worksheet.create({
      data: {
        notes,
        status: ProcessingStatus.PENDING,
        submittedById: user.userId,
        classId,
        studentId,
      },
    });

    // Upload each file to R2 + create a WorksheetImage row for it.
    // pageNumbers may arrive as a string[] on the form; fall back to 1-based
    // ordinal when missing.
    const pageNumbersRaw = fields['pageNumbers[]'] || fields.pageNumbers;
    const pageNumbers = Array.isArray(pageNumbersRaw)
      ? pageNumbersRaw
      : pageNumbersRaw
      ? [pageNumbersRaw]
      : [];

    const images = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pageNumber =
        pageNumbers[i] !== undefined
          ? parseInt(String(pageNumbers[i]), 10)
          : i + 1;

      const timestamp = Date.now();
      const safeName = file.originalname.replace(/\s+/g, '_');
      const key = `worksheets/${worksheet.id}/${timestamp}-page${pageNumber}-${safeName}`;

      const { publicUrl } = await uploadObject(
        c.env ?? {},
        key,
        file.buffer,
        file.mimetype
      );
      if (!publicUrl) {
        throw new StorageError(
          'CONFIG_MISSING',
          'R2_PUBLIC_BASE_URL is required to resolve worksheet image URLs'
        );
      }

      const row = await prisma.worksheetImage.create({
        data: {
          imageUrl: publicUrl,
          pageNumber,
          worksheetId: worksheet.id,
        },
      });
      images.push(row);
    }

    return c.json(
      {
        id: worksheet.id,
        images,
        status: worksheet.status,
        message: 'Worksheet uploaded and queued for processing',
      },
      201
    );
  } catch (error) {
    console.error('Worksheet upload error:', error);
    if (error instanceof StorageError) {
      return c.json(
        { message: `Server error during worksheet upload: ${error.message}` },
        500
      );
    }
    return c.json({ message: 'Server error during worksheet upload' }, 500);
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

// ---------- Recommendation ----------

/**
 * `POST /api/worksheets/recommend-next` — returns the next worksheet a
 * student should attempt based on their graded history.
 *
 * Algorithm: delegates to `adapters/worksheetRecommendation` after loading
 * the student's graded worksheets for the current class. If the student
 * has no history in the current class (e.g. after academic-year onboarding
 * moved them to a new class), we fall back to the latest-day worksheets
 * from *any* class the student was in — the algorithm then continues
 * date-based progression without losing context.
 */
worksheets.post(
  '/recommend-next',
  requireAuthoringRole,
  validateJson(recommendNextSchema),
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ message: 'Database is not available' }, 500);

    const { classId, studentId, beforeDate } = c.req.valid('json');
    const progressionThresholdRaw = Number.parseInt(
      c.env?.PROGRESSION_THRESHOLD ?? '',
      10
    );
    const progressionThreshold =
      Number.isFinite(progressionThresholdRaw) && progressionThresholdRaw > 0
        ? progressionThresholdRaw
        : 32;

    const dateFilter: { lt?: Date } = {};
    if (beforeDate) {
      const before = new Date(beforeDate);
      before.setUTCHours(23, 59, 59, 999);
      dateFilter.lt = before;
    }

    try {
      const worksheetHistory = await prisma.worksheet.findMany({
        where: {
          classId,
          studentId,
          status: ProcessingStatus.COMPLETED,
          isAbsent: false,
          grade: { not: null },
          ...(beforeDate ? { submittedOn: dateFilter } : {}),
        },
        select: {
          grade: true,
          worksheetNumber: true,
          submittedOn: true,
          createdAt: true,
          template: { select: { worksheetNumber: true } },
        },
        orderBy: [
          { submittedOn: 'desc' },
          { createdAt: 'desc' },
          { worksheetNumber: 'desc' },
        ],
      });

      const recommendation = buildWorksheetRecommendationFromHistory(
        worksheetHistory.map((w) => ({
          grade: w.grade,
          submittedOn: w.submittedOn,
          createdAt: w.createdAt,
          effectiveWorksheetNumber: getEffectiveWorksheetNumber(
            w.worksheetNumber,
            w.template?.worksheetNumber ?? null
          ),
        })),
        progressionThreshold
      );

      if (recommendation.lastWorksheetNumber === null) {
        // No history in current class — check prior class history.
        const latestPrior = await prisma.worksheet.findFirst({
          where: {
            studentId,
            status: ProcessingStatus.COMPLETED,
            isAbsent: false,
            grade: { not: null },
            ...(beforeDate ? { submittedOn: dateFilter } : {}),
          },
          select: { submittedOn: true },
          orderBy: { submittedOn: 'desc' },
        });

        if (latestPrior?.submittedOn) {
          const latestDayWorksheets = await prisma.worksheet.findMany({
            where: {
              studentId,
              submittedOn: latestPrior.submittedOn,
              status: ProcessingStatus.COMPLETED,
              isAbsent: false,
              grade: { not: null },
            },
            select: {
              worksheetNumber: true,
              grade: true,
              submittedOn: true,
              createdAt: true,
              template: { select: { worksheetNumber: true } },
            },
          });

          if (latestDayWorksheets.length > 0) {
            const priorRecommendation = buildWorksheetRecommendationFromHistory(
              latestDayWorksheets.map((w) => ({
                grade: w.grade,
                submittedOn: w.submittedOn,
                createdAt: w.createdAt,
                effectiveWorksheetNumber: getEffectiveWorksheetNumber(
                  w.worksheetNumber,
                  w.template?.worksheetNumber ?? null
                ),
              })),
              progressionThreshold
            );
            // Matches the Express response shape exactly: `isRepeated: false`
            // because the student is starting in a new class, not repeating.
            return c.json(
              {
                recommendedWorksheetNumber: priorRecommendation.recommendedWorksheetNumber,
                isRepeated: false,
                lastWorksheetNumber: priorRecommendation.lastWorksheetNumber,
                lastGrade: priorRecommendation.lastGrade,
                progressionThreshold,
              },
              200
            );
          }
        }

        return c.json(
          {
            recommendedWorksheetNumber: 1,
            isRepeated: false,
            lastWorksheetNumber: null,
            lastGrade: null,
            progressionThreshold,
          },
          200
        );
      }

      return c.json(
        {
          recommendedWorksheetNumber: recommendation.recommendedWorksheetNumber,
          isRepeated: recommendation.isRecommendedRepeated,
          lastWorksheetNumber: recommendation.lastWorksheetNumber,
          lastGrade: recommendation.lastGrade,
          progressionThreshold,
        },
        200
      );
    } catch (error) {
      console.error('Get recommended worksheet error:', error);
      return c.json({ message: 'Server error while getting recommendation' }, 500);
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
