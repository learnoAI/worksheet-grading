import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Prisma, type PrismaClient } from '@prisma/client';
import {
  persistWorksheetForGradingJob,
  persistWorksheetForGradingJobId,
} from './gradingPersistence';
import type { GradingApiResponse } from './gradingDiagnostics';

const JOB = {
  studentId: 'st1',
  classId: 'c1',
  teacherId: 't1',
  worksheetNumber: 5,
  submittedOn: new Date('2026-04-10T10:00:00Z'),
  isRepeated: false,
};

const GOOD_RESPONSE: GradingApiResponse = {
  success: true,
  grade: 32,
  total_possible: 40,
  grade_percentage: 80,
  wrong_questions: [{ question_number: 1 }],
  unanswered_questions: [{ question_number: 7 }],
};

function makeTx({
  existing,
  upsertResult,
  upsertError,
  updateResult,
  createResult,
}: {
  existing?: { id: string } | null;
  upsertResult?: { id: string };
  upsertError?: Error & { code?: string };
  updateResult?: { id: string };
  createResult?: { id: string };
} = {}) {
  const templateFindFirst = vi.fn().mockResolvedValue({ id: 'tpl-1' });
  const worksheetFindFirst = vi
    .fn()
    .mockResolvedValueOnce(existing === undefined ? null : existing)
    .mockResolvedValue(existing ?? null);
  const worksheetUpsert = vi.fn();
  const worksheetUpdate = vi.fn().mockResolvedValue(updateResult ?? { id: 'ws-updated' });
  const worksheetCreate = vi.fn().mockResolvedValue(createResult ?? { id: 'ws-created' });
  if (upsertError) worksheetUpsert.mockRejectedValue(upsertError);
  else worksheetUpsert.mockResolvedValue(upsertResult ?? { id: 'ws-1' });

  const tx = {
    worksheetTemplate: { findFirst: templateFindFirst },
    worksheet: {
      findFirst: worksheetFindFirst,
      upsert: worksheetUpsert,
      update: worksheetUpdate,
      create: worksheetCreate,
    },
  } as unknown as PrismaClient;

  return {
    tx,
    spies: {
      templateFindFirst,
      worksheetFindFirst,
      worksheetUpsert,
      worksheetUpdate,
      worksheetCreate,
    },
  };
}

