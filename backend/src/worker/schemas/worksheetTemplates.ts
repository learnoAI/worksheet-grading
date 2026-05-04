import { z } from 'zod';

const worksheetNumberOptional = z.union([z.number().int(), z.string()]).optional();

export const createWorksheetTemplateSchema = z.object({
  worksheetNumber: worksheetNumberOptional,
});

export const updateWorksheetTemplateSchema = z.object({
  worksheetNumber: worksheetNumberOptional,
});

export const addTemplateImageSchema = z.object({
  imageUrl: z.string().min(1, { message: 'Image URL is required' }),
  pageNumber: z.union([z.number().int(), z.string()]),
});

export const addTemplateQuestionSchema = z.object({
  question: z.string().min(1, { message: 'Question is required' }),
  answer: z.string().nullish(),
  outOf: z.union([z.number(), z.string()]).optional(),
  skillIds: z.array(z.string()).optional(),
});

export const updateTemplateQuestionSchema = z.object({
  question: z.string().optional(),
  answer: z.string().optional(),
  outOf: z.union([z.number(), z.string()]).optional(),
  skillIds: z.array(z.string()).optional(),
});

export const createMathSkillSchema = z.object({
  name: z.string().min(1, { message: 'Name is required' }),
  description: z.string().optional(),
  mainTopicId: z.string().optional(),
});
