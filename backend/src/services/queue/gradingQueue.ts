import config from '../../config/env';
import { CloudflareQueueClient } from './cloudflareQueueClient';

export interface GradingQueueMessageV1 {
    v: 1;
    jobId: string;
    enqueuedAt: string;
}

export interface PulledQueueMessage {
    id: string;
    ackToken: string;
    attempts: number;
    body: unknown;
}

export interface GradingQueueClient {
    publish(message: GradingQueueMessageV1): Promise<void>;
    pull(batchSize: number): Promise<PulledQueueMessage[]>;
    ack(ackTokens: string[]): Promise<void>;
}

let cachedClient: GradingQueueClient | null = null;

export function createGradingQueueMessage(jobId: string, enqueuedAt = new Date()): GradingQueueMessageV1 {
    return {
        v: 1,
        jobId,
        enqueuedAt: enqueuedAt.toISOString()
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function normalizePayload(payload: unknown): unknown {
    if (typeof payload !== 'string') {
        return payload;
    }

    try {
        return JSON.parse(payload);
    } catch {
        // Try base64-encoded JSON body fallback.
    }

    try {
        const decoded = Buffer.from(payload, 'base64').toString('utf8');
        return JSON.parse(decoded);
    } catch {
        return payload;
    }
}

export function parseGradingQueueMessage(payload: unknown): GradingQueueMessageV1 {
    const normalizedPayload = normalizePayload(payload);

    if (!isObject(normalizedPayload)) {
        throw new Error('Queue message must be an object');
    }

    const { v, jobId, enqueuedAt } = normalizedPayload;

    if (v !== 1) {
        throw new Error(`Unsupported message version: ${String(v)}`);
    }

    if (typeof jobId !== 'string' || jobId.trim().length === 0) {
        throw new Error('Queue message jobId is required');
    }

    if (typeof enqueuedAt !== 'string' || Number.isNaN(Date.parse(enqueuedAt))) {
        throw new Error('Queue message enqueuedAt must be an ISO timestamp');
    }

    return {
        v: 1,
        jobId,
        enqueuedAt
    };
}

export function getGradingQueueClient(): GradingQueueClient {
    if (config.grading.queueMode !== 'cloudflare') {
        throw new Error(`Queue client unavailable for mode: ${config.grading.queueMode}`);
    }

    if (cachedClient) {
        return cachedClient;
    }

    cachedClient = new CloudflareQueueClient({
        accountId: config.cloudflare.accountId,
        queueId: config.cloudflare.queueId,
        apiToken: config.cloudflare.apiToken,
        consumerName: config.cloudflare.consumerName,
        apiBaseUrl: config.cloudflare.apiBaseUrl
    });

    return cachedClient;
}
