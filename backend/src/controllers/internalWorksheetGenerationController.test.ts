import { beforeEach, describe, expect, it, vi } from 'vitest';

// Controllers wrap their writes in `prisma.$transaction(cb)`. The
// pass-through shim invokes the callback with the same mock so per-model
// spies (`updateMany`, etc.) capture both transactional and direct calls.
const prismaMocks: {
    generatedWorksheet: {
        findUnique: ReturnType<typeof vi.fn>;
        updateMany: ReturnType<typeof vi.fn>;
    };
    $transaction: (cb: (tx: unknown) => unknown) => Promise<unknown>;
} = vi.hoisted(() => {
    const mocks = {
        generatedWorksheet: {
            findUnique: vi.fn(),
            updateMany: vi.fn(),
        },
        $transaction: async (cb: (tx: unknown) => unknown) => cb(mocks),
    };
    return mocks;
});

vi.mock('../utils/prisma', () => ({
    default: prismaMocks,
}));

const batchServiceMocks = vi.hoisted(() => ({
    onWorksheetPdfComplete: vi.fn(),
}));

vi.mock('../services/worksheetBatchService', () => ({
    onWorksheetPdfComplete: batchServiceMocks.onWorksheetPdfComplete,
}));

import { completeWorksheet, failWorksheet } from './internalWorksheetGenerationController';

// Minimal Request/Response stubs — these controllers only touch `params`,
// `body`, `status()`, and `json()`. Keep the stubs lean and cast to `any`
// at call-sites; mirroring the pattern used in
// `internalGradingWorkerController.test.ts`.
interface ResStub {
    statusCode: number;
    body: unknown;
    status: (n: number) => ResStub;
    json: (b: unknown) => ResStub;
}

function makeRes(): ResStub {
    const res: ResStub = {
        statusCode: 200,
        body: undefined,
        status(n: number) {
            res.statusCode = n;
            return res;
        },
        json(b: unknown) {
            res.body = b;
            return res;
        },
    };
    return res;
}

function makeReq(params: Record<string, string>, body: Record<string, unknown> = {}) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return { params, body } as any;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const asExpressRes = (r: ResStub) => r as any;

beforeEach(() => {
    prismaMocks.generatedWorksheet.findUnique.mockReset();
    prismaMocks.generatedWorksheet.updateMany.mockReset();
    batchServiceMocks.onWorksheetPdfComplete.mockReset();
});

