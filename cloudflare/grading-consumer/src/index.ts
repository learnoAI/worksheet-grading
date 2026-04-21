import { BackendClient, BackendHttpError } from './backendClient';
import { arrayBufferToBase64 } from './base64';
import { loadAnswerKey, loadCustomPrompt } from './assets';
import { llmGenerateJson, LlmHttpError } from './llm';
import { buildAiGradingPrompt, buildBookGradingPrompt, buildOcrPrompt } from './prompts';
import { toBackendGradingResponse } from './gradingTransform';
import { createPosthogClient } from './posthog';
import {
  ExtractedQuestionsJsonSchema,
  ExtractedQuestionsSchema,
  GradingResultJsonSchema,
  GradingResultSchema,
} from './schemas';
import type { ExtractedQuestions, GradingResult } from './schemas';
import type { JobPayload } from './types';
import type { LlmModelConfig, LlmReasoningEffort } from './llm';

interface Env {
  BACKEND_BASE_URL: string;
  BACKEND_WORKER_TOKEN: string;
  CF_AI_GATEWAY_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_ID?: string;
  CF_AI_GATEWAY_TOKEN?: string;
  OCR_PROVIDER?: string;
  OCR_MODEL?: string;
  OCR_API_KEY?: string;
  OCR_REASONING_EFFORT?: string;
  OCR_REQUEST_TIMEOUT_MS?: string;
  AI_GRADING_PROVIDER?: string;
  AI_GRADING_MODEL?: string;
  AI_GRADING_API_KEY?: string;
  AI_GRADING_REASONING_EFFORT?: string;
  AI_GRADING_REQUEST_TIMEOUT_MS?: string;
  BOOK_GRADING_PROVIDER?: string;
  BOOK_GRADING_MODEL?: string;
  BOOK_GRADING_API_KEY?: string;
  BOOK_GRADING_REASONING_EFFORT?: string;
  BOOK_GRADING_REQUEST_TIMEOUT_MS?: string;
  GEMINI_RATE_LIMITER?: DurableObjectNamespace;
  GEMINI_LIMITER_MIN_RPS?: string;
  GEMINI_LIMITER_INITIAL_RPS?: string;
  GEMINI_LIMITER_MAX_RPS?: string;
  GEMINI_LIMITER_BACKOFF_MULTIPLIER?: string;
  GEMINI_LIMITER_RAMP_UP_MULTIPLIER?: string;
  GEMINI_LIMITER_RAMP_UP_SUCCESS_COUNT?: string;
  GEMINI_429_RETRY_BASE_DELAY_SECONDS?: string;
  GEMINI_429_RETRY_MAX_DELAY_SECONDS?: string;
  HEARTBEAT_INTERVAL_MS?: string;
  FAST_MAX_PAGES?: string;
  MAX_QUEUE_ATTEMPTS?: string;
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
  IMAGES_BUCKET: R2Bucket;
  ASSETS_BUCKET: R2Bucket;
}

type PosthogTracker = ReturnType<typeof createPosthogClient>;

type QueueMessageV1 = { v: 1; jobId: string; enqueuedAt: string };

type LlmStage = 'ocr' | 'grading';

interface GeminiLimiterAcquireResponse {
  waitMs: number;
  targetRps: number;
  intervalMs: number;
  scheduledAt: number;
}

interface GeminiLimiterFeedback {
  ok: boolean;
  status?: number;
  stage: LlmStage;
  model: string;
  jobId: string;
}

interface GeminiLimiterState {
  targetRps: number;
  successCount: number;
  consecutive429s: number;
  nextAvailableAt: number;
}

class NonRetryableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableError';
  }
}

const DEFAULT_LLM_PROVIDER = 'workers-ai';
const DEFAULT_LLM_MODEL = '@cf/google/gemma-4-26b-a4b-it';
const DEFAULT_OCR_REASONING_EFFORT: LlmReasoningEffort = 'low';
const DEFAULT_GRADING_REASONING_EFFORT: LlmReasoningEffort = 'low';
const DEFAULT_OCR_REQUEST_TIMEOUT_MS = 500_000;
const DEFAULT_GRADING_REQUEST_TIMEOUT_MS = 500_000;

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

