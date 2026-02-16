import type { GradingApiResponse } from './types';
import type { GradingResult, QuestionScore } from './schemas';

const TOTAL_POSSIBLE_POINTS = 40;

function partition(scores: QuestionScore[]): {
  correct: QuestionScore[];
  wrong: QuestionScore[];
  unanswered: QuestionScore[];
} {
  const correct: QuestionScore[] = [];
  const wrong: QuestionScore[] = [];
  const unanswered: QuestionScore[] = [];

  for (const s of scores) {
    if (!s.student_answer || s.student_answer.trim().length === 0) {
      unanswered.push(s);
    } else if (s.is_correct) {
      correct.push(s);
    } else {
      wrong.push(s);
    }
  }

  return { correct, wrong, unanswered };
}

interface ToBackendGradingResponseOptions {
  expectedTotalQuestions?: number;
}

function normalizeExpectedTotalQuestions(expectedTotalQuestions: number | undefined): number {
  if (!Number.isFinite(expectedTotalQuestions)) {
    return 0;
  }

  const normalized = Math.trunc(expectedTotalQuestions as number);
  return normalized > 0 ? normalized : 0;
}

function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

export function toBackendGradingResponse(
  result: GradingResult,
  options: ToBackendGradingResponseOptions = {}
): GradingApiResponse {
  const parts = partition(result.question_scores);
  const scoredCount = parts.correct.length + parts.wrong.length + parts.unanswered.length;
  const expectedTotal = normalizeExpectedTotalQuestions(options.expectedTotalQuestions);
  const aiReportedTotal = Number.isFinite(result.total_questions) ? Math.max(0, Math.trunc(result.total_questions || 0)) : 0;
  const totalQuestions = Math.max(scoredCount, expectedTotal, aiReportedTotal);
  const missingScores = Math.max(0, totalQuestions - scoredCount);
  const correctAnswers = parts.correct.length;
  const wrongAnswers = parts.wrong.length;
  const unanswered = parts.unanswered.length + missingScores;
  const gradePercentage = totalQuestions > 0
    ? roundToTwoDecimals((correctAnswers / totalQuestions) * 100)
    : 0;
  const grade = totalQuestions > 0
    ? Math.round((correctAnswers / totalQuestions) * TOTAL_POSSIBLE_POINTS)
    : 0;

  return {
    success: true,
    grade,
    total_possible: TOTAL_POSSIBLE_POINTS,
    grade_percentage: gradePercentage,
    total_questions: totalQuestions,
    correct_answers: correctAnswers,
    wrong_answers: wrongAnswers,
    unanswered,
    question_scores: result.question_scores,
    wrong_questions: parts.wrong,
    correct_questions: parts.correct,
    unanswered_questions: parts.unanswered,
    overall_feedback: result.overall_feedback,
  };
}
