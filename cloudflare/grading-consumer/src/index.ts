import { BackendClient } from './backendClient';
import { arrayBufferToBase64 } from './base64';
import { loadAnswerKey, loadCustomPrompt } from './assets';
import { geminiGenerateJson } from './gemini';
import { buildAiGradingPrompt, buildBookGradingPrompt, buildOcrPrompt } from './prompts';
import { toBackendGradingResponse } from './gradingTransform';
import { assertExtractedQuestions, assertGradingResult } from './validate';
import type { ExtractedQuestions, GradingResult, JobPayload } from './types';

interface Env {
  BACKEND_BASE_URL: string;
  BACKEND_WORKER_TOKEN: string;
  GEMINI_API_KEY: string;
  GEMINI_OCR_MODEL?: string;
  GEMINI_AI_GRADING_MODEL?: string;
  GEMINI_BOOK_GRADING_MODEL?: string;
  HEARTBEAT_INTERVAL_MS?: string;
  FAST_MAX_PAGES?: string;
  IMAGES_BUCKET: R2Bucket;
  ASSETS_BUCKET: R2Bucket;
}

type QueueMessageV1 = { v: 1; jobId: string; enqueuedAt: string };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizePayload(payload: unknown): unknown {
  if (typeof payload !== 'string') return payload;

  try {
    return JSON.parse(payload);
  } catch {
    // Try base64 encoded JSON.
  }

  try {
    const decoded = atob(payload);
    return JSON.parse(decoded);
  } catch {
    return payload;
  }
}

function parseQueueMessage(payload: unknown): QueueMessageV1 {
  const normalized = normalizePayload(payload);
  if (!isObject(normalized)) {
    throw new Error('Queue body must be an object');
  }

  const v = normalized.v;
  const jobId = normalized.jobId;
  const enqueuedAt = normalized.enqueuedAt;

  if (v !== 1) throw new Error(`Unsupported message version: ${String(v)}`);
  if (typeof jobId !== 'string' || jobId.trim().length === 0) throw new Error('jobId is required');
  if (typeof enqueuedAt !== 'string') throw new Error('enqueuedAt is required');

  return { v: 1, jobId, enqueuedAt };
}

async function loadImageParts(env: Env, job: JobPayload): Promise<Array<{ inline_data: { mime_type: string; data: string } }>> {
  const maxPages = Math.max(1, Number.parseInt(env.FAST_MAX_PAGES || '4', 10) || 4);
  if (job.images.length > maxPages) {
    throw new Error(`Too many images for fast path: ${job.images.length} (max ${maxPages})`);
  }

  for (const img of job.images) {
    if (img.storageProvider !== 'R2') {
      throw new Error(`Unsupported storageProvider for Cloudflare grader: ${img.storageProvider}`);
    }
  }

  const parts: Array<{ inline_data: { mime_type: string; data: string } }> = [];

  for (const image of job.images) {
    const obj = await env.IMAGES_BUCKET.get(image.s3Key);
    if (!obj) {
      throw new Error(`Image not found in R2: ${image.s3Key}`);
    }

    const bytes = await obj.arrayBuffer();
    const base64 = arrayBufferToBase64(bytes);

    parts.push({
      inline_data: {
        mime_type: image.mimeType || 'application/octet-stream',
        data: base64,
      },
    });
  }

  return parts;
}

async function processJob(env: Env, backend: BackendClient, jobId: string): Promise<void> {
  const acquire = await backend.acquire(jobId);
  if (!acquire.success) {
    throw new Error(acquire.error || 'Acquire failed');
  }
  if (!acquire.acquired || !acquire.job) {
    return;
  }

  const job = acquire.job;

  if (!job.tokenNo || !job.worksheetName) {
    await backend.fail(jobId, 'Job is missing tokenNo or worksheetName');
    return;
  }

  if (!job.images || job.images.length === 0) {
    await backend.fail(jobId, 'Job has no images');
    return;
  }

  const heartbeatMs = Math.max(10_000, Number.parseInt(env.HEARTBEAT_INTERVAL_MS || '60000', 10) || 60000);
  let heartbeatTimer: number | null = null;

  try {
    heartbeatTimer = setInterval(() => {
      void backend.heartbeat(jobId).catch(() => {
        // best effort; backend stale-job watchdog handles recovery
      });
    }, heartbeatMs) as unknown as number;

    // Ensure we start with a heartbeat so stale watchdog doesn't race.
    await backend.heartbeat(jobId).catch(() => {});

    const imageParts = await loadImageParts(env, job);
    const customPrompt = await loadCustomPrompt(env.ASSETS_BUCKET, job.worksheetNumber);
    const ocrPrompt = buildOcrPrompt(customPrompt);

    const extracted = await geminiGenerateJson<ExtractedQuestions>({
      apiKey: env.GEMINI_API_KEY,
      model: env.GEMINI_OCR_MODEL || 'gemini-2.0-flash',
      responseMimeType: 'application/json',
      temperature: 0.1,
      parts: [{ text: ocrPrompt }, ...imageParts],
    });

    const extractedQuestions = assertExtractedQuestions(extracted.parsed);

    const answerKey = await loadAnswerKey(env.ASSETS_BUCKET);
    const answers = answerKey[String(job.worksheetNumber)];

    const gradingPrompt = Array.isArray(answers) && answers.length > 0
      ? buildBookGradingPrompt(extractedQuestions, answers)
      : buildAiGradingPrompt(extractedQuestions);

    const grading = await geminiGenerateJson<GradingResult>({
      apiKey: env.GEMINI_API_KEY,
      model: Array.isArray(answers) && answers.length > 0
        ? (env.GEMINI_BOOK_GRADING_MODEL || 'gemini-2.0-flash')
        : (env.GEMINI_AI_GRADING_MODEL || 'gemini-3-flash-preview'),
      responseMimeType: 'application/json',
      temperature: 0.1,
      parts: [{ text: gradingPrompt }],
    });

    const gradingResult = assertGradingResult(grading.parsed);
    const backendResponse = toBackendGradingResponse(gradingResult);

    await backend.complete(jobId, backendResponse);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown grading error';
    await backend.fail(jobId, message).catch(() => {
      // best effort; dispatch loop will requeue stale PROCESSING if needed
    });
  } finally {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
    }
  }
}

export default {
  async queue(batch: any, env: Env, ctx: ExecutionContext): Promise<void> {
    const backend = new BackendClient(env);

    for (const message of batch.messages || []) {
      let jobId: string | null = null;
      try {
        const parsed = parseQueueMessage(message.body);
        jobId = parsed.jobId;
        await processJob(env, backend, parsed.jobId);
      } catch (error) {
        console.error('Queue message processing failed', {
          messageId: message?.id,
          jobId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        try {
          message.ack();
        } catch {
          // Ignore.
        }
      }
    }
  },
};
