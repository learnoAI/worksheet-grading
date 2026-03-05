import puppeteer from '@cloudflare/puppeteer';
import { buildFullHtml } from './htmlTemplate';
import { BackendClient } from './backendClient';

interface Env {
    BROWSER: any; // Cloudflare Browser Rendering binding
    PDF_BUCKET: R2Bucket;
    WORKSHEET_CREATION_BACKEND_BASE_URL: string;
    WORKSHEET_CREATION_WORKER_TOKEN: string;
}

interface QueueMessageV1 {
    v: 1;
    worksheetId: string;
    batchId: string;
    enqueuedAt: string;
}

export default {
    async queue(batch: any, env: Env): Promise<void> {
        const backend = new BackendClient(env);
        const messages = (batch.messages || []) as any[];

        for (const message of messages) {
            let worksheetId: string | null = null;
            let batchId: string | null = null;

            try {
                const body = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
                const msg = body as QueueMessageV1;
                worksheetId = msg.worksheetId;
                batchId = msg.batchId;

                if (!worksheetId) {
                    console.error('Missing worksheetId in queue message');
                    message.ack();
                    continue;
                }

                // 1. Fetch worksheet data from backend
                const wsData = await backend.getWorksheetData(worksheetId);
                const sections = wsData.sectionsJson;

                if (!sections || !Array.isArray(sections) || sections.length !== 4) {
                    throw new Error('Invalid sectionsJson');
                }

                // 2. Build HTML
                const html = buildFullHtml(sections);

                // 3. Render PDF via Browser Rendering
                const browser = await puppeteer.launch(env.BROWSER);
                const page = await browser.newPage();
                await page.setContent(html, { waitUntil: 'networkidle0' });

                const pdfBuffer = await page.pdf({
                    format: 'A4',
                    printBackground: true,
                    margin: { top: '10mm', right: '10mm', bottom: '10mm', left: '10mm' }
                });

                await browser.close();

                // 4. Upload to R2
                const key = `generated-worksheets/${wsData.studentId}/${worksheetId}.pdf`;
                await env.PDF_BUCKET.put(key, pdfBuffer, {
                    httpMetadata: { contentType: 'application/pdf' }
                });

                // 5. Construct public URL and notify backend
                const pdfUrl = `https://pub-c3c6a680b09a42b8aaa905a95ab0b07c.r2.dev/${key}`;

                await backend.markComplete(worksheetId, pdfUrl, batchId);
                message.ack();
            } catch (error) {
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                console.error(`PDF render failed for ${worksheetId}:`, errorMsg);

                if (worksheetId) {
                    try {
                        await backend.markFailed(worksheetId, errorMsg, batchId);
                    } catch (e) {
                        console.error('Failed to mark worksheet as failed:', e);
                    }
                }

                // Retry on transient errors
                if (errorMsg.includes('429') || errorMsg.includes('503') || errorMsg.includes('timeout')) {
                    message.retry();
                } else {
                    message.ack();
                }
            }
        }
    }
};
