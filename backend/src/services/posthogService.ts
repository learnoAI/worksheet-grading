import fetch from 'node-fetch';
import os from 'os';
import config from '../config/env';
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
    const payload = {
        api_key: apiKey,
        event,
        distinct_id: distinctId,
        properties: sanitizeProperties({
            runtime: 'backend',
            ...PROCESS_METADATA,
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