describe('completeWorksheet — first-time transitions', () => {
    it('returns 400 if pdfUrl missing', async () => {
        const res = makeRes();
        await completeWorksheet(makeReq({ id: 'ws-1' }, { batchId: 'b-1' }), asExpressRes(res));
        expect(res.statusCode).toBe(400);
        expect(res.body).toEqual({ success: false, error: 'pdfUrl required' });
        // No DB write attempted.
        expect(prismaMocks.generatedWorksheet.updateMany).not.toHaveBeenCalled();
    });

    it('updates row + increments batch counter on first call (count=1)', async () => {
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 1 });

        const res = makeRes();
        await completeWorksheet(
            makeReq({ id: 'ws-1' }, { pdfUrl: 'https://r2/...pdf', batchId: 'b-1' }),
            asExpressRes(res)
        );

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true });

        // Conditional update with status guard.
        expect(prismaMocks.generatedWorksheet.updateMany).toHaveBeenCalledWith({
            where: { id: 'ws-1', status: { notIn: ['COMPLETED', 'FAILED'] } },
            data: { pdfUrl: 'https://r2/...pdf', status: 'COMPLETED' },
        });
        // Batch counter fires (failed=false).
        expect(batchServiceMocks.onWorksheetPdfComplete).toHaveBeenCalledWith(prismaMocks, 'b-1', false);
        // Replay-detection follow-up not needed when count>0.
        expect(prismaMocks.generatedWorksheet.findUnique).not.toHaveBeenCalled();
    });

    it('does not invoke onWorksheetPdfComplete when batchId omitted (single-render flow)', async () => {
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 1 });

        const res = makeRes();
        await completeWorksheet(makeReq({ id: 'ws-1' }, { pdfUrl: 'https://r2/...' }), asExpressRes(res));

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(batchServiceMocks.onWorksheetPdfComplete).not.toHaveBeenCalled();
    });

    it('rolls back when the batch counter throws — returns 503 so consumers retry', async () => {
        // Regression for the leak that S28's idempotency fix narrowed but
        // did not eliminate: if `onWorksheetPdfComplete` throws AFTER the
        // row went terminal, the row would have stayed terminal forever
        // while the counter never moved — subsequent retries would find
        // the row already terminal and skip the counter, leaving the
        // batch stuck on RENDERING_PDFS. Wrapping both writes in
        // $transaction means a counter failure rolls back the status
        // flip too; the controller surfaces 503 specifically so the
        // pdf-renderer's existing retry-token match
        // (`errorMsg.includes('503')`) triggers `message.retry()` — a
        // generic 500 would fall through to `message.ack()` and lose
        // the failure.
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 1 });
        batchServiceMocks.onWorksheetPdfComplete.mockRejectedValueOnce(new Error('db down'));
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

        const res = makeRes();
        await completeWorksheet(makeReq({ id: 'ws-1' }, { pdfUrl: 'x', batchId: 'b-1' }), asExpressRes(res));

        expect(res.statusCode).toBe(503);
        expect(res.body).toEqual({ success: false, error: 'Failed to record completion' });
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});

describe('completeWorksheet — idempotent replays + 404', () => {
    it('returns 404 when count=0 AND the row does not exist', async () => {
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 0 });
        prismaMocks.generatedWorksheet.findUnique.mockResolvedValueOnce(null);

        const res = makeRes();
        await completeWorksheet(makeReq({ id: 'missing' }, { pdfUrl: 'x', batchId: 'b-1' }), asExpressRes(res));

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'Worksheet not found' });
        // Batch counter MUST NOT increment for nonexistent rows.
        expect(batchServiceMocks.onWorksheetPdfComplete).not.toHaveBeenCalled();
    });

    it('returns {success:true, idempotent:true} when count=0 AND the row exists (replay of COMPLETED/FAILED)', async () => {
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 0 });
        prismaMocks.generatedWorksheet.findUnique.mockResolvedValueOnce({ id: 'ws-1' });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = makeRes();
        await completeWorksheet(makeReq({ id: 'ws-1' }, { pdfUrl: 'x', batchId: 'b-1' }), asExpressRes(res));

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true, idempotent: true });
        // CRITICAL: counter must NOT fire on replay.
        expect(batchServiceMocks.onWorksheetPdfComplete).not.toHaveBeenCalled();
        // Observability: structured warn so oncall can grep app_logs
        // for CF Queue redelivery rate.
        expect(warnSpy).toHaveBeenCalledWith(
            '[ws-gen] idempotent replay',
            expect.objectContaining({ id: 'ws-1', route: 'complete', batchId: 'b-1' })
        );
        warnSpy.mockRestore();
    });

    it('three replayed /complete calls increment the batch counter exactly once', async () => {
        // First call transitions PENDING → COMPLETED (count=1).
        // Next two calls find row already terminal (count=0).
        prismaMocks.generatedWorksheet.updateMany
            .mockResolvedValueOnce({ count: 1 })
            .mockResolvedValueOnce({ count: 0 })
            .mockResolvedValueOnce({ count: 0 });
        prismaMocks.generatedWorksheet.findUnique
            .mockResolvedValueOnce({ id: 'ws-1' })
            .mockResolvedValueOnce({ id: 'ws-1' });
        // Silence the idempotent-replay warn so test output stays clean;
        // we already verify the warn shape in the dedicated replay test.
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        for (let i = 0; i < 3; i++) {
            const res = makeRes();
            await completeWorksheet(makeReq({ id: 'ws-1' }, { pdfUrl: 'x', batchId: 'b-1' }), asExpressRes(res));
            expect(res.statusCode).toBe(200);
        }
        expect(batchServiceMocks.onWorksheetPdfComplete).toHaveBeenCalledTimes(1);
        expect(batchServiceMocks.onWorksheetPdfComplete).toHaveBeenCalledWith(prismaMocks, 'b-1', false);
        // 2 replays → exactly 2 warns.
        expect(warnSpy).toHaveBeenCalledTimes(2);
        warnSpy.mockRestore();
    });
});

