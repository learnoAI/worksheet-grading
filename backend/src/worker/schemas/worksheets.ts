import { z } from 'zod';

export const findWorksheetQuerySchema = z.object({
  classId: z.string().min(1, { message: 'Class ID is required' }),
  studentId: z.string().min(1, { message: 'Student ID is required' }),
  startDate: z.string().datetime({ message: 'startDate must be a valid ISO date' }),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO date' }),
});

export const historyQuerySchema = z.object({
  classId: z.string().min(1, { message: 'Class ID is required' }),
  studentId: z.string().min(1, { message: 'Student ID is required' }),
  endDate: z.string().datetime({ message: 'endDate must be a valid ISO date' }),
});

export const classDateQuerySchema = z.object({
  classId: z.string().min(1, { message: 'Class ID is required' }),
  submittedOn: z.string().min(1, { message: 'submittedOn is required' }),
});

/**
 * Body accepted by `POST /api/worksheets/grade` (create) and
 * `PUT /api/worksheets/grade/:id` (update). Fields beyond the required
 * `classId` + `studentId` are optional because absent-student submissions
 * and regular grade submissions share the same shape; individual handlers
 * enforce the additional constraints (worksheetNumber > 0 when not absent,
 * grade ∈ [0, 40] when not absent).
 */
export const gradeWorksheetSchema = z.object({
  classId: z.string().min(1, { message: 'Class ID is required' }),
  studentId: z.string().min(1, { message: 'Student ID is required' }),
  worksheetNumber: z.union([z.number(), z.string()]).optional(),
  grade: z.union([z.number(), z.string()]).optional(),
  notes: z.string().nullish(),
  submittedOn: z
    .string()
    .datetime({ message: 'submittedOn must be a valid ISO date' })
    .optional(),
  isAbsent: z.boolean().optional(),
  isRepeated: z.boolean().optional(),
  isIncorrectGrade: z.boolean().optional(),
  gradingDetails: z.unknown().optional(),
  wrongQuestionNumbers: z.array(z.number()).nullable().optional(),
});

export const updateAdminCommentsSchema = z.object({
  adminComments: z.string().nullable().optional(),
});

export const checkRepeatedSchema = z.object({
  classId: z.string().min(1, { message: 'Class ID is required' }),
  studentId: z.string().min(1, { message: 'Student ID is required' }),
  worksheetNumber: z.union([z.number(), z.string()]),
  beforeDate: z.string().datetime({ message: 'beforeDate must be a valid ISO date' }).optional(),
});

export const batchSaveSchema = z.object({
  classId: z.string().min(1, { message: 'Class ID is required' }),
  submittedOn: z.string().datetime({ message: 'submittedOn must be a valid ISO date' }),
  worksheets: z.array(z.record(z.string(), z.unknown())),
});
