import fetch from 'node-fetch';
import config from '../config/env';

type PosthogProperties = Record<string, unknown>;

const DEFAULT_POSTHOG_HOST = 'https://us.i.posthog.com';
const POSTHOG_CAPTURE_PATH = '/capture/';
const POSTHOG_EVENT_NAME = 'grading_pipeline';

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
    } catch {
        // Telemetry is best effort; never block grading flow.
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

