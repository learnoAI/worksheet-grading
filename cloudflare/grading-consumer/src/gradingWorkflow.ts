import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep, type WorkflowStepConfig } from 'cloudflare:workers';
import { NonRetryableError } from 'cloudflare:workflows';

import { BackendClient } from './backendClient';
import { arrayBufferToBase64 } from './base64';
import { loadAnswerKey, loadCustomPrompt } from './assets';
import { llmGenerateJson, type LlmReasoningEffort } from './llm';
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
import type { GradingApiResponse, JobImagePayload, JobPayload } from './types';

/**
 * Three-tier grading workflow.
 *
 * Replaces the at-least-once Cloudflare Queues consumer (`processJob` in
 * `index.ts`) with a durable execution graph. The dispatch site
 * (`backend/src/worker/routes/worksheetProcessing.ts`) calls
 * `env.GRADING_WORKFLOW.create({ id: jobId, params })` instead of
 * `publishToQueue(...)`. Workflow steps are checkpointed, so a tier that
 * succeeds is never re-run; a tier that fails after its in-step retries
 * triggers the next tier in the chain.
 *
 * Per-LLM-call fallback chain (applied independently to OCR and grading):
 *   tier 1 — workers-ai @cf/google/gemma-4-26b-a4b-it, reasoning_effort:high
 *            1 retry, 4 min step timeout (caps thinking-mode hangs)
 *   tier 2 — workers-ai @cf/google/gemma-4-26b-a4b-it, reasoning_effort:low
 *            2 retries, 90 sec step timeout
 *   tier 3 — openrouter google/gemma-4-26b-a4b-it, no reasoning
 *            2 retries, 2 min step timeout
 *
 * Backend interaction reuses the existing lease-based routes so
 * `internalGradingWorker.ts` stays untouched: `acquire` is the workflow's
 * first step (returns leaseId + job payload), and the final
 * `persist-success`/`persist-failure` step calls `complete` or `fail`.
 * Heartbeats are intentionally not sent — the cron-driven stale-lease
 * sweep is being removed in the same migration, so the lease only needs
 * to outlive the workflow itself.
 */

interface Env {
  BACKEND_BASE_URL: string;
  BACKEND_WORKER_TOKEN: string;
  CF_AI_GATEWAY_ACCOUNT_ID?: string;
  CF_AI_GATEWAY_ID?: string;
  CF_AI_GATEWAY_TOKEN?: string;
  GEMINI_API_KEY?: string;
  OPENROUTER_API_KEY?: string;
  IMAGES_BUCKET: R2Bucket;
  ASSETS_BUCKET: R2Bucket;
  FAST_MAX_PAGES?: string;
  POSTHOG_API_KEY?: string;
  POSTHOG_HOST?: string;
}

type PosthogTracker = ReturnType<typeof createPosthogClient>;

export interface GradingWorkflowParams {
  jobId: string;
}

interface TierConfig {
  name: string;
  provider: 'workers-ai' | 'openrouter';
  model: string;
  reasoningEffort?: LlmReasoningEffort;
  step: WorkflowStepConfig;
}

const OCR_TIERS: TierConfig[] = [
  {
    name: 'cf-gemma-thinking',
    provider: 'workers-ai',
    model: '@cf/google/gemma-4-26b-a4b-it',
    reasoningEffort: 'high',
    step: { retries: { limit: 1, delay: '5 seconds', backoff: 'constant' }, timeout: '4 minutes' },
  },
  {
    name: 'cf-gemma-no-thinking',
    provider: 'workers-ai',
    model: '@cf/google/gemma-4-26b-a4b-it',
    reasoningEffort: 'low',
    step: { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '90 seconds' },
  },
  {
    name: 'openrouter',
    provider: 'openrouter',
    model: 'google/gemma-4-26b-a4b-it',
    step: { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '2 minutes' },
  },
];

