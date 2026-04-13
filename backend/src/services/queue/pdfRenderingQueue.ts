import { CloudflareQueueClient } from './cloudflareQueueClient';
import config from '../../config/env';

export interface PdfRenderQueueMessage {
    v: 1;
    worksheetId: string;
    batchId: string;
    enqueuedAt: string;
}

let cachedClient: CloudflareQueueClient | null = null;

function getPdfRenderQueueClient(): CloudflareQueueClient {
    if (cachedClient) return cachedClient;

    cachedClient = new CloudflareQueueClient({
        accountId: config.cloudflare.accountId,
        queueId: config.worksheetGeneration.pdfQueueId,
        apiToken: config.cloudflare.apiToken,
        consumerName: 'pdf-renderer',
        apiBaseUrl: config.cloudflare.apiBaseUrl
    });

    return cachedClient;
}

export function createPdfRenderMessage(
    worksheetId: string,
    batchId: string
): PdfRenderQueueMessage {
    return {
        v: 1,
        worksheetId,
        batchId,
        enqueuedAt: new Date().toISOString()
    };
}

export async function enqueuePdfRendering(message: PdfRenderQueueMessage): Promise<void> {
    const client = getPdfRenderQueueClient();
    await client.publish(message);
}
