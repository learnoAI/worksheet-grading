import type { ExtractedQuestions } from './schemas';

const TOTAL_POSSIBLE_POINTS = 40;

export function buildOcrPrompt(customPrompt: string | null): string {
  if (customPrompt && customPrompt.trim().length > 0) {
    return customPrompt;
  }

  return `Extract all questions and their corresponding student answers from these worksheet images.

<Rules>
1. When giving the student's answer, give exactly what they wrote. DO NOT INTERPRET.
2. If a question is unanswered, use an empty string "" for the answer.
3. Return the questions in the order of question number.
4. Some sheets have multiple columns of questions. Extract them properly.
5. Include the entire question text in the question field. Do not include the student's answer in the question field.
</Rules>

IMPORTANT: Return your response in JSON with key:
questions[].
Each questions[] item must include:
question_number, question, student_answer.
`;
}

function formatQuestions(extracted: ExtractedQuestions): string {
  return extracted.questions
    .map((q) => `Question ${q.question_number}: ${q.question}\nStudent Answer: ${q.student_answer}\n`)
    .join('\n');
}

function formatQuestionsWithAnswers(extracted: ExtractedQuestions, bookAnswers: string[]): string {
  return extracted.questions
    .map((q, i) => {
      const correct = i < bookAnswers.length ? bookAnswers[i] : 'Answer not available';
      return `Question ${q.question_number}: ${q.question}\nStudent Answer: ${q.student_answer}\nCorrect Answer: ${correct}\n`;
    })
    .join('\n');
}

export function buildAiGradingPrompt(extracted: ExtractedQuestions): string {
  const formatted = formatQuestions(extracted);

  return `You are an expert teacher grading student worksheets. Below are the questions and student answers extracted from a worksheet.

<Rules>
1. No partial grading of a question.
2. If a question is unanswered, it should receive 0 points.
3. If a question is answered incorrectly, it should receive 0 points.
4. Use points only at question level, with an even max_points split across questions so total is ${TOTAL_POSSIBLE_POINTS}.
5. Do not compute or return a final overall score or percentage. The platform computes those deterministically.
</Rules>

${formatted}

IMPORTANT: Return your response in JSON with keys:
question_scores[], overall_feedback.
Each question_scores[] item must include:
question_number, question, student_answer, correct_answer, points_earned, max_points, is_correct, feedback.
`;
}

export function buildBookGradingPrompt(extracted: ExtractedQuestions, bookAnswers: string[]): string {
  const formatted = formatQuestionsWithAnswers(extracted, bookAnswers);

  return `You are an expert teacher grading student worksheets. Below are the questions, student answers, and correct answers from the answer key.

<Rules>
1. No partial grading of a question.
2. If a question is unanswered, it should receive 0 points.
3. If a question is answered incorrectly, it should receive 0 points.
4. Use points only at question level, with an even max_points split across questions so total is ${TOTAL_POSSIBLE_POINTS}.
5. Compare the student answer with the provided correct answer.
6. Do not compute or return a final overall score or percentage. The platform computes those deterministically.
</Rules>

${formatted}

IMPORTANT: Return your response in JSON with keys:
question_scores[], overall_feedback.
Each question_scores[] item must include:
question_number, question, student_answer, correct_answer, points_earned, max_points, is_correct, feedback.
`;
}