// Mirrors OCR_TIERS — kept as a separate const so future per-stage tuning
// (e.g. raising grading timeout because the prompt is longer) doesn't have
// to fork the OCR config.
const GRADING_TIERS: TierConfig[] = [
  {
    name: 'cf-gemma-thinking',
    provider: 'workers-ai',
    model: '@cf/google/gemma-4-26b-a4b-it',
    reasoningEffort: 'high',
    step: { retries: { limit: 1, delay: '5 seconds', backoff: 'constant' }, timeout: '4 minutes' },
  },
  {
    name: 'cf-gemma-no-thinking',
    provider: 'workers-ai',
    model: '@cf/google/gemma-4-26b-a4b-it',
    reasoningEffort: 'low',
    step: { retries: { limit: 2, delay: '5 seconds', backoff: 'exponential' }, timeout: '90 seconds' },
  },
  {
    name: 'openrouter',
    provider: 'openrouter',
    model: 'google/gemma-4-26b-a4b-it',
    step: { retries: { limit: 2, delay: '10 seconds', backoff: 'exponential' }, timeout: '2 minutes' },
  },
];

const ACQUIRE_STEP: WorkflowStepConfig = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
  timeout: '30 seconds',
};

const LOAD_IMAGES_STEP: WorkflowStepConfig = {
  retries: { limit: 3, delay: '5 seconds', backoff: 'exponential' },
  timeout: '60 seconds',
};

const PERSIST_STEP: WorkflowStepConfig = {
  retries: { limit: 10, delay: '10 seconds', backoff: 'exponential' },
  timeout: '30 seconds',
};

const ERROR_STACK_MAX_BYTES = 2000;
const ERROR_RESPONSE_TEXT_MAX_BYTES = 200;

function tierApiKey(env: Env, provider: TierConfig['provider']): string | undefined {
  if (provider === 'workers-ai') return env.CF_AI_GATEWAY_TOKEN;
  if (provider === 'openrouter') return env.OPENROUTER_API_KEY;
  return undefined;
}

function serializeError(error: unknown): {
  errorMessage: string;
  errorName?: string;
  errorStack?: string;
  errorContext?: Record<string, unknown>;
} {
  if (!(error instanceof Error)) {
    return { errorMessage: typeof error === 'string' ? error : 'Unknown error' };
  }
  const out: { errorMessage: string; errorName?: string; errorStack?: string; errorContext?: Record<string, unknown> } = {
    errorMessage: error.message,
    errorName: error.name,
  };
  if (error.stack) {
    out.errorStack =
      error.stack.length > ERROR_STACK_MAX_BYTES ? error.stack.slice(0, ERROR_STACK_MAX_BYTES) : error.stack;
  }
  const ctx: Record<string, unknown> = {};
  const errAsRecord = error as unknown as Record<string, unknown>;
  for (const key of ['status', 'provider', 'model'] as const) {
    if (errAsRecord[key] !== undefined) ctx[key] = errAsRecord[key];
  }
  const responseText = errAsRecord.responseText;
  if (typeof responseText === 'string' && responseText.length > 0) {
    ctx.responseText =
      responseText.length > ERROR_RESPONSE_TEXT_MAX_BYTES
        ? responseText.slice(0, ERROR_RESPONSE_TEXT_MAX_BYTES)
        : responseText;
  }
  if (Object.keys(ctx).length > 0) out.errorContext = ctx;
  return out;
}

/**
 * Run a list of tier configs sequentially as separate workflow steps,
 * returning the first success. Each step is checkpointed independently,
 * so a successful tier on workflow restart replays from cache and a
 * failed tier doesn't re-execute (control flow proceeds to the next one).
 *
 * Note on `NonRetryableError` semantics: the CF Workflows runtime treats
 * `NonRetryableError` as "skip the rest of THIS step's retries and fail
 * fast." We catch and proceed to the next tier here, so a tier-internal
 * NonRetryableError (e.g. a 401 from one provider) still falls through
 * to the next tier instead of aborting the workflow. The
 * "non-retryable" name applies within a single tier; cross-tier
 * fallthrough is unaffected.
 */
