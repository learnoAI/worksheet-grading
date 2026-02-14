import type { GradingApiResponse } from './types';
import type { GradingResult, QuestionScore } from './schemas';

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

export function toBackendGradingResponse(result: GradingResult): GradingApiResponse {
  const parts = partition(result.question_scores);

  return {
    success: true,
    grade: result.overall_score,
    total_possible: 40,
    grade_percentage: result.grade_percentage,
    total_questions: result.total_questions,
    correct_answers: result.correct_answers,
    wrong_answers: result.wrong_answers,
    unanswered: result.unanswered,
    question_scores: result.question_scores,
    wrong_questions: parts.wrong,
    correct_questions: parts.correct,
    unanswered_questions: parts.unanswered,
    overall_feedback: result.overall_feedback,
  };
}
