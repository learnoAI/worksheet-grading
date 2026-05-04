import { z } from 'zod';
import { UserRole } from '@prisma/client';

const userRoleEnum = z.enum(Object.values(UserRole) as [string, ...string[]]);

export const createUserSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  username: z.string().min(1, { message: 'Username is required' }),
  password: z
    .string()
    .min(6, { message: 'Password must be at least 6 characters' }),
  role: userRoleEnum,
  tokenNumber: z.string().nullish(),
  classId: z.string().nullish(),
  schoolId: z.string().nullish(),
});

export const updateUserSchema = z.object({
  name: z.string().optional(),
  username: z.string().optional(),
  password: z
    .string()
    .min(6, { message: 'Password must be at least 6 characters' })
    .optional(),
  role: userRoleEnum.optional(),
  tokenNumber: z.string().nullable().optional(),
});

export const resetPasswordSchema = z.object({
  newPassword: z
    .string()
    .min(6, { message: 'Password must be at least 6 characters' }),
});

export const uploadCsvSchema = z.object({
  students: z.array(z.record(z.string(), z.unknown())),
});

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
