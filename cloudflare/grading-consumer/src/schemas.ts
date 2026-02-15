import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

// Zod is the source of truth for validation (what we accept).
// The JSON Schema objects below are what we ask Gemini to produce (structured output).

export const ExtractedQuestionSchema = z
  .object({
    question_number: z.number().int(),
    question: z.string(),
    student_answer: z.string(),
  })
  .strict();

export const ExtractedQuestionsSchema = z
  .object({
    questions: z.array(ExtractedQuestionSchema),
  })
  .strict();

export type ExtractedQuestions = z.infer<typeof ExtractedQuestionsSchema>;

export const QuestionScoreSchema = z
  .object({
    question_number: z.number().int(),
    question: z.string(),
    student_answer: z.string(),
    correct_answer: z.string(),
    points_earned: z.number(),
    max_points: z.number(),
    is_correct: z.boolean(),
    feedback: z.string(),
  })
  .strict();

export type QuestionScore = z.infer<typeof QuestionScoreSchema>;

export const GradingResultSchema = z
  .object({
    total_questions: z.number().int(),
    overall_score: z.number(),
    grade_percentage: z.number(),
    question_scores: z.array(QuestionScoreSchema),
    correct_answers: z.number().int(),
    wrong_answers: z.number().int(),
    unanswered: z.number().int(),
    overall_feedback: z.string(),
    // Some graders include extra narrative fields; allow it without affecting persistence.
    reason_why: z.string().optional(),
  })
  .strict();

export type GradingResult = z.infer<typeof GradingResultSchema>;

// Gemini structured output schema derived from the Zod definitions above.
// Docs: https://ai.google.dev/gemini-api/docs/structured-output
export const ExtractedQuestionsJsonSchema = zodToJsonSchema(ExtractedQuestionsSchema, 'ExtractedQuestions');
export const GradingResultJsonSchema = zodToJsonSchema(GradingResultSchema, 'GradingResult');
