import { z } from 'zod';
import { UserRole } from '../../../lib/api/types';

export const createUserSchema = z.object({
  name: z.string().min(1, 'Name is required').max(100, 'Name must be less than 100 characters'),
  username: z.string().min(3, 'Username must be at least 3 characters').max(50, 'Username must be less than 50 characters'),
  password: z.string().min(6, 'Password must be at least 6 characters'),
  role: z.nativeEnum(UserRole),
  tokenNumber: z.string().optional(),
  schoolId: z.string().optional(),
  classIds: z.array(z.string()).optional(),
});

export const loginSchema = z.object({
  username: z.string().min(1, 'Username is required'),
  password: z.string().min(1, 'Password is required'),
});

export const createSchoolSchema = z.object({
  name: z.string().min(1, 'School name is required').max(200, 'School name must be less than 200 characters'),
});

export const editSchoolSchema = z.object({
  id: z.string(),
  name: z.string().min(1, 'School name is required').max(200, 'School name must be less than 200 characters'),
});

export const createClassSchema = z.object({
  name: z.string().min(1, 'Class name is required').max(100, 'Class name must be less than 100 characters'),
  schoolId: z.string().min(1, 'School selection is required'),
});

export const worksheetGradeSchema = z.object({
  studentId: z.string(),
  worksheetNumber: z.number().min(1).max(1000),
  grade: z.string().regex(/^\d{1,2}$/, 'Grade must be a valid number'),
  isAbsent: z.boolean().default(false),
  isRepeated: z.boolean().default(false),
});

export const worksheetSubmissionSchema = z.object({
  classId: z.string().min(1, 'Class selection is required'),
  submittedOn: z.string().min(1, 'Submission date is required'),
  grades: z.array(worksheetGradeSchema),
});

export const mathSkillSchema = z.object({
  name: z.string().min(1, 'Skill name is required').max(100, 'Skill name must be less than 100 characters'),
  description: z.string().max(500, 'Description must be less than 500 characters').optional(),
});

export type CreateUserFormData = z.infer<typeof createUserSchema>;
export type LoginFormData = z.infer<typeof loginSchema>;
export type CreateSchoolFormData = z.infer<typeof createSchoolSchema>;
export type EditSchoolFormData = z.infer<typeof editSchoolSchema>;
export type CreateClassFormData = z.infer<typeof createClassSchema>;
export type WorksheetGradeFormData = z.infer<typeof worksheetGradeSchema>;
export type WorksheetSubmissionFormData = z.infer<typeof worksheetSubmissionSchema>;
export type MathSkillFormData = z.infer<typeof mathSkillSchema>;