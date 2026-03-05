import fetch from 'node-fetch';
import { GradingQueueClient, PulledQueueMessage } from './gradingQueue';

interface CloudflareQueueClientOptions {
    accountId: string;
    queueId: string;
    apiToken: string;
    consumerName: string;
    apiBaseUrl: string;
}

interface CloudflareApiError {
    code: number;
    message: string;
}

interface CloudflareApiResponse<T> {
    success: boolean;
    errors?: CloudflareApiError[];
    result: T;
}

interface CloudflarePullMessage {
    id?: string;
    body?: unknown;
    lease_id?: string;
    attempts?: number;
}

interface CloudflarePullResult {
    messages?: CloudflarePullMessage[];
}

export class CloudflareQueueClient implements GradingQueueClient {
    private readonly basePath: string;
    private readonly apiToken: string;

    constructor(options: CloudflareQueueClientOptions) {
        if (!options.accountId || !options.queueId || !options.apiToken) {
            throw new Error('Cloudflare queue configuration is incomplete');
        }

        const normalizedBase = options.apiBaseUrl.replace(/\/$/, '');
        const accountId = encodeURIComponent(options.accountId);
        const queueId = encodeURIComponent(options.queueId);
        this.basePath = `${normalizedBase}/accounts/${accountId}/queues/${queueId}`;
        this.apiToken = options.apiToken;
    }

    async publish(message: object): Promise<void> {
        await this.request<unknown>(`${this.basePath}/messages`, {
            method: 'POST',
            body: JSON.stringify({
                body: message
            })
        });
    }

    async pull(batchSize: number): Promise<PulledQueueMessage[]> {
        const result = await this.request<CloudflarePullResult>(`${this.basePath}/messages/pull`, {
            method: 'POST',
            body: JSON.stringify({
                batch_size: Math.max(1, batchSize)
            })
        });

        const messages = result.messages || [];

        return messages
            .filter((msg) => typeof msg.lease_id === 'string' && msg.lease_id.length > 0)
            .map((msg) => ({
                id: msg.id || msg.lease_id || 'unknown',
                ackToken: msg.lease_id as string,
                attempts: typeof msg.attempts === 'number' ? msg.attempts : 1,
                body: msg.body
            }));
    }

    async ack(ackTokens: string[]): Promise<void> {
        if (ackTokens.length === 0) {
            return;
        }

        await this.request<unknown>(`${this.basePath}/messages/ack`, {
            method: 'POST',
            body: JSON.stringify({
                acks: ackTokens.map((leaseId) => ({ lease_id: leaseId })),
                retries: []
            })
        });
    }

    private async request<T>(url: string, init: { method: string; body?: string }): Promise<T> {
        const response = await fetch(url, {
            method: init.method,
            headers: {
                Authorization: `Bearer ${this.apiToken}`,
                'Content-Type': 'application/json'
            },
            body: init.body
        });

        const textBody = await response.text();

        if (!response.ok) {
            throw new Error(`Cloudflare queue request failed (${response.status}): ${textBody}`);
        }

        let payload: CloudflareApiResponse<T>;
        try {
            payload = JSON.parse(textBody) as CloudflareApiResponse<T>;
        } catch {
            throw new Error('Cloudflare queue response was not valid JSON');
        }

        if (!payload.success) {
            const errorMessage = payload.errors?.map((err) => err.message).join('; ') || 'Unknown Cloudflare queue error';
            throw new Error(errorMessage);
        }

        return payload.result;
    }
}
