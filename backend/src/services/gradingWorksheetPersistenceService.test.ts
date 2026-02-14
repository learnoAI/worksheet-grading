import { beforeEach, describe, expect, it, vi } from 'vitest';

const mockPrisma = vi.hoisted(() => ({
  worksheetTemplate: {
    findFirst: vi.fn(),
  },
  worksheet: {
    findFirst: vi.fn(),
    upsert: vi.fn(),
    update: vi.fn(),
    create: vi.fn(),
  },
  gradingJob: {
    findUnique: vi.fn(),
  },
}));

vi.mock('../utils/prisma', () => ({
  default: mockPrisma,
}));

import { ProcessingStatus } from '@prisma/client';
import { persistWorksheetForGradingJob } from './gradingWorksheetPersistenceService';

describe('gradingWorksheetPersistenceService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPrisma.worksheetTemplate.findFirst.mockResolvedValue({ id: 'tmpl-1' });
  });

  it('falls back to update when upsert fails due to missing unique index (42P10) and worksheet exists', async () => {
    const submittedOn = new Date('2026-02-14T12:34:56.789Z');

    mockPrisma.worksheet.findFirst.mockResolvedValue({ id: 'ws-1' });
    mockPrisma.worksheet.upsert.mockRejectedValue(
      new Error('there is no unique or exclusion constraint matching the ON CONFLICT specification')
    );
    mockPrisma.worksheet.update.mockResolvedValue({ id: 'ws-1' });

    const result = await persistWorksheetForGradingJob(
      {
        studentId: 'student-1',
        classId: 'class-1',
        teacherId: 'teacher-1',
        worksheetNumber: 15,
        submittedOn,
        isRepeated: false,
      },
      {
        success: true,
        grade: 37,
        total_possible: 40,
        total_questions: 10,
        correct_answers: 7,
        wrong_answers: 2,
        unanswered: 1,
        grade_percentage: 92.5,
        question_scores: [],
        wrong_questions: [{ question_number: 5 }, { question_number: 2 }],
        unanswered_questions: [{ question_number: 3 }],
        overall_feedback: 'ok',
      }
    );

    expect(result.action).toBe('UPDATED');
    expect(result.worksheetId).toBe('ws-1');
    expect(result.grade).toBe(37);

    const findArgs = mockPrisma.worksheet.findFirst.mock.calls[0][0];
    expect(findArgs.where.worksheetNumber).toBe(15);
    expect(findArgs.where.submittedOn).toBeInstanceOf(Date);
    expect((findArgs.where.submittedOn as Date).toISOString()).toBe('2026-02-14T00:00:00.000Z');

    const updateArgs = mockPrisma.worksheet.update.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'ws-1' });
    expect(updateArgs.data.status).toBe(ProcessingStatus.COMPLETED);
    expect(updateArgs.data.wrongQuestionNumbers).toBe('2, 3, 5');
  });

  it('falls back to create when upsert fails due to missing unique index (42P10) and worksheet does not exist', async () => {
    const submittedOn = new Date('2026-02-14T12:34:56.789Z');

    mockPrisma.worksheet.findFirst.mockResolvedValue(null);
    mockPrisma.worksheet.upsert.mockRejectedValue(
      new Error('Error occurred during query execution: code: \"42P10\"')
    );
    mockPrisma.worksheet.create.mockResolvedValue({ id: 'ws-new' });

    const result = await persistWorksheetForGradingJob(
      {
        studentId: 'student-1',
        classId: 'class-1',
        teacherId: 'teacher-1',
        worksheetNumber: 15,
        submittedOn,
        isRepeated: true,
      },
      {
        success: true,
        grade: 10,
        total_possible: 40,
        total_questions: 10,
        correct_answers: 2,
        wrong_answers: 8,
        unanswered: 0,
        grade_percentage: 25,
        question_scores: [],
        wrong_questions: [{ question_number: 1 }],
        unanswered_questions: [],
        overall_feedback: 'ok',
      }
    );

    expect(result.action).toBe('CREATED');
    expect(result.worksheetId).toBe('ws-new');

    const createArgs = mockPrisma.worksheet.create.mock.calls[0][0];
    expect(createArgs.data.submittedOn).toBeInstanceOf(Date);
    expect((createArgs.data.submittedOn as Date).toISOString()).toBe('2026-02-14T00:00:00.000Z');
    expect(createArgs.data.status).toBe(ProcessingStatus.COMPLETED);
    expect(createArgs.data.isRepeated).toBe(true);
    expect(createArgs.data.wrongQuestionNumbers).toBe('1');
  });

  it('is idempotent across duplicate deliveries (second call updates the same worksheet)', async () => {
    const submittedOn = new Date('2026-02-14T12:34:56.789Z');

    mockPrisma.worksheet.upsert.mockResolvedValue({ id: 'ws-dup' });

    // First call: no existing worksheet.
    mockPrisma.worksheet.findFirst.mockResolvedValueOnce(null);

    const first = await persistWorksheetForGradingJob(
      {
        studentId: 'student-1',
        classId: 'class-1',
        teacherId: 'teacher-1',
        worksheetNumber: 15,
        submittedOn,
        isRepeated: false,
      },
      {
        success: true,
        grade: 30,
        total_possible: 40,
        total_questions: 1,
        correct_answers: 1,
        wrong_answers: 0,
        unanswered: 0,
        grade_percentage: 75,
        question_scores: [],
        wrong_questions: [],
        unanswered_questions: [],
        overall_feedback: 'ok',
      }
    );

    // Second call: worksheet already exists (simulates duplicate queue delivery).
    mockPrisma.worksheet.findFirst.mockResolvedValueOnce({ id: 'ws-dup' });

    const second = await persistWorksheetForGradingJob(
      {
        studentId: 'student-1',
        classId: 'class-1',
        teacherId: 'teacher-1',
        worksheetNumber: 15,
        submittedOn,
        isRepeated: false,
      },
      {
        success: true,
        grade: 31,
        total_possible: 40,
        total_questions: 1,
        correct_answers: 1,
        wrong_answers: 0,
        unanswered: 0,
        grade_percentage: 77.5,
        question_scores: [],
        wrong_questions: [],
        unanswered_questions: [],
        overall_feedback: 'ok',
      }
    );

    expect(first.worksheetId).toBe('ws-dup');
    expect(second.worksheetId).toBe('ws-dup');
    expect(first.action).toBe('CREATED');
    expect(second.action).toBe('UPDATED');
  });
});
