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
