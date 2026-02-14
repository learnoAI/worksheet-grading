import { z } from 'zod';

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

// Gemini structured output (JSON Schema subset). Keep this in sync with the Zod schemas above.
// Docs: https://ai.google.dev/gemini-api/docs/structured-output
export const ExtractedQuestionsJsonSchema = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question_number: { type: 'integer' },
          question: { type: 'string' },
          student_answer: { type: 'string' },
        },
        required: ['question_number', 'question', 'student_answer'],
        additionalProperties: false,
        // Non-standard extension supported by Gemini 2.0 to guide key ordering.
        propertyOrdering: ['question_number', 'question', 'student_answer'],
      },
    },
  },
  required: ['questions'],
  additionalProperties: false,
  propertyOrdering: ['questions'],
} as const;

export const GradingResultJsonSchema = {
  type: 'object',
  properties: {
    total_questions: { type: 'integer' },
    overall_score: { type: 'number' },
    grade_percentage: { type: 'number' },
    question_scores: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question_number: { type: 'integer' },
          question: { type: 'string' },
          student_answer: { type: 'string' },
          correct_answer: { type: 'string' },
          points_earned: { type: 'number' },
          max_points: { type: 'number' },
          is_correct: { type: 'boolean' },
          feedback: { type: 'string' },
        },
        required: [
          'question_number',
          'question',
          'student_answer',
          'correct_answer',
          'points_earned',
          'max_points',
          'is_correct',
          'feedback',
        ],
        additionalProperties: false,
        propertyOrdering: [
          'question_number',
          'question',
          'student_answer',
          'correct_answer',
          'points_earned',
          'max_points',
          'is_correct',
          'feedback',
        ],
      },
    },
    correct_answers: { type: 'integer' },
    wrong_answers: { type: 'integer' },
    unanswered: { type: 'integer' },
    overall_feedback: { type: 'string' },
    reason_why: { type: 'string' },
  },
  required: [
    'total_questions',
    'overall_score',
    'grade_percentage',
    'question_scores',
    'correct_answers',
    'wrong_answers',
    'unanswered',
    'overall_feedback',
  ],
  additionalProperties: false,
  propertyOrdering: [
    'total_questions',
    'overall_score',
    'grade_percentage',
    'question_scores',
    'correct_answers',
    'wrong_answers',
    'unanswered',
    'overall_feedback',
    'reason_why',
  ],
} as const;

