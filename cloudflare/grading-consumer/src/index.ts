import { BackendClient, BackendHttpError } from './backendClient';
import { arrayBufferToBase64 } from './base64';
import { loadAnswerKey, loadCustomPrompt } from './assets';
import { geminiGenerateJson, GeminiHttpError } from './gemini';
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
  MAX_QUEUE_ATTEMPTS?: string;
  IMAGES_BUCKET: R2Bucket;
  ASSETS_BUCKET: R2Bucket;
}

type QueueMessageV1 = { v: 1; jobId: string; enqueuedAt: string };

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

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

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value || '', 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function isRetryableHttpStatus(status: number): boolean {
  // 401/403 are almost always config/secret mismatch. Retrying is better than permanently failing student jobs.
  if (status === 401 || status === 403) return true;
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof NonRetryableError) return false;

  if (error instanceof BackendHttpError) {
    return isRetryableHttpStatus(error.status);
  }

  if (error instanceof GeminiHttpError) {
    return isRetryableHttpStatus(error.status);
  }

  if (error instanceof Error) {
    const msg = error.message || '';
    if (msg.includes('Failed to parse Gemini JSON payload')) return true;
    if (msg.includes('Gemini response did not include text content')) return true;
    if (msg.includes('Gemini response was not valid JSON')) return true;
    if (msg.includes('fetch failed')) return true;
    if (msg.toLowerCase().includes('timeout')) return true;
  }

  return false;
}

async function loadImageParts(env: Env, job: JobPayload): Promise<Array<{ inline_data: { mime_type: string; data: string } }>> {
  const maxPages = Math.max(1, Number.parseInt(env.FAST_MAX_PAGES || '4', 10) || 4);
  if (job.images.length > maxPages) {
    throw new NonRetryableError(`Too many images for fast path: ${job.images.length} (max ${maxPages})`);
  }

  for (const img of job.images) {
    if (img.storageProvider !== 'R2') {
      throw new NonRetryableError(`Unsupported storageProvider for Cloudflare grader: ${img.storageProvider}`);
    }
  }

  const parts: Array<{ inline_data: { mime_type: string; data: string } }> = [];

  for (const image of job.images) {
    const obj = await env.IMAGES_BUCKET.get(image.s3Key);
    if (!obj) {
      throw new NonRetryableError(`Image not found in R2: ${image.s3Key}`);
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

async function processJob(env: Env, backend: BackendClient, jobId: string, onAcquired: () => void): Promise<'completed' | 'skipped'> {
  const acquire = await backend.acquire(jobId);
  if (!acquire.success) {
    throw new Error(acquire.error || 'Acquire failed');
  }
  if (!acquire.acquired || !acquire.job) {
    return 'skipped';
  }

  onAcquired();
  const job = acquire.job;

  if (!job.tokenNo || !job.worksheetName) {
    throw new NonRetryableError('Job is missing tokenNo or worksheetName');
  }

  if (!job.images || job.images.length === 0) {
    throw new NonRetryableError('Job has no images');
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
    return 'completed';
  } finally {
    if (heartbeatTimer !== null) {
      clearInterval(heartbeatTimer);
    }
  }
}

export default {
  async queue(batch: any, env: Env, ctx: ExecutionContext): Promise<void> {
    const backend = new BackendClient(env);
    const maxAttempts = Math.max(1, parsePositiveInt(env.MAX_QUEUE_ATTEMPTS, 5));

    for (const message of batch.messages || []) {
      let jobId: string | null = null;
      let acquired = false;
      try {
        const parsed = parseQueueMessage(message.body);
        jobId = parsed.jobId;
        await processJob(env, backend, parsed.jobId, () => {
          acquired = true;
        });
        message.ack();
      } catch (error) {
        const attempts = typeof message?.attempts === 'number' ? message.attempts : 1;
        console.error('Queue message processing failed', {
          messageId: message?.id,
          jobId,
          attempts,
          error: error instanceof Error ? error.message : String(error),
        });

        const reason = error instanceof Error ? error.message : String(error);
        const retryable = isRetryableError(error);

        if (jobId && acquired && retryable && attempts < maxAttempts) {
          // Release the PROCESSING lease so the next delivery can re-acquire immediately.
          await backend.requeue(jobId, reason).catch((requeueErr) => {
            console.error('Failed to requeue job after retryable error', {
              jobId,
              error: requeueErr instanceof Error ? requeueErr.message : String(requeueErr),
            });
          });
        }

        if (retryable && attempts < maxAttempts) {
          try {
            message.retry();
          } catch {
            // Fallback: let the batch fail so Cloudflare retries delivery.
            throw error;
          }
          continue;
        }

        if (jobId && acquired) {
          await backend.fail(jobId, reason).catch((failErr) => {
            console.error('Failed to mark job failed', {
              jobId,
              error: failErr instanceof Error ? failErr.message : String(failErr),
            });
          });
        }

        // Terminal: either non-retryable, or max attempts reached.
        try {
          message.ack();
        } catch {
          // Ignore.
        }
      }
    }
  },
};