describe('failWorksheet — first-time + replays', () => {
    it('updates row + increments failedWorksheets counter on first call', async () => {
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 1 });

        const res = makeRes();
        await failWorksheet(makeReq({ id: 'ws-1' }, { batchId: 'b-1' }), asExpressRes(res));

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true });
        expect(prismaMocks.generatedWorksheet.updateMany).toHaveBeenCalledWith({
            where: { id: 'ws-1', status: { notIn: ['COMPLETED', 'FAILED'] } },
            data: { status: 'FAILED' },
        });
        expect(batchServiceMocks.onWorksheetPdfComplete).toHaveBeenCalledWith(prismaMocks, 'b-1', true);
    });

    it('replay of /fail after the worksheet is already FAILED → idempotent + no counter', async () => {
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 0 });
        prismaMocks.generatedWorksheet.findUnique.mockResolvedValueOnce({ id: 'ws-1' });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = makeRes();
        await failWorksheet(makeReq({ id: 'ws-1' }, { batchId: 'b-1' }), asExpressRes(res));

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true, idempotent: true });
        expect(batchServiceMocks.onWorksheetPdfComplete).not.toHaveBeenCalled();
        warnSpy.mockRestore();
    });

    it('cross-state replay: /fail after /complete already succeeded → idempotent, neither counter fires twice, observability log fires with route=fail', async () => {
        // Row is already COMPLETED (transition happened on a prior /complete
        // call) → updateMany finds nothing in non-terminal state → idempotent.
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 0 });
        prismaMocks.generatedWorksheet.findUnique.mockResolvedValueOnce({ id: 'ws-1' });
        const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

        const res = makeRes();
        await failWorksheet(makeReq({ id: 'ws-1' }, { batchId: 'b-1' }), asExpressRes(res));

        expect(res.statusCode).toBe(200);
        expect(res.body).toEqual({ success: true, idempotent: true });
        // Crucial: /fail does NOT increment failedWorksheets when the row
        // already completed successfully on a prior call. Prevents the
        // "transient 503 on /complete → consumer falls back to /fail"
        // scenario from corrupting the batch counter.
        expect(batchServiceMocks.onWorksheetPdfComplete).not.toHaveBeenCalled();
        // route='fail' distinguishes the /fail-replay class on the dashboard.
        expect(warnSpy).toHaveBeenCalledWith(
            '[ws-gen] idempotent replay',
            expect.objectContaining({ id: 'ws-1', route: 'fail', batchId: 'b-1' })
        );
        warnSpy.mockRestore();
    });

    it('returns 404 when row does not exist', async () => {
        prismaMocks.generatedWorksheet.updateMany.mockResolvedValueOnce({ count: 0 });
        prismaMocks.generatedWorksheet.findUnique.mockResolvedValueOnce(null);

        const res = makeRes();
        await failWorksheet(makeReq({ id: 'missing' }, { batchId: 'b-1' }), asExpressRes(res));

        expect(res.statusCode).toBe(404);
        expect(res.body).toEqual({ success: false, error: 'Worksheet not found' });
        expect(batchServiceMocks.onWorksheetPdfComplete).not.toHaveBeenCalled();
    });
});
