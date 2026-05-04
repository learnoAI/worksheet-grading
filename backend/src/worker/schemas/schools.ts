import { z } from 'zod';

export const createSchoolSchema = z.object({
  name: z
    .string({ error: 'School name is required' })
    .trim()
    .min(1, { message: 'School name is required' }),
});

export const updateSchoolSchema = z.object({
  name: z.string().trim().min(1, { message: 'School name cannot be empty' }).optional(),
});

export type CreateSchoolInput = z.infer<typeof createSchoolSchema>;
export type UpdateSchoolInput = z.infer<typeof updateSchoolSchema>;
