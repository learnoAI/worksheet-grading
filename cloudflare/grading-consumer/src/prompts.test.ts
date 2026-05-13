import { describe, expect, it } from 'vitest';

import { buildBookGradingPrompt } from './prompts';
import type { ExtractedQuestions } from './schemas';

describe('buildBookGradingPrompt', () => {
  it('matches answer-key entries by question number instead of OCR order', () => {
    const extracted: ExtractedQuestions = {
      questions: [
        { question_number: 3, question: '3 + 0', student_answer: '3' },
        { question_number: 1, question: '1 + 0', student_answer: '1' },
      ],
    };

    const prompt = buildBookGradingPrompt(extracted, ['one', 'two', 'three']);

    expect(prompt).toContain('Question 3: 3 + 0\nStudent Answer: 3\nCorrect Answer: three\n');
    expect(prompt).toContain('Question 1: 1 + 0\nStudent Answer: 1\nCorrect Answer: one\n');
    expect(prompt.indexOf('Question 3:')).toBeLessThan(prompt.indexOf('Question 1:'));
  });

  it('marks missing answer-key entries as unavailable', () => {
    const extracted: ExtractedQuestions = {
      questions: [
        { question_number: 4, question: '4 + 0', student_answer: '4' },
      ],
    };

    const prompt = buildBookGradingPrompt(extracted, ['one']);

    expect(prompt).toContain('Question 4: 4 + 0\nStudent Answer: 4\nCorrect Answer: Answer not available\n');
  });
});
