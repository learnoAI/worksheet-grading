import { describe, expect, it } from 'vitest';
import {
  summarizeGradingResponse,
  summarizeGradingJobContext,
  summarizeError,
  summarizeRequestBodyShape,
} from './gradingDiagnostics';

describe('summarizeGradingResponse', () => {
  it('reports responseType when input is null/undefined', () => {
    expect(summarizeGradingResponse(null)).toEqual({ responseType: 'null' });
    expect(summarizeGradingResponse(undefined)).toEqual({ responseType: 'undefined' });
  });

  it('captures types and counts without leaking full arrays', () => {
    const summary = summarizeGradingResponse({
      success: true,
      grade: 32,
      total_possible: 40,
      grade_percentage: 80,
      question_scores: [1, 2, 3],
      wrong_questions: [{ question_number: 1 }, { question_number: 2 }],
      unanswered_questions: [{ question_number: 5 }],
      mongodb_id: 'abc',
      overall_feedback: 'good',
      error: undefined,
    });
    expect(summary.success).toBe(true);
    expect(summary.gradeType).toBe('number');
    expect(summary.questionScoresCount).toBe(3);
    expect(summary.wrongQuestionsCount).toBe(2);
    expect(summary.wrongQuestionNumberTypes).toEqual(['number']);
    expect(summary.unansweredQuestionsCount).toBe(1);
    expect(summary.mongodbIdType).toBe('string');
    expect(summary.overallFeedbackType).toBe('string');
    expect(summary.errorPreview).toBeUndefined();
  });

  it('reports type variety when wrong_questions contains mixed types', () => {
    const summary = summarizeGradingResponse({
      success: false,
      wrong_questions: [
        { question_number: 1 },
        { question_number: '2' } as unknown as { question_number: number },
      ],
    });
    expect(summary.wrongQuestionNumberTypes).toEqual(
      expect.arrayContaining(['number', 'string'])
    );
  });

  it('truncates long error strings', () => {
    const summary = summarizeGradingResponse({
      success: false,
      error: 'x'.repeat(500),
    });
    expect((summary.errorPreview as string).endsWith('...')).toBe(true);
    expect((summary.errorPreview as string).length).toBeLessThan(500);
  });
});

describe('summarizeGradingJobContext', () => {
  it('produces a flat object with ISO-formatted submittedOn', () => {
    const out = summarizeGradingJobContext({
      studentId: 'st1',
      classId: 'c1',
      teacherId: 't1',
      worksheetNumber: 5,
      submittedOn: new Date('2026-04-10T10:00:00Z'),
      isRepeated: false,
    });
    expect(out.submittedOn).toBe('2026-04-10T10:00:00.000Z');
    expect(out.studentId).toBe('st1');
    expect(out.isRepeated).toBe(false);
  });

  it('returns null submittedOn when field is null', () => {
    const out = summarizeGradingJobContext({
      studentId: 'st1',
      classId: 'c1',
      teacherId: 't1',
      worksheetNumber: 0,
      submittedOn: null as unknown as Date,
      isRepeated: false,
    });
    expect(out.submittedOn).toBeNull();
  });
});

describe('summarizeError', () => {
  it('extracts name, truncated message, and optional code from Error instances', () => {
    const err = new Error('x'.repeat(500));
    (err as Error & { code?: string }).code = 'E_DB';
    const out = summarizeError(err);
    expect(out.errorName).toBe('Error');
    expect((out.errorMessage as string).endsWith('...')).toBe(true);
    expect(out.errorCode).toBe('E_DB');
  });

  it('handles non-Error values via errorType', () => {
    expect(summarizeError('plain string')).toEqual({
      errorType: 'string',
      errorMessage: 'plain string',
    });
    expect(summarizeError(42)).toMatchObject({ errorType: 'number' });
    expect(summarizeError(null)).toMatchObject({ errorType: 'null' });
  });
});

describe('summarizeRequestBodyShape', () => {
  it('flags array bodies with length', () => {
    expect(summarizeRequestBodyShape([1, 2, 3])).toEqual({
      bodyType: 'array',
      bodyLength: 3,
    });
  });

  it('reports primitive types directly', () => {
    expect(summarizeRequestBodyShape(null)).toEqual({ bodyType: 'null' });
    expect(summarizeRequestBodyShape('s')).toEqual({ bodyType: 'string' });
    expect(summarizeRequestBodyShape(undefined)).toEqual({ bodyType: 'undefined' });
  });

  it('records keys and notable field types for object bodies', () => {
    const out = summarizeRequestBodyShape({
      leaseId: 'abc',
      reason: 'lease_lost',
      errorMessage: 'python crash',
      extra: 1,
    });
    expect(out.bodyType).toBe('object');
    expect(out.bodyKeys).toEqual(expect.arrayContaining(['leaseId', 'reason', 'errorMessage']));
    expect(out.leaseIdType).toBe('string');
    expect(out.reasonType).toBe('string');
    expect(out.errorMessageType).toBe('string');
  });

  it('descends into gradingResponse when present', () => {
    const out = summarizeRequestBodyShape({
      leaseId: 'x',
      gradingResponse: { success: true, worksheetId: 'w1', extra: [1, 2] },
    });
    expect(out.gradingResponseType).toBe('object');
    expect(out.gradingResponseKeys).toEqual(expect.arrayContaining(['success', 'worksheetId']));
    expect(out.gradingResponseSuccessType).toBe('boolean');
    expect(out.gradingResponseWorksheetIdType).toBe('string');
  });

  it('caps object key list at 12', () => {
    const body: Record<string, string> = {};
    for (let i = 0; i < 30; i++) body[`k${i}`] = 'v';
    const out = summarizeRequestBodyShape(body);
    expect((out.bodyKeys as string[]).length).toBe(12);
  });
});
