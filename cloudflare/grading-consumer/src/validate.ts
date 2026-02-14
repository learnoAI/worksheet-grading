import { ExtractedQuestions, GradingResult, QuestionScore } from './types';

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function assertExtractedQuestions(value: unknown): ExtractedQuestions {
  if (!isObject(value) || !Array.isArray((value as any).questions)) {
    throw new Error('OCR result is missing questions[]');
  }

  for (const q of (value as any).questions) {
    if (!isObject(q)) throw new Error('OCR question is not an object');
    if (typeof (q as any).question_number !== 'number') throw new Error('OCR question_number must be a number');
    if (typeof (q as any).question !== 'string') throw new Error('OCR question must be a string');
    if (typeof (q as any).student_answer !== 'string') throw new Error('OCR student_answer must be a string');
  }

  return value as ExtractedQuestions;
}

function assertQuestionScore(value: unknown): QuestionScore {
  if (!isObject(value)) throw new Error('question_scores item is not an object');
  const v: any = value;

  if (typeof v.question_number !== 'number') throw new Error('question_number must be a number');
  if (typeof v.question !== 'string') throw new Error('question must be a string');
  if (typeof v.student_answer !== 'string') throw new Error('student_answer must be a string');
  if (typeof v.correct_answer !== 'string') throw new Error('correct_answer must be a string');
  if (typeof v.points_earned !== 'number') throw new Error('points_earned must be a number');
  if (typeof v.max_points !== 'number') throw new Error('max_points must be a number');
  if (typeof v.is_correct !== 'boolean') throw new Error('is_correct must be a boolean');
  if (typeof v.feedback !== 'string') throw new Error('feedback must be a string');
  return value as QuestionScore;
}

export function assertGradingResult(value: unknown): GradingResult {
  if (!isObject(value)) {
    throw new Error('Grading result is not an object');
  }

  const v: any = value;
  if (typeof v.total_questions !== 'number') throw new Error('total_questions must be a number');
  if (typeof v.overall_score !== 'number') throw new Error('overall_score must be a number');
  if (typeof v.grade_percentage !== 'number') throw new Error('grade_percentage must be a number');
  if (!Array.isArray(v.question_scores)) throw new Error('question_scores must be an array');
  if (typeof v.correct_answers !== 'number') throw new Error('correct_answers must be a number');
  if (typeof v.wrong_answers !== 'number') throw new Error('wrong_answers must be a number');
  if (typeof v.unanswered !== 'number') throw new Error('unanswered must be a number');
  if (typeof v.overall_feedback !== 'string') throw new Error('overall_feedback must be a string');

  v.question_scores = v.question_scores.map(assertQuestionScore);
  return value as GradingResult;
}

