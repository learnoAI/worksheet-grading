import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { onWorksheetPdfComplete, incrementBatchCompletedSkills } from './batchProgress';

/**
 * Build a mock PrismaClient that simulates the row-level state of
 * `WorksheetBatch` across a transactional dedup+increment plus the
 * race-safe `updateMany` flip.
 *
 * `$transaction(cb)` invokes the callback with a tx proxy whose
 * `worksheetBatch.update` and `batchSkillProgress.create` mirror the
 * non-tx mocks below. On a rejected `create` the tx rejects (Postgres
 * would roll back; the caller's outer catch sees P2002).
 *
 * `worksheetBatch.updateMany` is the flip path — returns `count: 1` when
 * the simulated status is `GENERATING_QUESTIONS` (the first crosser
 * wins) and `count: 0` thereafter (subsequent racers see the flipped
 * status and skip downstream effects).
 */
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
    /** When true, the counter-increment `update` inside the $transaction
     *  rejects after a successful create — exercises the rollback path. */
    counterUpdateFails?: boolean;
  } = {}
) {
  const update = vi.fn();
  const updateMany = vi.fn();
  const findUnique = vi.fn();
  const skillProgressCreate = vi.fn();
  const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
    // Build a tx proxy that re-uses the outer mocks, so call counts on
    // those mocks are visible to assertions.
    const tx = {
      worksheetBatch: { update },
      batchSkillProgress: { create: skillProgressCreate },
    };
    return cb(tx);
  });

  const prisma = {
    worksheetBatch: { update, updateMany, findUnique },
    batchSkillProgress: { create: skillProgressCreate },
    $transaction: transaction,
  } as unknown as PrismaClient;

  // Default state used by both `update` (inside tx) and `findUnique`
  // (idempotent replay path).
  let currentBatchState = {
    completedWorksheets: initial.completedWorksheets ?? 0,
    failedWorksheets: initial.failedWorksheets ?? 0,
    totalWorksheets: initial.totalWorksheets ?? 0,
    completedSkills: initial.completedSkills ?? 0,
    pendingSkills: initial.pendingSkills ?? 0,
  };

  if (options.counterUpdateFails) {
    update.mockRejectedValueOnce(new Error('counter update failed'));
  }

  update.mockImplementation(async (args: { data?: Record<string, unknown> }) => {
    const data = args.data ?? {};
    if ('completedWorksheets' in data && typeof data.completedWorksheets === 'object') {
      currentBatchState.completedWorksheets += 1;
    }
    if ('failedWorksheets' in data && typeof data.failedWorksheets === 'object') {
      currentBatchState.failedWorksheets += 1;
    }
    if ('completedSkills' in data && typeof data.completedSkills === 'object') {
      currentBatchState.completedSkills += 1;
    }
    return { ...currentBatchState };
  });

  // First updateMany (flip) succeeds; subsequent ones (concurrent racers)
  // see the row already flipped → count: 0.
  updateMany
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValue({ count: 0 });

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

  return { prisma, update, updateMany, findUnique, skillProgressCreate, transaction };
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

  it('records progress AND increments completedSkills inside a $transaction', async () => {
    const { prisma, update, skillProgressCreate, transaction } = mockPrisma({
      completedSkills: 0,
      pendingSkills: 3,
    });
    const result = await incrementBatchCompletedSkills(prisma, 'b1', 'skill-1');
    expect(result.flipped).toBe(false);
    expect(result.idempotent).toBe(false);
    // Both writes happen inside the same $transaction callback —
    // critical so a partial failure (counter write fails after dedup
    // insert succeeded) rolls back the dedup row so retries can still
    // advance the counter.
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(skillProgressCreate).toHaveBeenCalledWith({
      data: { batchId: 'b1', mathSkillId: 'skill-1' },
    });
    expect(update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { completedSkills: { increment: 1 } },
      select: { completedSkills: true, pendingSkills: true },
    });
  });

  it('flips batch to RENDERING_PDFS via race-safe updateMany when completedSkills reaches pendingSkills', async () => {
    const { prisma, updateMany, skillProgressCreate } = mockPrisma({
      completedSkills: 2,
      pendingSkills: 3,
    });
    const result = await incrementBatchCompletedSkills(prisma, 'b1', 'skill-1');
    expect(result.flipped).toBe(true);
    expect(result.idempotent).toBe(false);
    expect(skillProgressCreate).toHaveBeenCalledTimes(1);
    // Flip uses updateMany gated on the prior status so concurrent
    // threshold-crossers don't both trigger assembleAndEnqueuePdfs.
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: 'b1', status: 'GENERATING_QUESTIONS' },
      data: { status: 'RENDERING_PDFS' },
    });
  });

  it('flipped=false when the race-safe flip finds the batch already in RENDERING_PDFS (concurrent racer)', async () => {
    // First update call (inside tx) increments counter to threshold.
    // updateMany returns count: 0 — another caller already flipped.
    const { prisma } = mockPrisma(
      { completedSkills: 2, pendingSkills: 3 }
    );
    // Override the updateMany default: first call yields 0 (we lost the race).
    (prisma.worksheetBatch.updateMany as ReturnType<typeof vi.fn>)
      .mockReset()
      .mockResolvedValueOnce({ count: 0 });
    const result = await incrementBatchCompletedSkills(prisma, 'b1', 'skill-1');
    // We DID increment the counter, but we LOST the flip race; the
    // caller must NOT trigger downstream assemble work.
    expect(result.flipped).toBe(false);
    expect(result.idempotent).toBe(false);
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

  it('throws when P2002 is raised but the batch row is missing (integrity violation, NOT silent zeros)', async () => {
    // The FK on BatchSkillProgress is ON DELETE CASCADE on batch, so
    // hitting P2002 + having no batch row is impossible by design.
    // If we ever observe it, surface the integrity issue instead of
    // returning misleading { completedSkills: 0, pendingSkills: 0 }.
    const { prisma, findUnique } = mockPrisma(
      { completedSkills: 1, pendingSkills: 3 },
      { skillProgressDuplicate: true }
    );
    findUnique.mockReset().mockResolvedValueOnce(null);
    await expect(
      incrementBatchCompletedSkills(prisma, 'orphan-batch', 'skill-1')
    ).rejects.toThrow(/Integrity violation/);
  });

  it('three replays of the same (batchId, mathSkillId) increment the counter exactly once', async () => {
    // First call: $transaction succeeds → counter increments.
    // Next two: $transaction rejects with P2002 → counter skipped.
    // We model this by having the tx callback throw on the second
    // and third invocations.
    const p2002 = Object.assign(new Error('Unique constraint failed'), {
      code: 'P2002',
    });
    const update = vi
      .fn()
      .mockResolvedValueOnce({ completedSkills: 1, pendingSkills: 3 });
    const findUnique = vi.fn().mockResolvedValue({
      completedSkills: 1,
      pendingSkills: 3,
    });
    const skillProgressCreate = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(p2002)
      .mockRejectedValueOnce(p2002);
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        worksheetBatch: { update },
        batchSkillProgress: { create: skillProgressCreate },
      };
      return cb(tx);
    });
    const prisma = {
      worksheetBatch: { update, findUnique, updateMany: vi.fn() },
      batchSkillProgress: { create: skillProgressCreate },
      $transaction: transaction,
    } as unknown as PrismaClient;

    const results = [];
    for (let i = 0; i < 3; i++) {
      results.push(await incrementBatchCompletedSkills(prisma, 'b1', 'skill-1'));
    }

    expect(results[0].idempotent).toBe(false);
    expect(results[1].idempotent).toBe(true);
    expect(results[2].idempotent).toBe(true);
    // CRITICAL: counter update fired exactly once across all 3 calls.
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('different skills in the same batch each increment the counter once (cross-skill dedup is per-skill)', async () => {
    const update = vi
      .fn()
      .mockResolvedValueOnce({ completedSkills: 1, pendingSkills: 3 })
      .mockResolvedValueOnce({ completedSkills: 2, pendingSkills: 3 });
    const findUnique = vi.fn();
    const skillProgressCreate = vi
      .fn()
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({});
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        worksheetBatch: { update },
        batchSkillProgress: { create: skillProgressCreate },
      };
      return cb(tx);
    });
    const prisma = {
      worksheetBatch: { update, findUnique, updateMany: vi.fn() },
      batchSkillProgress: { create: skillProgressCreate },
      $transaction: transaction,
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
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
      const tx = {
        worksheetBatch: { update: vi.fn() },
        batchSkillProgress: { create: skillProgressCreate },
      };
      return cb(tx);
    });
    const prisma = {
      worksheetBatch: { update: vi.fn(), updateMany: vi.fn(), findUnique: vi.fn() },
      batchSkillProgress: { create: skillProgressCreate },
      $transaction: transaction,
    } as unknown as PrismaClient;

    await expect(
      incrementBatchCompletedSkills(prisma, 'b1', 'skill-1')
    ).rejects.toThrow(/connection refused/);
  });

  it('PARTIAL-FAILURE rollback: counter-update failure inside $transaction propagates so the dedup is NOT poisoned', async () => {
    // This is the regression test for the central correctness fix.
    // Before this PR fixed it, the flow was:
    //   1. batchSkillProgress.create → succeeds (row written)
    //   2. worksheetBatch.update      → fails  (counter NOT incremented)
    // The dedup row was already in the DB, so the next retry would hit
    // P2002 and return idempotent:true without ever incrementing the
    // counter. The batch was permanently short by 1.
    //
    // With both writes inside $transaction, step-2 failure rolls back
    // step 1. The error propagates to the caller; Postgres clears the
    // dedup row; the next retry's INSERT succeeds and the counter
    // moves forward as it should.
    //
    // We can't actually exercise the Postgres rollback in a unit test
    // (that would need a real DB), but we CAN verify that:
    //   (a) the failure inside the tx propagates to the caller, AND
    //   (b) the inserts are wrapped in $transaction (the rollback
    //       contract is then a Postgres invariant we trust).
    const { prisma, transaction } = mockPrisma(
      { completedSkills: 0, pendingSkills: 3 },
      { counterUpdateFails: true }
    );
    await expect(
      incrementBatchCompletedSkills(prisma, 'b1', 'skill-1')
    ).rejects.toThrow(/counter update failed/);
    // Both writes were attempted inside the same transactional callback.
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});