async function runTieredStep<T>(
  step: WorkflowStep,
  tracker: PosthogTracker,
  jobId: string,
  stageName: string,
  tiers: TierConfig[],
  call: (tier: TierConfig) => Promise<T>,
): Promise<T> {
  let lastError: unknown = null;
  for (const tier of tiers) {
    tracker.capturePipeline('workflow_tier_attempted', jobId, {
      jobId,
      stage: stageName,
      tier: tier.name,
      provider: tier.provider,
      model: tier.model,
      reasoningEffort: tier.reasoningEffort ?? null,
    });
    try {
      // step.do constrains its callback return to `Serializable<T>` (a
      // structural-clone-shaped derivative of T). Our T is JSON-shaped
      // (plain object trees, no Dates/Maps), so the runtime is fine —
      // but the compiler can't prove that for a generic parameter.
      // `as never` on the callback erases the constraint check; the
      // outer `as T` re-narrows.
      const result = await step.do(
        `${stageName}-${tier.name}`,
        tier.step,
        (async () => call(tier)) as never,
      );
      tracker.capturePipeline('workflow_tier_succeeded', jobId, {
        jobId,
        stage: stageName,
        tier: tier.name,
        provider: tier.provider,
        model: tier.model,
      });
      return result as T;
    } catch (error) {
      lastError = error;
      tracker.capturePipeline('workflow_tier_failed', jobId, {
        jobId,
        stage: stageName,
        tier: tier.name,
        provider: tier.provider,
        model: tier.model,
        error: error instanceof Error ? error.message : String(error),
        errorName: error instanceof Error ? error.name : undefined,
      });
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new Error(`All ${stageName} tiers failed`);
}

export class GradingWorkflow extends WorkflowEntrypoint<Env, GradingWorkflowParams> {
  async run(event: WorkflowEvent<GradingWorkflowParams>, step: WorkflowStep): Promise<void> {
    const { jobId } = event.payload;
    const backend = new BackendClient(this.env);
    const tracker = createPosthogClient(this.env, this.ctx);

    tracker.capturePipeline('workflow_started', jobId, { jobId });

    // 1. Acquire — QUEUED → PROCESSING with leaseId. Mirrors what the
    //    queue consumer's `processJob` does, but inside a checkpointed
    //    step so a workflow restart never double-acquires.
    const acquired = await step.do('acquire', ACQUIRE_STEP, async () => {
      const result = await backend.acquire(jobId);
      if (!result.success) {
        throw new Error(result.error || 'Acquire failed');
      }
      if (!result.acquired || !result.leaseId || !result.job) {
        throw new NonRetryableError('Job not in QUEUED state — already acquired or terminal');
      }
      if (!result.job.tokenNo || !result.job.worksheetName) {
        throw new NonRetryableError('Job is missing tokenNo or worksheetName');
      }
      if (!result.job.images || result.job.images.length === 0) {
        throw new NonRetryableError('Job has no images');
      }
      return { leaseId: result.leaseId, job: result.job };
    });
    const { leaseId, job } = acquired;

    try {
      const gradingResponse = await this.runGrading(step, tracker, job);
      await step.do('persist-success', PERSIST_STEP, async () => {
        await backend.complete(jobId, leaseId, gradingResponse);
      });
      tracker.capturePipeline('workflow_completed', jobId, { jobId, outcome: 'success' });
    } catch (gradingError) {
      const serialized = serializeError(gradingError);
      await step.do('persist-failure', PERSIST_STEP, async () => {
        await backend.fail(jobId, leaseId, serialized.errorMessage, {
          errorName: serialized.errorName,
          errorStack: serialized.errorStack,
          errorContext: serialized.errorContext,
        });
      });
      tracker.capturePipeline('workflow_completed', jobId, {
        jobId,
        outcome: 'failure',
        errorName: serialized.errorName,
        errorMessage: serialized.errorMessage,
      });
      // Re-throw as NonRetryableError so the workflow ends in `errored`
      // state — the dashboard surfaces the failure and we don't burn
      // retries on what is, by definition, a fully-exhausted chain.
      throw new NonRetryableError(`Grading failed after all tiers: ${serialized.errorMessage}`);
    }
  }

  /**
   * OCR (extract questions + student answers) → grade. Each LLM call has
   * its own three-tier fallback chain.
   *
   * Image bytes are loaded once from R2 and held in memory for the
   * lifetime of `run()`. They are NOT returned from a step (would exceed
   * the 1 MiB step-output cap on multi-page worksheets) and are not
   * checkpointed. On workflow restart, image bytes are re-loaded — cheap
   * (~5 ms per R2 GET) and avoids fighting the size limit.
   */
  private async runGrading(
    step: WorkflowStep,
    tracker: PosthogTracker,
    job: JobPayload,
  ): Promise<GradingApiResponse> {
    const imageMeta = await step.do('load-image-meta', LOAD_IMAGES_STEP, async () => {
      return validateImageMeta(this.env, job.images);
    });
    const imageParts = await loadImageBytes(this.env, imageMeta);

    const customPrompt = await loadCustomPrompt(this.env.ASSETS_BUCKET, job.worksheetNumber);
    const ocrPrompt = buildOcrPrompt(customPrompt);

    const extractedQuestions = await runTieredStep<ExtractedQuestions>(
      step,
      tracker,
      job.id,
      'ocr',
      OCR_TIERS,
      async (tier) => {
        const result = await llmGenerateJson<unknown>({
          gatewayAccountId: this.env.CF_AI_GATEWAY_ACCOUNT_ID,
          gatewayId: this.env.CF_AI_GATEWAY_ID,
          gatewayToken: this.env.CF_AI_GATEWAY_TOKEN,
          providerConfig: {
            provider: tier.provider,
            model: tier.model,
            apiKey: tierApiKey(this.env, tier.provider),
          },
          // Workers-ai is routed via the gateway's managed integration,
          // so the gateway header alone is sufficient. Sending a
          // duplicate Authorization with the same token makes some
          // gateways 401 (e.g. saarthi_test, 2026-05-07).
          skipProviderAuth: tier.provider === 'workers-ai',
          reasoningEffort: tier.reasoningEffort,
          responseMimeType: 'application/json',
          responseJsonSchema: ExtractedQuestionsJsonSchema,
          temperature: 0.1,
          parts: [{ text: ocrPrompt }, ...imageParts],
        });
        // Same defensive coercion as the queue consumer (`index.ts:853`):
        // some Gemma deployments return the bare questions array at the
        // root despite the JSON schema constraint.
        const raw = Array.isArray(result.parsed) ? { questions: result.parsed } : result.parsed;
        return ExtractedQuestionsSchema.parse(raw);
      },
    );

    const answerKey = await loadAnswerKey(this.env.ASSETS_BUCKET);
    const answers = answerKey[String(job.worksheetNumber)];
    const gradingPrompt =
      Array.isArray(answers) && answers.length > 0
        ? buildBookGradingPrompt(extractedQuestions, answers)
        : buildAiGradingPrompt(extractedQuestions);

    const gradingResult = await runTieredStep<GradingResult>(
      step,
      tracker,
      job.id,
      'grading',
      GRADING_TIERS,
      async (tier) => {
        const result = await llmGenerateJson<unknown>({
          gatewayAccountId: this.env.CF_AI_GATEWAY_ACCOUNT_ID,
          gatewayId: this.env.CF_AI_GATEWAY_ID,
          gatewayToken: this.env.CF_AI_GATEWAY_TOKEN,
          providerConfig: {
            provider: tier.provider,
            model: tier.model,
            apiKey: tierApiKey(this.env, tier.provider),
          },
          skipProviderAuth: tier.provider === 'workers-ai',
          reasoningEffort: tier.reasoningEffort,
          responseMimeType: 'application/json',
          responseJsonSchema: GradingResultJsonSchema,
          temperature: 0.1,
          parts: [{ text: gradingPrompt }],
        });
        const raw = Array.isArray(result.parsed)
          ? { question_scores: result.parsed, overall_feedback: '' }
          : result.parsed;
        return GradingResultSchema.parse(raw);
      },
    );

    return toBackendGradingResponse(gradingResult, {
      expectedTotalQuestions: extractedQuestions.questions.length,
    });
  }
}

function validateImageMeta(env: Env, images: JobImagePayload[]): JobImagePayload[] {
  const maxPages = Math.max(1, Number.parseInt(env.FAST_MAX_PAGES || '4', 10) || 4);
  if (images.length > maxPages) {
    throw new NonRetryableError(`Too many images for fast path: ${images.length} (max ${maxPages})`);
  }
  for (const img of images) {
    if (img.storageProvider !== 'R2') {
      throw new NonRetryableError(`Unsupported storageProvider for Cloudflare grader: ${img.storageProvider}`);
    }
  }
  return images;
}

async function loadImageBytes(
  env: Env,
  images: JobImagePayload[],
): Promise<Array<{ inline_data: { mime_type: string; data: string } }>> {
  const parts: Array<{ inline_data: { mime_type: string; data: string } }> = [];
  for (const image of images) {
    const obj = await env.IMAGES_BUCKET.get(image.s3Key);
    if (!obj) {
      throw new NonRetryableError(`Image not found in R2: ${image.s3Key}`);
    }
    const bytes = await obj.arrayBuffer();
    parts.push({
      inline_data: {
        mime_type: image.mimeType || 'application/octet-stream',
        data: arrayBufferToBase64(bytes),
      },
    });
  }
  return parts;
}
