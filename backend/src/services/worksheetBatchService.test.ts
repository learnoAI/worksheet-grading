import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock Prisma BEFORE importing the service so the module-level singleton
// is replaced. Mirrors the pattern used in
// `internalGradingWorkerController.test.ts`.
const prismaMocks = vi.hoisted(() => {
    const worksheetBatch = {
        update: vi.fn(),
        updateMany: vi.fn(),
    };
    const batchSkillProgress = {
        create: vi.fn(),
    };
    return {
        worksheetBatch,
        batchSkillProgress,
        generatedWorksheet: {
            findMany: vi.fn(),
            update: vi.fn(),
        },
        // `$transaction(cb)` invokes the callback with a tx proxy whose
        // worksheetBatch.update and batchSkillProgress.create are the
        // SAME mocks as the outer object — so test assertions on those
        // mocks see calls made inside the transactional callback too.
        // Rejections inside the callback propagate to the caller, which
        // is exactly the contract Prisma's $transaction provides under
        // a real DB (the rollback itself is a Postgres invariant we
        // can't simulate in a unit test).
        $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) => {
            const tx = {
                worksheetBatch,
                batchSkillProgress,
            };
            return cb(tx);
        }),
    };
});

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
    prismaMocks.worksheetBatch.updateMany.mockReset();
    prismaMocks.batchSkillProgress.create.mockReset();
    prismaMocks.generatedWorksheet.findMany.mockReset();
    prismaMocks.generatedWorksheet.update.mockReset();
    // Restore the default $transaction shim. The mock is reset between
    // tests so per-test rejection scenarios re-apply cleanly.
    prismaMocks.$transaction.mockReset();
    prismaMocks.$transaction.mockImplementation(async (cb: (tx: unknown) => Promise<unknown>) => {
        const tx = {
            worksheetBatch: prismaMocks.worksheetBatch,
            batchSkillProgress: prismaMocks.batchSkillProgress,
        };
        return cb(tx);
    });
});

describe('onSkillQuestionsReady — first-time + flip', () => {
    it('records BatchSkillProgress + increments completedSkills inside a $transaction', async () => {
        prismaMocks.batchSkillProgress.create.mockResolvedValueOnce({});
        prismaMocks.worksheetBatch.update.mockResolvedValueOnce({
            completedSkills: 1,
            pendingSkills: 3,
        });

        const result = await onSkillQuestionsReady('b-1', 'skill-1');

        expect(result.idempotent).toBe(false);
        // Both writes ran inside one transactional callback — critical
        // for partial-failure safety.
        expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1);
        expect(prismaMocks.batchSkillProgress.create).toHaveBeenCalledWith({
            data: { batchId: 'b-1', mathSkillId: 'skill-1' },
        });
        expect(prismaMocks.worksheetBatch.update).toHaveBeenCalledWith({
            where: { id: 'b-1' },
            data: { completedSkills: { increment: 1 } },
            select: { completedSkills: true, pendingSkills: true },
        });
    });

    it('flips batch to RENDERING_PDFS via race-safe updateMany when completedSkills reaches pendingSkills', async () => {
        prismaMocks.batchSkillProgress.create.mockResolvedValueOnce({});
        prismaMocks.worksheetBatch.update.mockResolvedValueOnce({
            completedSkills: 3,
            pendingSkills: 3,
        });
        prismaMocks.worksheetBatch.updateMany.mockResolvedValueOnce({ count: 1 });
        prismaMocks.generatedWorksheet.findMany.mockResolvedValueOnce([]);

        const result = await onSkillQuestionsReady('b-1', 'skill-1');

        expect(result.idempotent).toBe(false);
        // Race-safe flip: updateMany gated on the prior status so only
        // the first crosser triggers downstream assembly.
        expect(prismaMocks.worksheetBatch.updateMany).toHaveBeenCalledWith({
            where: { id: 'b-1', status: 'GENERATING_QUESTIONS' },
            data: { status: 'RENDERING_PDFS' },
        });
    });

    it('does NOT trigger assembleAndEnqueuePdfs when the race-safe flip returns count:0 (concurrent racer)', async () => {
        prismaMocks.batchSkillProgress.create.mockResolvedValueOnce({});
        prismaMocks.worksheetBatch.update.mockResolvedValueOnce({
            completedSkills: 3,
            pendingSkills: 3,
        });
        // Another caller already flipped the status — we got count: 0
        // and MUST NOT call assembleAndEnqueuePdfs (which would
        // double-enqueue PDF rendering).
        prismaMocks.worksheetBatch.updateMany.mockResolvedValueOnce({ count: 0 });

        const result = await onSkillQuestionsReady('b-1', 'skill-1');

        expect(result.idempotent).toBe(false);
        // findMany would have been called if assembly ran.
        expect(prismaMocks.generatedWorksheet.findMany).not.toHaveBeenCalled();
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

    it('PARTIAL-FAILURE rollback: counter-update failure inside $transaction propagates', async () => {
        // Before the atomicity fix, this scenario was the silent
        // counter-loss bug: the dedup row stayed written, but the
        // counter never advanced. With both writes inside $transaction,
        // Postgres rolls back the dedup row on counter-write failure;
        // the error propagates up to the caller.
        prismaMocks.batchSkillProgress.create.mockResolvedValueOnce({});
        prismaMocks.worksheetBatch.update.mockRejectedValueOnce(
            new Error('counter update failed')
        );

        await expect(onSkillQuestionsReady('b-1', 'skill-1')).rejects.toThrow(
            /counter update failed/
        );
        // Both attempts ran inside the same transactional callback.
        expect(prismaMocks.$transaction).toHaveBeenCalledTimes(1);
    });
});
