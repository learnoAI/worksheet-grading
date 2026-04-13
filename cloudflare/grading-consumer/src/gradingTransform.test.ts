import { describe, expect, it } from 'vitest';
import { toBackendGradingResponse } from './gradingTransform';
import type { GradingResult } from './schemas';

function makeResult(overrides: Partial<GradingResult>): GradingResult {
  return {
    question_scores: [],
    overall_feedback: 'ok',
    ...overrides,
  };
}

describe('toBackendGradingResponse', () => {
  it('computes final grade from correct/total instead of AI-provided overall score', () => {
    const result = makeResult({
      total_questions: 1,
      overall_score: 40,
      grade_percentage: 100,
      correct_answers: 1,
      wrong_answers: 0,
      unanswered: 0,
      question_scores: [
        {
          question_number: 1,
          question: '1+1',
          student_answer: '2',
          correct_answer: '2',
          points_earned: 40,
          max_points: 20,
          is_correct: true,
          feedback: 'good',
        },
        {
          question_number: 2,
          question: '2+2',
          student_answer: '5',
          correct_answer: '4',
          points_earned: 0,
          max_points: 20,
          is_correct: false,
          feedback: 'wrong',
        },
      ],
    });

    const response = toBackendGradingResponse(result);

    expect(response.grade).toBe(20);
    expect(response.grade_percentage).toBe(50);
    expect(response.total_questions).toBe(2);
    expect(response.correct_answers).toBe(1);
    expect(response.wrong_answers).toBe(1);
    expect(response.unanswered).toBe(0);
  });

  it('uses OCR expected total when fewer question_scores are returned', () => {
    const result = makeResult({
      question_scores: [
        {
          question_number: 1,
          question: '1+1',
          student_answer: '2',
          correct_answer: '2',
          points_earned: 40,
          max_points: 40,
          is_correct: true,
          feedback: 'good',
        },
      ],
    });

    const response = toBackendGradingResponse(result, { expectedTotalQuestions: 3 });

    expect(response.total_questions).toBe(3);
    expect(response.correct_answers).toBe(1);
    expect(response.wrong_answers).toBe(0);
    expect(response.unanswered).toBe(2);
    expect(response.grade).toBe(13);
    expect(response.grade_percentage).toBe(33.33);
  });

  it('treats empty student answer as unanswered', () => {
    const result = makeResult({
      question_scores: [
        {
          question_number: 1,
          question: 'spell cat',
          student_answer: '',
          correct_answer: 'cat',
          points_earned: 0,
          max_points: 20,
          is_correct: false,
          feedback: 'unanswered',
        },
        {
          question_number: 2,
          question: '2+2',
          student_answer: '5',
          correct_answer: '4',
          points_earned: 0,
          max_points: 20,
          is_correct: false,
          feedback: 'wrong',
        },
      ],
    });

    const response = toBackendGradingResponse(result);

    expect(response.total_questions).toBe(2);
    expect(response.correct_answers).toBe(0);
    expect(response.wrong_answers).toBe(1);
    expect(response.unanswered).toBe(1);
    expect(response.grade).toBe(0);
    expect(response.grade_percentage).toBe(0);
  });
});

