import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Prisma BEFORE importing the service so the module-level singleton
// is replaced. Mirrors the pattern used in
// `internalGradingWorkerController.test.ts`.
const prismaMocks = vi.hoisted(() => ({
    worksheetBatch: {
        update: vi.fn(),
    },
    batchSkillProgress: {
        create: vi.fn(),
    },
    generatedWorksheet: {
        findMany: vi.fn(),
        update: vi.fn(),
    },
}));

vi.mock('../utils/prisma', () => ({
    default: prismaMocks,
}));

// `assembleAndEnqueuePdfs` is a private export inside worksheetBatchService.
// We can't easily mock it (it's not re-exported), but we don't need to —
// the dedup branch returns BEFORE it's called, and the flip-batch branch
// also runs through it without us asserting on it. The downstream Prisma
// calls (`generatedWorksheet.findMany`) are stubbed empty so the assembly
// is a no-op.

// Inline mocks for transitive services that worksheetBatchService imports
// at the module level. Keeps the test self-contained.
vi.mock('./worksheetSchedulerService', () => ({
    planWorksheets: vi.fn(),
}));
vi.mock('./worksheetGenerationService', () => ({
    buildSections: vi.fn(),
}));
vi.mock('./queue/questionGenerationQueue', () => ({
    enqueueQuestionGeneration: vi.fn(),
    createQuestionGenMessage: vi.fn(),
}));
vi.mock('./queue/pdfRenderingQueue', () => ({
    enqueuePdfRendering: vi.fn(),
    createPdfRenderMessage: vi.fn(),
}));

import { onSkillQuestionsReady } from './worksheetBatchService';

beforeEach(() => {
    prismaMocks.worksheetBatch.update.mockReset();
    prismaMocks.batchSkillProgress.create.mockReset();
    prismaMocks.generatedWorksheet.findMany.mockReset();
    prismaMocks.generatedWorksheet.update.mockReset();
});

describe('onSkillQuestionsReady — first-time + flip', () => {
    it('records BatchSkillProgress + increments completedSkills; returns idempotent:false when more skills pending', async () => {
        prismaMocks.batchSkillProgress.create.mockResolvedValueOnce({});
        prismaMocks.worksheetBatch.update.mockResolvedValueOnce({
            completedSkills: 1,
            pendingSkills: 3,
        });

        const result = await onSkillQuestionsReady('b-1', 'skill-1');

        expect(result.idempotent).toBe(false);
        // Dedup record inserted with the composite PK.
        expect(prismaMocks.batchSkillProgress.create).toHaveBeenCalledWith({
            data: { batchId: 'b-1', mathSkillId: 'skill-1' },
        });
        // Counter incremented exactly once.
        expect(prismaMocks.worksheetBatch.update).toHaveBeenCalledTimes(1);
        expect(prismaMocks.worksheetBatch.update).toHaveBeenCalledWith({
            where: { id: 'b-1' },
            data: { completedSkills: { increment: 1 } },
        });
    });

    it('flips batch to RENDERING_PDFS when completedSkills reaches pendingSkills', async () => {
        prismaMocks.batchSkillProgress.create.mockResolvedValueOnce({});
        prismaMocks.worksheetBatch.update
            .mockResolvedValueOnce({ completedSkills: 3, pendingSkills: 3 })
            .mockResolvedValueOnce({}); // status flip
        prismaMocks.generatedWorksheet.findMany.mockResolvedValueOnce([]);

        const result = await onSkillQuestionsReady('b-1', 'skill-1');

        expect(result.idempotent).toBe(false);
        // Second update flips the status.
        expect(prismaMocks.worksheetBatch.update).toHaveBeenNthCalledWith(2, {
            where: { id: 'b-1' },
            data: { status: 'RENDERING_PDFS' },
        });
    });
});

describe('onSkillQuestionsReady — idempotent replays (CF Queue redelivery)', () => {
    it('returns idempotent:true and SKIPS counter when BatchSkillProgress.create raises P2002', async () => {
        const p2002 = Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
        });
        prismaMocks.batchSkillProgress.create.mockRejectedValueOnce(p2002);

        const result = await onSkillQuestionsReady('b-1', 'skill-1');

        expect(result.idempotent).toBe(true);
        // CRITICAL: counter MUST NOT be touched on a replay.
        expect(prismaMocks.worksheetBatch.update).not.toHaveBeenCalled();
    });

    it('three replayed calls for the same (batchId, mathSkillId) increment counter exactly once', async () => {
        const p2002 = Object.assign(new Error('Unique constraint failed'), {
            code: 'P2002',
        });
        // First: dedup insert succeeds → counter +1.
        // Next two: P2002 → counter NOT touched.
        prismaMocks.batchSkillProgress.create
            .mockResolvedValueOnce({})
            .mockRejectedValueOnce(p2002)
            .mockRejectedValueOnce(p2002);
        prismaMocks.worksheetBatch.update.mockResolvedValue({
            completedSkills: 1,
            pendingSkills: 3,
        });

        const r1 = await onSkillQuestionsReady('b-1', 'skill-1');
        const r2 = await onSkillQuestionsReady('b-1', 'skill-1');
        const r3 = await onSkillQuestionsReady('b-1', 'skill-1');

        expect(r1.idempotent).toBe(false);
        expect(r2.idempotent).toBe(true);
        expect(r3.idempotent).toBe(true);
        expect(prismaMocks.worksheetBatch.update).toHaveBeenCalledTimes(1);
    });

    it('re-throws non-P2002 errors from the dedup insert', async () => {
        prismaMocks.batchSkillProgress.create.mockRejectedValueOnce(
            new Error('connection refused')
        );
        await expect(onSkillQuestionsReady('b-1', 'skill-1')).rejects.toThrow(
            /connection refused/
        );
        expect(prismaMocks.worksheetBatch.update).not.toHaveBeenCalled();
    });
});
