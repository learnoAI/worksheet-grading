import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { onWorksheetPdfComplete, incrementBatchCompletedSkills } from './batchProgress';

function mockPrisma(
  initial: {
    completedWorksheets?: number;
    failedWorksheets?: number;
    totalWorksheets?: number;
    completedSkills?: number;
    pendingSkills?: number;
  },
  options: {
    /** When true, the BatchSkillProgress.create call rejects with a P2002
     *  error, simulating CF Queue redelivery of the same (batchId, skillId). */
    skillProgressDuplicate?: boolean;
  } = {}
) {
  const update = vi.fn();
  const findUnique = vi.fn();
  const skillProgressCreate = vi.fn();

  const prisma = {
    worksheetBatch: { update, findUnique },
    batchSkillProgress: { create: skillProgressCreate },
  } as unknown as PrismaClient;

  // First update call returns the incremented row; subsequent calls return
  // whatever the caller is about to write.
  update
    .mockImplementationOnce(async (args) => {
      const base = {
        completedWorksheets: initial.completedWorksheets ?? 0,
        failedWorksheets: initial.failedWorksheets ?? 0,
        totalWorksheets: initial.totalWorksheets ?? 0,
        completedSkills: initial.completedSkills ?? 0,
        pendingSkills: initial.pendingSkills ?? 0,
      };
      const data = args.data ?? {};
      if ('completedWorksheets' in data && typeof data.completedWorksheets === 'object') {
        base.completedWorksheets += 1;
      }
      if ('failedWorksheets' in data && typeof data.failedWorksheets === 'object') {
        base.failedWorksheets += 1;
      }
      if ('completedSkills' in data && typeof data.completedSkills === 'object') {
        base.completedSkills += 1;
      }
      return base;
    })
    .mockResolvedValue({});

  findUnique.mockResolvedValue({
    completedSkills: initial.completedSkills ?? 0,
    pendingSkills: initial.pendingSkills ?? 0,
  });

  if (options.skillProgressDuplicate) {
    // Shape mirrors Prisma's PrismaClientKnownRequestError for P2002 —
    // `isUniqueConstraintError` checks for `code: 'P2002'`.
    const err = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    skillProgressCreate.mockRejectedValueOnce(err);
  } else {
    skillProgressCreate.mockResolvedValue({});
  }

  return { prisma, update, findUnique, skillProgressCreate };
}

describe('onWorksheetPdfComplete', () => {
  beforeEach(() => vi.clearAllMocks());

  it('increments completedWorksheets when not failed', async () => {
    const { prisma, update } = mockPrisma({
      completedWorksheets: 1,
      failedWorksheets: 0,
      totalWorksheets: 5,
    });
    await onWorksheetPdfComplete(prisma, 'b1', false);
    expect(update).toHaveBeenNthCalledWith(1, {
      where: { id: 'b1' },
      data: { completedWorksheets: { increment: 1 } },
    });
    // Threshold not reached, so no second call.
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('increments failedWorksheets when failed', async () => {
    const { prisma, update } = mockPrisma({
      completedWorksheets: 0,
      failedWorksheets: 0,
      totalWorksheets: 5,
    });
    await onWorksheetPdfComplete(prisma, 'b1', true);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { failedWorksheets: { increment: 1 } },
    });
  });

  it('flips batch to COMPLETED when total done ≥ totalWorksheets', async () => {
    const { prisma, update } = mockPrisma({
      completedWorksheets: 4,
      failedWorksheets: 0,
      totalWorksheets: 5,
    });
    await onWorksheetPdfComplete(prisma, 'b1', false);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'b1' },
      data: { status: 'COMPLETED' },
    });
  });

  it('flips batch to COMPLETED even when counting failures', async () => {
    const { prisma, update } = mockPrisma({
      completedWorksheets: 2,
      failedWorksheets: 2,
      totalWorksheets: 5,
    });
    await onWorksheetPdfComplete(prisma, 'b1', true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'b1' },
      data: { status: 'COMPLETED' },
    });
  });
});

