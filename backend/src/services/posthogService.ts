import fetch from 'node-fetch';
import os from 'os';
import config from '../config/env';
import { requestContextStore } from '../middleware/requestContext';
import { apiLogger } from './logger';

type PosthogProperties = Record<string, unknown>;

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const POSTHOG_CAPTURE_PATH = '/capture/';
const POSTHOG_EVENT_NAME = 'grading_pipeline';
const SERVICE_NAME = 'worksheet-grading-backend';

// Computed once per process — cheap constants stamped on every event so
// dashboards can filter by env/release/host without each caller passing them.
const PROCESS_METADATA: PosthogProperties = {
    service: SERVICE_NAME,
    environment: process.env.NODE_ENV || 'unknown',
    release: process.env.GIT_SHA || process.env.RELEASE || 'unknown',
    hostname: os.hostname()
};

// Module-level counter so later phases can expose transport health (e.g. via /health).
let transportErrorCount = 0;

export function getPosthogTransportErrorCount(): number {
    return transportErrorCount;
}

function normalizeHost(rawHost: string): string {
    return rawHost.replace(/\/+$/, '');
}

function sanitizeProperties(properties: PosthogProperties): PosthogProperties {
    const sanitized: PosthogProperties = {};
    for (const [key, value] of Object.entries(properties)) {
        if (value === undefined) {
            continue;
        }

        if (value instanceof Date) {
            sanitized[key] = value.toISOString();
            continue;
        }

        sanitized[key] = value;
    }

    return sanitized;
}

function isEnabled(): boolean {
    return Boolean(config.posthog.apiKey);
}

export async function capturePosthogEvent(
    event: string,
    distinctId: string,
    properties: PosthogProperties = {}
): Promise<void> {
    if (!isEnabled()) {
        return;
    }

    const apiKey = config.posthog.apiKey;
    if (!apiKey) {
        return;
    }

    const host = normalizeHost(config.posthog.host || DEFAULT_POSTHOG_HOST);
    // When this capture happens inside an Express request, pick up the
    // request-scoped context (requestId, sessionId, userId) from AsyncLocalStorage
    // so every downstream event is correlatable without threading ids manually.
    // Undefined fields are filtered inside sanitizeProperties.
    const storeCtx = requestContextStore.getStore();
    const payload = {
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        properties: sanitizeProperties({
            runtime: 'backend',
            ...PROCESS_METADATA,
            ...(storeCtx
                ? {
                      requestId: storeCtx.requestId,
                      sessionId: storeCtx.sessionId,
                      userId: storeCtx.userId
                  }
                : {}),
            ...properties
        })
    };

    try {
        await fetch(`${host}${POSTHOG_CAPTURE_PATH}`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
    } catch (err) {
        transportErrorCount += 1;
        // Telemetry is best effort; log but never block grading flow.
        apiLogger.warn('posthog_capture_failed', {
            event,
            error: err instanceof Error ? err.message : String(err),
            transportErrorCount
        });
    }
}

export function captureGradingPipelineEvent(
    stage: string,
    distinctId: string,
    properties: PosthogProperties = {}
): void {
    void capturePosthogEvent(POSTHOG_EVENT_NAME, distinctId, {
        stage,
        ...properties
    });
}

// ---------------------------------------------------------------------------
// Exception capture (additive — not yet wired into existing error paths).
// ---------------------------------------------------------------------------

export interface PosthogExceptionContext {
    distinctId: string;
    stage?: string;
    fingerprint?: string;
    extra?: PosthogProperties;
}

interface ParsedStackFrame {
    filename: string;
    function: string;
    lineno: number;
    colno: number;
    in_app: boolean;
}

const STACK_FRAME_WITH_NAME = /^\s*at\s+(?:async\s+)?(.+?)\s+\(([^)]+):(\d+):(\d+)\)\s*$/;
const STACK_FRAME_WITHOUT_NAME = /^\s*at\s+(?:async\s+)?([^\s()]+):(\d+):(\d+)\s*$/;

function isInAppFrame(filename: string): boolean {
    if (!filename) {
        return false;
    }
    if (filename.includes('/node_modules/')) {
        return false;
    }
    if (filename.startsWith('node:') || filename.startsWith('internal/')) {
        return false;
    }
    return true;
}

export function parseStackFrames(stack: string | undefined): ParsedStackFrame[] {
    if (!stack) {
        return [];
    }

    const lines = stack.split('\n');
    const frames: ParsedStackFrame[] = [];

    for (const rawLine of lines) {
        const line = rawLine.trimEnd();
        if (!line.startsWith('    at ') && !line.trimStart().startsWith('at ')) {
            continue;
        }

        let match = STACK_FRAME_WITH_NAME.exec(line);
        if (match) {
            const filename = match[2];
            frames.push({
                function: match[1],
                filename,
                lineno: Number(match[3]),
                colno: Number(match[4]),
                in_app: isInAppFrame(filename)
            });
            continue;
        }

        match = STACK_FRAME_WITHOUT_NAME.exec(line);
        if (match) {
            const filename = match[1];
            frames.push({
                function: '<anonymous>',
                filename,
                lineno: Number(match[2]),
                colno: Number(match[3]),
                in_app: isInAppFrame(filename)
            });
        }
    }

    return frames;
}

function toErrorLike(error: unknown): { name: string; message: string; stack: string | undefined; synthetic: boolean } {
    if (error instanceof Error) {
        return {
            name: error.name || 'Error',
            message: error.message,
            stack: error.stack,
            synthetic: false
        };
    }

    if (typeof error === 'string') {
        return { name: 'Error', message: error, stack: undefined, synthetic: true };
    }

    try {
        return { name: 'Error', message: JSON.stringify(error), stack: undefined, synthetic: true };
    } catch {
        return { name: 'Error', message: String(error), stack: undefined, synthetic: true };
    }
}

// Exported for unit tests — kept pure so the shape can be asserted without
// touching HTTP transport.
export function buildExceptionProperties(
    error: unknown,
    ctx: PosthogExceptionContext
): PosthogProperties {
    const normalized = toErrorLike(error);
    const frames = parseStackFrames(normalized.stack);

    const properties: PosthogProperties = {
        $exception_list: [
            {
                type: normalized.name,
                value: normalized.message,
                mechanism: { type: 'generic', handled: true, synthetic: normalized.synthetic },
                stacktrace: { type: 'resolved', frames }
            }
        ],
        // Legacy top-level fields — kept for dashboards/insights built before $exception_list.
        $exception_type: normalized.name,
        $exception_message: normalized.message,
        ...(ctx.stage ? { $exception_source: ctx.stage, stage: ctx.stage } : {}),
        ...(ctx.fingerprint ? { $exception_fingerprint: ctx.fingerprint } : {}),
        ...(ctx.extra || {})
    };

    return properties;
}

export function capturePosthogException(
    error: unknown,
    ctx: PosthogExceptionContext
): void {
    if (!config.posthog.exceptionsEnabled) {
        return;
    }
    void capturePosthogEvent('$exception', ctx.distinctId, buildExceptionProperties(error, ctx));
}

