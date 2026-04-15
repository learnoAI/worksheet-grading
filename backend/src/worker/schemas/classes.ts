import { z } from 'zod';

export const createClassSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  schoolId: z.string().min(1, { message: 'School ID is required' }),
  academicYear: z.string().min(1, { message: 'Academic year is required' }),
});

export const archiveByYearSchema = z.object({
  academicYear: z.string().min(1, { message: 'Academic year is required' }),
  schoolId: z.string().optional(),
});

export const uploadClassTeachersSchema = z.object({
  schoolId: z.string().min(1, { message: 'School ID is required' }),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export const uploadStudentClassesSchema = z.object({
  schoolId: z.string().min(1, { message: 'School ID is required' }),
  rows: z.array(z.record(z.string(), z.unknown())),
});

export type CreateClassInput = z.infer<typeof createClassSchema>;
