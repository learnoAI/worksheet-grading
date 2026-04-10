import { randomUUID } from 'crypto';
import { NextFunction, Request, Response } from 'express';
import config from '../config/env';
import { summarizeRequestBodyShape } from '../services/gradingDiagnostics';
import { apiLogger } from '../services/logger';
import { capturePosthogEvent } from '../services/posthogService';
import { runWithRequestContext } from './requestContext';

function getDurationMs(startedAt: [number, number]): number {
    const [seconds, nanoseconds] = process.hrtime(startedAt);
    return Math.round((seconds * 1000) + (nanoseconds / 1_000_000));
}

function getPath(req: Request): string {
    const url = req.originalUrl || req.url || req.path || '/';
    return url.split('?')[0] || '/';
}

function getCategory(path: string): string {
    if (path.startsWith('/internal/grading-worker/')) {
        return 'internal_grading_worker';
    }

    if (path.startsWith('/api/grading-jobs/')) {
        return 'grading_jobs_api';
    }

    if (path.startsWith('/api/worksheet-processing/')) {
        return 'worksheet_processing_api';
    }

    if (path.startsWith('/api/analytics/')) {
        return 'analytics_api';
    }

    return 'other';
}

function getRequestId(req: Request, res: Response): string {
    const existingRequestId = req.get('x-request-id');
    if (existingRequestId) {
        res.setHeader('X-Request-Id', existingRequestId);
        return existingRequestId;
    }

    const requestId = randomUUID();
    res.setHeader('X-Request-Id', requestId);
    return requestId;
}

function buildDiagnosticsPayload(
    req: Request,
    requestId: string,
    statusCode: number,
    durationMs: number,
    aborted: boolean
): Record<string, unknown> {
    const path = getPath(req);
    const payload: Record<string, unknown> = {
        requestId,
        method: req.method,
        path,
        statusCode,
        durationMs,
        aborted,
        category: getCategory(path),
        contentLength: req.get('content-length')
    };

    if (typeof req.params.jobId === 'string') {
        payload.jobId = req.params.jobId;
    }

    if (typeof req.params.classId === 'string') {
        payload.classId = req.params.classId;
    }

    if (path.includes('/grading')) {
        payload.requestBodySummary = summarizeRequestBodyShape(req.body);
    }

    return payload;
}

export function requestDiagnostics(req: Request, res: Response, next: NextFunction): void {
    if (!config.diagnostics.enabled) {
        next();
        return;
    }

    const startedAt = process.hrtime();
    const requestId = getRequestId(req, res);
    let finalized = false;

    const finalize = (aborted: boolean) => {
        if (finalized) {
            return;
        }

        finalized = true;
        const durationMs = getDurationMs(startedAt);
        const statusCode = aborted ? 499 : res.statusCode;
        const isSlow = durationMs >= config.diagnostics.slowRequestMs;
        const isServerError = statusCode >= 500;

        if (!aborted && !isServerError && !isSlow) {
            return;
        }

        const payload = buildDiagnosticsPayload(req, requestId, statusCode, durationMs, aborted);
        const message = aborted
            ? 'Request aborted before response completed'
            : isServerError
                ? 'Request failed with server error'
                : 'Slow request detected';

        if (aborted || isServerError) {
            apiLogger.error(message, payload);
        } else {
            apiLogger.warn(message, payload);
        }

        void capturePosthogEvent('backend_request_diagnostic', requestId, {
            ...payload,
            diagnosticType: aborted ? 'aborted' : isServerError ? 'server_error' : 'slow_request'
        });
    };

    res.once('finish', () => finalize(false));
    res.once('close', () => {
        if (!res.writableEnded) {
            finalize(true);
        }
    });

    // Run the downstream chain inside an AsyncLocalStorage context so any code
    // spawned by this request (handlers, workers, PostHog captures) can inherit
    // the requestId without every call site threading it explicitly.
    runWithRequestContext({ requestId }, () => next());
}