describe('persistWorksheetForGradingJob', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws when gradingResponse.success is false', async () => {
    const { tx } = makeTx();
    await expect(
      persistWorksheetForGradingJob(tx, {}, JOB, { success: false, error: 'bad' })
    ).rejects.toThrow(/bad/);
  });

  it('creates a new worksheet when none exists and returns action=CREATED', async () => {
    const { tx, spies } = makeTx({ existing: null, upsertResult: { id: 'ws-new' } });
    const result = await persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE);
    expect(result).toEqual({
      worksheetId: 'ws-new',
      action: 'CREATED',
      grade: 32,
    });
    expect(spies.worksheetUpsert).toHaveBeenCalled();
    const call = spies.worksheetUpsert.mock.calls[0][0];
    expect(call.create.grade).toBe(32);
    expect(call.create.outOf).toBe(40);
    expect(call.create.wrongQuestionNumbers).toBe('1, 7');
  });

  it('marks action=UPDATED when an existing row is found', async () => {
    const { tx } = makeTx({ existing: { id: 'ws-old' }, upsertResult: { id: 'ws-old' } });
    const result = await persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE);
    expect(result.action).toBe('UPDATED');
    expect(result.worksheetId).toBe('ws-old');
  });

  it('preserves user-owned fields on the upsert update branch', async () => {
    // grade, wrongQuestionNumbers, isRepeated belong to the user once a row
    // exists — an SR may have manually saved a worksheet before the AI
    // worker finished, and the AI's UPDATE must not silently revert it.
    const { tx, spies } = makeTx({
      existing: { id: 'ws-existing' },
      upsertResult: { id: 'ws-existing' },
    });
    await persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE);
    const call = spies.worksheetUpsert.mock.calls[0][0];
    // create branch still seeds everything (only runs on a fresh row).
    expect(call.create.grade).toBe(32);
    expect(call.create.wrongQuestionNumbers).toBe('1, 7');
    expect(call.create.isRepeated).toBe(false);
    // update branch refreshes AI-derived fields only.
    expect(call.update.status).toBeDefined();
    expect(call.update.gradingDetails).toBeDefined();
    expect(call.update.outOf).toBe(40);
    expect(call.update).not.toHaveProperty('grade');
    expect(call.update).not.toHaveProperty('wrongQuestionNumbers');
    expect(call.update).not.toHaveProperty('isRepeated');
    expect(call.update).not.toHaveProperty('worksheetNumber');
  });

  it('preserves user-owned fields on the missing-unique-index fallback update path', async () => {
    const err = new Error('code: "42P10"');
    const { tx, spies } = makeTx({
      existing: { id: 'ws-existing' },
      upsertError: err,
      updateResult: { id: 'ws-existing' },
    });
    await persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE);
    const updateArgs = spies.worksheetUpdate.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'ws-existing' });
    expect(updateArgs.data.status).toBeDefined();
    expect(updateArgs.data.gradingDetails).toBeDefined();
    expect(updateArgs.data).not.toHaveProperty('grade');
    expect(updateArgs.data).not.toHaveProperty('wrongQuestionNumbers');
    expect(updateArgs.data).not.toHaveProperty('isRepeated');
    expect(updateArgs.data).not.toHaveProperty('worksheetNumber');
  });

  it('preserves user-owned fields on the P2002 race-recovery update path', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const templateFindFirst = vi.fn().mockResolvedValue(null);
    const worksheetFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // first lookup before upsert
      .mockResolvedValueOnce({ id: 'ws-raced' }); // lookup inside P2002 handler
    const worksheetUpsert = vi.fn().mockRejectedValue(err);
    const worksheetUpdate = vi.fn().mockResolvedValue({ id: 'ws-raced' });
    const tx = {
      worksheetTemplate: { findFirst: templateFindFirst },
      worksheet: {
        findFirst: worksheetFindFirst,
        upsert: worksheetUpsert,
        update: worksheetUpdate,
        create: vi.fn(),
      },
    } as unknown as PrismaClient;
    await persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE);
    const updateArgs = worksheetUpdate.mock.calls[0][0];
    expect(updateArgs.where).toEqual({ id: 'ws-raced' });
    expect(updateArgs.data.status).toBeDefined();
    expect(updateArgs.data.gradingDetails).toBeDefined();
    expect(updateArgs.data).not.toHaveProperty('grade');
    expect(updateArgs.data).not.toHaveProperty('wrongQuestionNumbers');
    expect(updateArgs.data).not.toHaveProperty('isRepeated');
  });

  it('falls back to update-then-create when missing unique index error fires', async () => {
    const err = new Error(
      'no unique or exclusion constraint matching the ON CONFLICT specification'
    );
    const { tx, spies } = makeTx({
      existing: null,
      upsertError: err,
      createResult: { id: 'ws-fallback' },
    });
    const result = await persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE);
    expect(result.worksheetId).toBe('ws-fallback');
    expect(result.action).toBe('CREATED');
    expect(spies.worksheetCreate).toHaveBeenCalled();
    expect(spies.worksheetUpdate).not.toHaveBeenCalled();
  });

  it('falls back to update when missing unique index AND row already exists', async () => {
    const err = new Error('code: "42P10"');
    const { tx, spies } = makeTx({
      existing: { id: 'ws-existing' },
      upsertError: err,
      updateResult: { id: 'ws-existing' },
    });
    const result = await persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE);
    expect(result.action).toBe('UPDATED');
    expect(spies.worksheetUpdate).toHaveBeenCalled();
    expect(spies.worksheetCreate).not.toHaveBeenCalled();
  });

  it('recovers from P2002 race by re-finding and updating the row', async () => {
    const err = new Prisma.PrismaClientKnownRequestError('Unique constraint', {
      code: 'P2002',
      clientVersion: 'x',
    });
    const templateFindFirst = vi.fn().mockResolvedValue(null);
    const worksheetFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // first lookup before upsert
      .mockResolvedValueOnce({ id: 'ws-raced' }); // lookup inside P2002 handler
    const worksheetUpsert = vi.fn().mockRejectedValue(err);
    const worksheetUpdate = vi.fn().mockResolvedValue({ id: 'ws-raced' });
    const tx = {
      worksheetTemplate: { findFirst: templateFindFirst },
      worksheet: {
        findFirst: worksheetFindFirst,
        upsert: worksheetUpsert,
        update: worksheetUpdate,
        create: vi.fn(),
      },
    } as unknown as PrismaClient;
    const result = await persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE);
    expect(result.worksheetId).toBe('ws-raced');
    // When the first lookup said null, action should still be CREATED
    // — this preserves parity with the Express behavior.
    expect(result.action).toBe('CREATED');
  });

  it('rethrows unexpected errors (not 42P10, not P2002)', async () => {
    const err = Object.assign(new Error('db unavailable'), { code: 'P1001' });
    const { tx } = makeTx({ existing: null, upsertError: err });
    await expect(
      persistWorksheetForGradingJob(tx, {}, JOB, GOOD_RESPONSE)
    ).rejects.toThrow(/db unavailable/);
  });

  it('returns null wrongQuestionNumbers when no wrongs/unanswereds', async () => {
    const { tx, spies } = makeTx({ existing: null, upsertResult: { id: 'w' } });
    const resp: GradingApiResponse = { ...GOOD_RESPONSE, wrong_questions: [], unanswered_questions: [] };
    await persistWorksheetForGradingJob(tx, {}, JOB, resp);
    const call = spies.worksheetUpsert.mock.calls[0][0];
    expect(call.create.wrongQuestionNumbers).toBeNull();
  });
});

describe('persistWorksheetForGradingJobId', () => {
  it('looks up the job then delegates to persistWorksheetForGradingJob', async () => {
    const jobFindUnique = vi.fn().mockResolvedValue(JOB);
    const templateFindFirst = vi.fn().mockResolvedValue(null);
    const worksheetFindFirst = vi.fn().mockResolvedValue(null);
    const worksheetUpsert = vi.fn().mockResolvedValue({ id: 'ws' });
    const tx = {
      gradingJob: { findUnique: jobFindUnique },
      worksheetTemplate: { findFirst: templateFindFirst },
      worksheet: { findFirst: worksheetFindFirst, upsert: worksheetUpsert },
    } as unknown as PrismaClient;
    const result = await persistWorksheetForGradingJobId(tx, {}, 'job-1', GOOD_RESPONSE);
    expect(result.worksheetId).toBe('ws');
    expect(jobFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'job-1' } })
    );
  });

  it('throws when job does not exist', async () => {
    const tx = {
      gradingJob: { findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as PrismaClient;
    await expect(
      persistWorksheetForGradingJobId(tx, {}, 'missing', GOOD_RESPONSE)
    ).rejects.toThrow(/not found/);
  });
});