function parsePositiveFloat(value: string | undefined, fallback: number): number {
  const parsed = Number.parseFloat(value || '');
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return parsed;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sleep(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function formatLlmModelLabel(config: LlmModelConfig): string {
  return `${config.provider}/${config.model}`;
}

function normalizeReasoningEffort(value: string | undefined): LlmReasoningEffort | undefined {
  switch (value?.trim().toLowerCase()) {
    case 'low':
    case 'medium':
    case 'high':
      return value.trim().toLowerCase() as LlmReasoningEffort;
    default:
      return undefined;
  }
}

function getStageLlmConfig(env: Env, stage: 'ocr' | 'ai-grading' | 'book-grading'): LlmModelConfig {
  const provider = normalizeOptionalString(
    stage === 'ocr'
      ? env.OCR_PROVIDER
      : stage === 'ai-grading'
        ? env.AI_GRADING_PROVIDER
        : env.BOOK_GRADING_PROVIDER
  ) || DEFAULT_LLM_PROVIDER;

  const model = normalizeOptionalString(
    stage === 'ocr'
      ? env.OCR_MODEL
      : stage === 'ai-grading'
        ? env.AI_GRADING_MODEL
        : env.BOOK_GRADING_MODEL
  ) || DEFAULT_LLM_MODEL;

  const apiKey = normalizeOptionalString(
    stage === 'ocr'
      ? env.OCR_API_KEY
      : stage === 'ai-grading'
        ? env.AI_GRADING_API_KEY
        : env.BOOK_GRADING_API_KEY
  );

  return { provider, model, ...(apiKey ? { apiKey } : {}) };
}

function getStageReasoningEffort(env: Env, stage: 'ocr' | 'ai-grading' | 'book-grading'): LlmReasoningEffort | undefined {
  const configured = normalizeReasoningEffort(
    stage === 'ocr'
      ? env.OCR_REASONING_EFFORT
      : stage === 'ai-grading'
        ? env.AI_GRADING_REASONING_EFFORT
        : env.BOOK_GRADING_REASONING_EFFORT
  );

  if (configured) return configured;

  return stage === 'ocr' ? DEFAULT_OCR_REASONING_EFFORT : DEFAULT_GRADING_REASONING_EFFORT;
}

function getStageRequestTimeoutMs(env: Env, stage: 'ocr' | 'ai-grading' | 'book-grading'): number {
  const configured = parsePositiveInt(
    stage === 'ocr'
      ? env.OCR_REQUEST_TIMEOUT_MS
      : stage === 'ai-grading'
        ? env.AI_GRADING_REQUEST_TIMEOUT_MS
        : env.BOOK_GRADING_REQUEST_TIMEOUT_MS,
    stage === 'ocr' ? DEFAULT_OCR_REQUEST_TIMEOUT_MS : DEFAULT_GRADING_REQUEST_TIMEOUT_MS
  );

  return configured;
}

function getGeminiLimiterStub(env: Env): DurableObjectStub | null {
  if (!env.GEMINI_RATE_LIMITER) return null;
  const id = env.GEMINI_RATE_LIMITER.idFromName('global-gemini-limiter');
  return env.GEMINI_RATE_LIMITER.get(id);
}

async function acquireGeminiSlot(
  env: Env,
  tracker: PosthogTracker,
  request: { jobId: string; stage: LlmStage; model: string }
): Promise<void> {
  const stub = getGeminiLimiterStub(env);
  if (!stub) return;

  let response: Response;
  try {
    response = await stub.fetch('https://gemini-rate-limiter/acquire', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
  } catch (error) {
    tracker.capturePipeline('gemini_limiter_acquire_failed_open', request.jobId, {
      jobId: request.jobId,
      stage: request.stage,
      model: request.model,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  if (!response.ok) {
    tracker.capturePipeline('gemini_limiter_acquire_failed_open', request.jobId, {
      jobId: request.jobId,
      stage: request.stage,
      model: request.model,
      status: response.status,
    });
    return;
  }

  const slot = await response.json<GeminiLimiterAcquireResponse>().catch(() => null);
  const waitMs = Math.max(0, Math.ceil(Number(slot?.waitMs) || 0));
  if (waitMs > 0) {
    tracker.capturePipeline('gemini_limiter_wait_scheduled', request.jobId, {
      jobId: request.jobId,
      stage: request.stage,
      model: request.model,
      waitMs,
      targetRps: slot?.targetRps,
    });
    await sleep(waitMs);
  }
}

async function reportGeminiFeedback(env: Env, feedback: GeminiLimiterFeedback): Promise<void> {
  const stub = getGeminiLimiterStub(env);
  if (!stub) return;

  await stub.fetch('https://gemini-rate-limiter/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback),
  });
}

async function limitedLlmGenerateJson<T>(
  env: Env,
  tracker: PosthogTracker,
  request: { jobId: string; stage: LlmStage },
  options: Parameters<typeof llmGenerateJson<T>>[0]
): Promise<{ parsed: T; rawText: string }> {
  await acquireGeminiSlot(env, tracker, {
    jobId: request.jobId,
    stage: request.stage,
    model: formatLlmModelLabel(options.providerConfig),
  });

  try {
    const result = await llmGenerateJson<T>(options);
    await reportGeminiFeedback(env, {
      ok: true,
      jobId: request.jobId,
      stage: request.stage,
      model: formatLlmModelLabel(options.providerConfig),
    }).catch(() => {
      // The limiter is best effort; failed feedback should not fail grading.
    });
    return result;
  } catch (error) {
    await reportGeminiFeedback(env, {
      ok: false,
      status: error instanceof LlmHttpError ? error.status : undefined,
      jobId: request.jobId,
      stage: request.stage,
      model: formatLlmModelLabel(options.providerConfig),
    }).catch(() => {
      // The original Gemini error is the important one.
    });
    throw error;
  }
}

function isRetryableHttpStatus(status: number): boolean {
  // 401/403 are almost always config/secret mismatch. Retrying is better than permanently failing student jobs.
  if (status === 401 || status === 403) return true;
  return status === 408 || status === 429 || status >= 500;
}

function isRetryableError(error: unknown): boolean {
  if (error instanceof NonRetryableError) return false;

  if (error instanceof Error && error.name === 'ZodError') {
    return true;
  }

  if (error instanceof BackendHttpError) {
    return isRetryableHttpStatus(error.status);
  }

  if (error instanceof LlmHttpError) {
    return isRetryableHttpStatus(error.status);
  }

  if (error instanceof Error) {
    const msg = error.message || '';
    if (msg.includes('Failed to parse Gemini JSON payload')) return true;
    if (msg.includes('Failed to parse LLM JSON payload')) return true;
    if (msg.includes('Gemini response did not include text content')) return true;
    if (msg.includes('LLM response did not include text content')) return true;
    if (msg.includes('Gemini response was not valid JSON')) return true;
    if (msg.includes('LLM response was not valid JSON')) return true;
    if (msg.includes('fetch failed')) return true;
    if (msg.toLowerCase().includes('timeout')) return true;
  }

  return false;
}

function parseRetryDelayFromLlmError(error: LlmHttpError): number | null {
  try {
    const parsed = JSON.parse(error.responseText) as any;
    const details = Array.isArray(parsed?.error?.details) ? parsed.error.details : [];
    for (const detail of details) {
      const retryDelay = detail?.retryDelay;
      if (typeof retryDelay === 'string') {
        const match = retryDelay.match(/^(\d+(?:\.\d+)?)s$/);
        if (match) {
          return Math.ceil(Number.parseFloat(match[1]));
        }
      }
    }
  } catch {
    // Fall back to local exponential backoff.
  }

  return null;
}

function getRetryDelaySeconds(error: unknown, attempts: number, env: Env): number | undefined {
  if (!(error instanceof LlmHttpError) || error.status !== 429) {
    return undefined;
  }

  const providerDelay = parseRetryDelayFromLlmError(error);
  if (providerDelay !== null) {
    return clamp(providerDelay, 1, parsePositiveInt(env.GEMINI_429_RETRY_MAX_DELAY_SECONDS, 900));
  }

  const baseDelay = parsePositiveInt(env.GEMINI_429_RETRY_BASE_DELAY_SECONDS, 30);
  const maxDelay = parsePositiveInt(env.GEMINI_429_RETRY_MAX_DELAY_SECONDS, 900);
  const exponent = Math.max(0, attempts - 1);
  const rawDelay = baseDelay * Math.pow(2, exponent);
  const jitterMultiplier = 0.8 + Math.random() * 0.4;
  return Math.ceil(clamp(rawDelay * jitterMultiplier, 1, maxDelay));
}

async function loadImageParts(
  env: Env,
  job: JobPayload
): Promise<{ parts: Array<{ inline_data: { mime_type: string; data: string } }>; totalBytes: number }> {
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
  let totalBytes = 0;

  for (const image of job.images) {
    const obj = await env.IMAGES_BUCKET.get(image.s3Key);
    if (!obj) {
      throw new NonRetryableError(`Image not found in R2: ${image.s3Key}`);
    }

    const bytes = await obj.arrayBuffer();
    totalBytes += bytes.byteLength;
    const base64 = arrayBufferToBase64(bytes);

    parts.push({
      inline_data: {
        mime_type: image.mimeType || 'application/octet-stream',
        data: base64,
      },
    });
  }

  return { parts, totalBytes };
}

async function processJob(
  env: Env,
  backend: BackendClient,
  jobId: string,
  tracker: PosthogTracker,
  onAcquired: (leaseId: string) => void
): Promise<'completed' | 'skipped'> {
  tracker.capturePipeline('worker_acquire_requested', jobId, { jobId });
  const acquire = await backend.acquire(jobId);
  if (!acquire.success) {
    throw new Error(acquire.error || 'Acquire failed');
  }
  if (!acquire.acquired || !acquire.job) {
    tracker.capturePipeline('worker_acquire_skipped', jobId, { jobId });
    return 'skipped';
  }

  const leaseId = acquire.leaseId;
  if (typeof leaseId !== 'string' || leaseId.trim().length === 0) {
    throw new Error('Backend acquire did not return leaseId');
  }

  onAcquired(leaseId);
  const job = acquire.job;
  tracker.capturePipeline('worker_acquire_succeeded', jobId, {
    jobId,
    leaseId,
    imagesCount: job.images.length,
    worksheetNumber: job.worksheetNumber,
  });

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
      void backend.heartbeat(jobId, leaseId, 'interval').catch((error) => {
        // best effort; backend stale-job watchdog handles recovery
        tracker.capturePipeline('worker_heartbeat_interval_failed', jobId, {
          jobId,
          leaseId,
          error: error instanceof Error ? error.message : String(error),
        });
      });
    }, heartbeatMs) as unknown as number;

    // Ensure we start with a heartbeat so stale watchdog doesn't race.
    try {
      await backend.heartbeat(jobId, leaseId, 'initial');
      tracker.capturePipeline('worker_heartbeat_initial_succeeded', jobId, {
        jobId,
        leaseId,
      });
    } catch (error) {
      tracker.capturePipeline('worker_heartbeat_initial_failed', jobId, {
        jobId,
        leaseId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    const { parts: imageParts, totalBytes } = await loadImageParts(env, job);
    tracker.capturePipeline('worker_images_loaded', jobId, {
      jobId,
      leaseId,
      imagesCount: job.images.length,
      totalBytes,
    });
    const customPrompt = await loadCustomPrompt(env.ASSETS_BUCKET, job.worksheetNumber);
    const ocrPrompt = buildOcrPrompt(customPrompt);
    const ocrConfig = getStageLlmConfig(env, 'ocr');
    const ocrModelLabel = formatLlmModelLabel(ocrConfig);

    tracker.capturePipeline('worker_ocr_started', jobId, {
      jobId,
      leaseId,
      model: ocrModelLabel,
    });
    const extracted = await limitedLlmGenerateJson<ExtractedQuestions>(env, tracker, {
      jobId,
      stage: 'ocr',
    }, {
      gatewayAccountId: env.CF_AI_GATEWAY_ACCOUNT_ID,
      gatewayId: env.CF_AI_GATEWAY_ID,
      gatewayToken: env.CF_AI_GATEWAY_TOKEN,
      providerConfig: ocrConfig,
      reasoningEffort: getStageReasoningEffort(env, 'ocr'),
      requestTimeoutMs: getStageRequestTimeoutMs(env, 'ocr'),
      responseMimeType: 'application/json',
      responseJsonSchema: ExtractedQuestionsJsonSchema,
      temperature: 0.1,
      parts: [{ text: ocrPrompt }, ...imageParts],
    });

    const extractedQuestions = ExtractedQuestionsSchema.parse(extracted.parsed);
    tracker.capturePipeline('worker_ocr_succeeded', jobId, {
      jobId,
      leaseId,
      extractedQuestionsCount: extractedQuestions.questions.length,
    });

    const answerKey = await loadAnswerKey(env.ASSETS_BUCKET);
    const answers = answerKey[String(job.worksheetNumber)];

    const gradingPrompt = Array.isArray(answers) && answers.length > 0
      ? buildBookGradingPrompt(extractedQuestions, answers)
      : buildAiGradingPrompt(extractedQuestions);

    const gradingConfig = Array.isArray(answers) && answers.length > 0
      ? getStageLlmConfig(env, 'book-grading')
      : getStageLlmConfig(env, 'ai-grading');
    const gradingModelLabel = formatLlmModelLabel(gradingConfig);
    tracker.capturePipeline('worker_grading_started', jobId, {
      jobId,
      leaseId,
      model: gradingModelLabel,
      answerKeyMode: Array.isArray(answers) && answers.length > 0 ? 'book' : 'ai',
    });
    const grading = await limitedLlmGenerateJson<GradingResult>(env, tracker, {
      jobId,
      stage: 'grading',
    }, {
      gatewayAccountId: env.CF_AI_GATEWAY_ACCOUNT_ID,
      gatewayId: env.CF_AI_GATEWAY_ID,
      gatewayToken: env.CF_AI_GATEWAY_TOKEN,
      providerConfig: gradingConfig,
      reasoningEffort: getStageReasoningEffort(env, Array.isArray(answers) && answers.length > 0 ? 'book-grading' : 'ai-grading'),
      requestTimeoutMs: getStageRequestTimeoutMs(env, Array.isArray(answers) && answers.length > 0 ? 'book-grading' : 'ai-grading'),
      responseMimeType: 'application/json',
      responseJsonSchema: GradingResultJsonSchema,
      temperature: 0.1,
      parts: [{ text: gradingPrompt }],
    });

    const gradingResult = GradingResultSchema.parse(grading.parsed);
    const backendResponse = toBackendGradingResponse(gradingResult, {
      expectedTotalQuestions: extractedQuestions.questions.length,
    });
    tracker.capturePipeline('worker_grading_succeeded', jobId, {
      jobId,
      leaseId,
      grade: backendResponse.grade,
      totalQuestions: backendResponse.total_questions,
      gradePercentage: backendResponse.grade_percentage,
      aiReportedGrade: gradingResult.overall_score ?? null,
      aiReportedTotalQuestions: gradingResult.total_questions ?? null,
      aiReportedGradePercentage: gradingResult.grade_percentage ?? null,
    });

    await backend.complete(jobId, leaseId, backendResponse);
    tracker.capturePipeline('worker_complete_succeeded', jobId, {
      jobId,
      leaseId,
    });
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
    const tracker = createPosthogClient(env, ctx);
    const maxAttempts = Math.max(1, parsePositiveInt(env.MAX_QUEUE_ATTEMPTS, 5));

    const messages = (batch.messages || []) as any[];
    const messageTasks = messages.map(async (message) => {
      let jobId: string | null = null;
      let acquired = false;
      let leaseId: string | null = null;
      tracker.capturePipeline('queue_message_received', String(message?.id || 'unknown'), {
        messageId: message?.id,
        attempts: typeof message?.attempts === 'number' ? message.attempts : null,
      });
      try {
        const parsed = parseQueueMessage(message.body);
        jobId = parsed.jobId;
        await processJob(env, backend, parsed.jobId, tracker, (acquiredLeaseId) => {
          acquired = true;
          leaseId = acquiredLeaseId;
        });
        message.ack();
        tracker.capturePipeline('queue_message_acked_success', parsed.jobId, {
          jobId: parsed.jobId,
          messageId: message?.id,
        });
      } catch (error) {
        const attempts = typeof message?.attempts === 'number' ? message.attempts : 1;
        console.error('Queue message processing failed', {
          messageId: message?.id,
          jobId,
          attempts,
          error: error instanceof Error ? error.message : String(error),
        });

        tracker.capturePipeline('queue_message_failed', String(jobId || message?.id || 'unknown'), {
          jobId,
          messageId: message?.id,
          attempts,
          error: error instanceof Error ? error.message : String(error),
          retryable: isRetryableError(error),
        });

        if (error instanceof BackendHttpError && error.status === 409) {
          // Another worker owns the lease now. ACK to drop this delivery without mutating job state.
          try {
            message.ack();
          } catch {
            // Ignore.
          }
          tracker.capturePipeline('queue_message_acked_lease_mismatch', String(jobId || message?.id || 'unknown'), {
            jobId,
            messageId: message?.id,
          });
          return;
        }

        const reason = error instanceof Error ? error.message : String(error);
        const retryable = isRetryableError(error);

        if (jobId && acquired && leaseId && retryable && attempts < maxAttempts) {
          const currentJobId = jobId;
          const currentLeaseId = leaseId;
          // Release the PROCESSING lease so the next delivery can re-acquire immediately.
          let requeueSucceeded = true;
          await backend.requeue(currentJobId, currentLeaseId, reason).catch((requeueErr) => {
            requeueSucceeded = false;
            console.error('Failed to requeue job after retryable error', {
              jobId: currentJobId,
              error: requeueErr instanceof Error ? requeueErr.message : String(requeueErr),
            });
            tracker.capturePipeline('queue_message_requeue_failed', currentJobId, {
              jobId: currentJobId,
              leaseId: currentLeaseId,
              messageId: message?.id,
              attempts,
              reason,
              error: requeueErr instanceof Error ? requeueErr.message : String(requeueErr),
            });
          });
          if (requeueSucceeded) {
            tracker.capturePipeline('queue_message_requeued_for_retry', currentJobId, {
              jobId: currentJobId,
              leaseId: currentLeaseId,
              messageId: message?.id,
              attempts,
              reason,
            });
          }
        }

        if (retryable && attempts < maxAttempts) {
          const delaySeconds = getRetryDelaySeconds(error, attempts, env);
          try {
            if (delaySeconds) {
              message.retry({ delaySeconds });
            } else {
              message.retry();
            }
          } catch {
            // Fallback: let the batch fail so Cloudflare retries delivery.
            throw error;
          }
          tracker.capturePipeline('queue_message_retry_scheduled', String(jobId || message?.id || 'unknown'), {
            jobId,
            messageId: message?.id,
            attempts,
            maxAttempts,
            delaySeconds: delaySeconds ?? null,
          });
          return;
        }

        if (jobId && !acquired && retryable) {
          await backend.resetDispatch(jobId, reason);
          tracker.capturePipeline('queue_message_reset_dispatch_for_retry', jobId, {
            jobId,
            messageId: message?.id,
            attempts,
            maxAttempts,
            reason,
          });
        }

        if (jobId && acquired && leaseId) {
          const currentJobId = jobId;
          const currentLeaseId = leaseId;
          let failedMarked = true;
          await backend.fail(currentJobId, currentLeaseId, reason).catch((failErr) => {
            failedMarked = false;
            console.error('Failed to mark job failed', {
              jobId: currentJobId,
              error: failErr instanceof Error ? failErr.message : String(failErr),
            });
            tracker.capturePipeline('queue_message_fail_marking_failed', currentJobId, {
              jobId: currentJobId,
              leaseId: currentLeaseId,
              messageId: message?.id,
              attempts,
              reason,
              error: failErr instanceof Error ? failErr.message : String(failErr),
            });
          });
          if (failedMarked) {
            tracker.capturePipeline('queue_message_marked_failed', currentJobId, {
              jobId: currentJobId,
              leaseId: currentLeaseId,
              messageId: message?.id,
              attempts,
              reason,
            });
          }
        }

        // Terminal: either non-retryable, or max attempts reached.
        try {
          message.ack();
        } catch {
          // Ignore.
        }
        tracker.capturePipeline('queue_message_acked_terminal', String(jobId || message?.id || 'unknown'), {
          jobId,
          messageId: message?.id,
          attempts,
          retryable,
          maxAttempts,
        });
      }
    });

    const settled = await Promise.allSettled(messageTasks);
    const rejected = settled.find((result) => result.status === 'rejected') as PromiseRejectedResult | undefined;
    if (rejected) {
      throw rejected.reason;
    }
  },
};

export class GeminiRateLimiter {
  private state: GeminiLimiterState;

  constructor(_state: DurableObjectState, private readonly env: Env) {
    const minRps = this.minRps();
    this.state = {
      targetRps: clamp(parsePositiveFloat(env.GEMINI_LIMITER_INITIAL_RPS, 30), minRps, this.maxRps()),
      successCount: 0,
      consecutive429s: 0,
      nextAvailableAt: 0,
    };
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405);
    }

    if (url.pathname === '/acquire') {
      return json(this.acquire());
    }

    if (url.pathname === '/feedback') {
      const feedback = await request.json<Partial<GeminiLimiterFeedback>>().catch(() => null);
      if (!feedback) return json({ error: 'Invalid JSON' }, 400);
      return json(this.feedback(feedback));
    }

    return json({ error: 'Not found' }, 404);
  }

  private acquire(): GeminiLimiterAcquireResponse {
    const now = Date.now();
    const intervalMs = Math.ceil(1000 / this.state.targetRps);
    const scheduledAt = Math.max(now, this.state.nextAvailableAt);
    this.state.nextAvailableAt = scheduledAt + intervalMs;

    return {
      waitMs: Math.max(0, scheduledAt - now),
      targetRps: this.state.targetRps,
      intervalMs,
      scheduledAt,
    };
  }

  private feedback(feedback: Partial<GeminiLimiterFeedback>): {
    targetRps: number;
    consecutive429s: number;
    successCount: number;
  } {
    if (feedback.ok) {
      this.state.consecutive429s = 0;
      this.state.successCount += 1;

      const rampEvery = parsePositiveInt(this.env.GEMINI_LIMITER_RAMP_UP_SUCCESS_COUNT, 25);
      if (this.state.successCount >= rampEvery) {
        this.state.successCount = 0;
        const rampMultiplier = parsePositiveFloat(this.env.GEMINI_LIMITER_RAMP_UP_MULTIPLIER, 1.08);
        this.state.targetRps = clamp(this.state.targetRps * rampMultiplier, this.minRps(), this.maxRps());
      }
    } else if (feedback.status === 429) {
      this.state.successCount = 0;
      this.state.consecutive429s += 1;
      const backoffMultiplier = clamp(parsePositiveFloat(this.env.GEMINI_LIMITER_BACKOFF_MULTIPLIER, 0.55), 0.1, 0.95);
      this.state.targetRps = clamp(this.state.targetRps * backoffMultiplier, this.minRps(), this.maxRps());

      const cooldownMs = Math.ceil(1000 / this.state.targetRps) * Math.min(this.state.consecutive429s, 10);
      this.state.nextAvailableAt = Math.max(this.state.nextAvailableAt, Date.now() + cooldownMs);
    }

    return {
      targetRps: this.state.targetRps,
      consecutive429s: this.state.consecutive429s,
      successCount: this.state.successCount,
    };
  }

  private minRps(): number {
    return parsePositiveFloat(this.env.GEMINI_LIMITER_MIN_RPS, 5);
  }

  private maxRps(): number {
    return Math.max(this.minRps(), parsePositiveFloat(this.env.GEMINI_LIMITER_MAX_RPS, 120));
  }
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
