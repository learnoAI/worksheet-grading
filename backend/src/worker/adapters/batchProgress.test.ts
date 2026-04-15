import { describe, expect, it, beforeEach, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { onWorksheetPdfComplete, incrementBatchCompletedSkills } from './batchProgress';

function mockPrisma(initial: {
  completedWorksheets?: number;
  failedWorksheets?: number;
  totalWorksheets?: number;
  completedSkills?: number;
  pendingSkills?: number;
}) {
  const update = vi.fn();
  const prisma = { worksheetBatch: { update } } as unknown as PrismaClient;

  // First call to update returns the incremented row; subsequent calls return
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

  return { prisma, update };
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

describe('incrementBatchCompletedSkills', () => {
  beforeEach(() => vi.clearAllMocks());

  it('increments completedSkills and does NOT flip when more skills pending', async () => {
    const { prisma, update } = mockPrisma({
      completedSkills: 0,
      pendingSkills: 3,
    });
    const result = await incrementBatchCompletedSkills(prisma, 'b1');
    expect(result.flipped).toBe(false);
    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      where: { id: 'b1' },
      data: { completedSkills: { increment: 1 } },
    });
  });

  it('flips batch to RENDERING_PDFS when completedSkills reaches pendingSkills', async () => {
    const { prisma, update } = mockPrisma({
      completedSkills: 2,
      pendingSkills: 3,
    });
    const result = await incrementBatchCompletedSkills(prisma, 'b1');
    expect(result.flipped).toBe(true);
    expect(update).toHaveBeenCalledTimes(2);
    expect(update).toHaveBeenNthCalledWith(2, {
      where: { id: 'b1' },
      data: { status: 'RENDERING_PDFS' },
    });
  });
});