describe('incrementBatchCompletedSkills — first-time + flip', () => {
  beforeEach(() => vi.clearAllMocks());

  it('records progress AND increments completedSkills, does NOT flip when more skills pending', async () => {
    const { prisma, update, skillProgressCreate } = mockPrisma({
      completedSkills: 0,
      pendingSkills: 3,
    });
    const result = await incrementBatchCompletedSkills(prisma, 'b1', 'skill-1');
    expect(result.flipped).toBe(false);
    expect(result.idempotent).toBe(false);
    expect(skillProgressCreate).toHaveBeenCalledWith({
      data: { batchId: 'b1', mathSkillId: 'skill-1' },
    });
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { completedSkills: { increment: 1 } },
    });
  });

  it('flips batch to RENDERING_PDFS when completedSkills reaches pendingSkills', async () => {
    const { prisma, update, skillProgressCreate } = mockPrisma({
      completedSkills: 2,
      pendingSkills: 3,
    });
    const result = await incrementBatchCompletedSkills(prisma, 'b1', 'skill-1');
    expect(result.flipped).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(skillProgressCreate).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'b1' },
      data: { status: 'RENDERING_PDFS' },
    });
  });
});

describe('incrementBatchCompletedSkills — idempotent replays (CF Queue redelivery)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('skips the counter increment when BatchSkillProgress.create raises P2002 (already counted)', async () => {
    const { prisma, update, findUnique, skillProgressCreate } = mockPrisma(
      { completedSkills: 1, pendingSkills: 3 },
      { skillProgressDuplicate: true }
    );
    const result = await incrementBatchCompletedSkills(prisma, 'b1', 'skill-1');
    expect(result.idempotent).toBe(true);
    expect(result.flipped).toBe(false);
    expect(result.completedSkills).toBe(1);
    expect(result.pendingSkills).toBe(3);
    // Atomic dedup attempted, but counter NOT incremented.
    expect(skillProgressCreate).toHaveBeenCalledTimes(1);
    expect(update).not.toHaveBeenCalled();
    // findUnique used to read current state for the consistent return.
    expect(findUnique).toHaveBeenCalledWith({
      where: { id: 'b1' },
      select: { completedSkills: true, pendingSkills: true },
    });
  });

  it('three replays of the same (batchId, mathSkillId) increment the counter exactly once', async () => {
    // First call: skillProgress.create succeeds → counter increments.
    // Next two: skillProgress.create throws P2002 → counter skipped.
    // Use a single prisma instance with stateful mocks across the loop.
    const update = vi.fn().mockResolvedValue({
      completedSkills: 1,
      pendingSkills: 3,
    });
    const findUnique = vi.fn().mockResolvedValue({
      completedSkills: 1,
      pendingSkills: 3,
    });
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    const skillProgressCreate = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002);
    const prisma = {
      worksheetBatch: { update, findUnique },
      batchSkillProgress: { create: skillProgressCreate },
    } as unknown as PrismaClient;

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await incrementBatchCompletedSkills(prisma, 'b1', 'skill-1'));
    }

    // First call: not idempotent. Counter incremented.
    expect(results[0].idempotent).toBe(false);
    // Subsequent two calls: idempotent. Counter NOT incremented.
    expect(results[1].idempotent).toBe(true);
    expect(results[2].idempotent).toBe(true);
    // CRITICAL: counter update fired exactly once across all 3 calls.
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { completedSkills: { increment: 1 } },
    });
  });

  it('different skills in the same batch each increment the counter once (cross-skill dedup is per-skill)', async () => {
    // Two separate (batchId, mathSkillId) pairs both succeed at the
    // dedup-insert stage and both increment the counter. The dedup is
    // scoped to the exact (batchId, mathSkillId) tuple — different
    // skills are independent events.
    const update = vi
      .fn()
      .mockResolvedValueOnce({ completedSkills: 1, pendingSkills: 3 })
      .mockResolvedValueOnce({ completedSkills: 2, pendingSkills: 3 });
    const findUnique = vi.fn();
    const skillProgressCreate = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const prisma = {
      worksheetBatch: { update, findUnique },
      batchSkillProgress: { create: skillProgressCreate },
    } as unknown as PrismaClient;

    const r1 = await incrementBatchCompletedSkills(prisma, 'b1', 'skill-A');
    const r2 = await incrementBatchCompletedSkills(prisma, 'b1', 'skill-B');

    expect(r1.idempotent).toBe(false);
    expect(r2.idempotent).toBe(false);
    expect(skillProgressCreate).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenCalledTimes(2);
  });

  it('re-throws non-P2002 errors from the dedup insert', async () => {
    const skillProgressCreate = vi
      .fn()
      .mockRejectedValueOnce(new Error('connection refused'));
    const prisma = {
      worksheetBatch: { update: vi.fn(), findUnique: vi.fn() },
      batchSkillProgress: { create: skillProgressCreate },
    } as unknown as PrismaClient;

    await expect(
      incrementBatchCompletedSkills(prisma, 'b1', 'skill-1')
    ).rejects.toThrow(/connection refused/);
  });
});
