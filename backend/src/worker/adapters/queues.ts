/**
 * Workers-native Cloudflare Queues HTTP client.
 *
 * The Express backend has a full-featured client
 * (`services/queue/cloudflareQueueClient.ts`) that covers publish/pull/ack
 * because it also runs the queue *consumer*. The Hono worker only needs the
 * **publisher** side — the consumer still runs as the existing CF worker.
 *
 * Two functions are exposed:
 *
 *   - `publishToQueue(env, queueIdEnvKey, message)` — send a single message
 *   - `publishBatch(env, queueIdEnvKey, messages)` — send up to 100 messages
 *                                                     in one API call
 *
 * Both rely on native `fetch`, zero deps.
 *
 * Expected env vars (taken from the existing backend config):
 *   - `CF_ACCOUNT_ID`     — which CF account owns the queue
 *   - `CF_API_TOKEN`      — bearer token with queues:write scope
 *   - `CF_API_BASE_URL`   — override (defaults to the public API hostname)
 *   - queue-id key var    — set by the caller (e.g. `CF_QUEUE_ID`,
 *                           `QUESTION_GENERATION_QUEUE_ID`)
 */

export interface QueuePublishEnv {
  CF_ACCOUNT_ID?: string;
  CF_API_TOKEN?: string;
  CF_API_BASE_URL?: string;
  [k: string]: unknown;
}

const DEFAULT_API_BASE_URL = 'https://api.cloudflare.com/client/v4';

export type QueueErrorCode =
  | 'CONFIG_MISSING'
  | 'API_REQUEST_FAILED'
  | 'API_REJECTED'
  | 'INVALID_RESPONSE';

export class QueueError extends Error {
  public readonly code: QueueErrorCode;
  public readonly status?: number;
  public readonly responseText?: string;

  constructor(code: QueueErrorCode, message: string, extra: { status?: number; responseText?: string } = {}) {
    super(message);
    this.name = 'QueueError';
    this.code = code;
    this.status = extra.status;
    this.responseText = extra.responseText;
  }
}

interface CfApiError {
  code: number;
  message: string;
}

interface CfApiEnvelope<T> {
  success: boolean;
  errors?: CfApiError[];
  result: T;
}

function readConfig(env: QueuePublishEnv, queueIdEnvKey: string): {
  accountId: string;
  apiToken: string;
  baseUrl: string;
  queueId: string;
} {
  const accountId = env.CF_ACCOUNT_ID;
  const apiToken = env.CF_API_TOKEN;
  const queueId = typeof env[queueIdEnvKey] === 'string' ? (env[queueIdEnvKey] as string) : undefined;
  if (!accountId || !apiToken || !queueId) {
    throw new QueueError(
      'CONFIG_MISSING',
      `Queue config incomplete: need CF_ACCOUNT_ID, CF_API_TOKEN, and ${queueIdEnvKey}`
    );
  }
  const baseUrl = (env.CF_API_BASE_URL ?? DEFAULT_API_BASE_URL).replace(/\/+$/, '');
  return { accountId, apiToken, baseUrl, queueId };
}

function queueUrl(baseUrl: string, accountId: string, queueId: string): string {
  return `${baseUrl}/accounts/${encodeURIComponent(accountId)}/queues/${encodeURIComponent(queueId)}/messages`;
}

async function request<T>(url: string, apiToken: string, body: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
  } catch (err) {
    throw new QueueError('API_REQUEST_FAILED', (err as Error).message);
  }

  const text = await res.text().catch(() => '');
  if (!res.ok) {
    throw new QueueError(
      'API_REQUEST_FAILED',
      `Cloudflare queue request failed (${res.status})`,
      { status: res.status, responseText: text }
    );
  }

  let payload: CfApiEnvelope<T>;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new QueueError('INVALID_RESPONSE', 'Cloudflare queue response was not valid JSON', {
      responseText: text,
    });
  }

  if (!payload.success) {
    const msg = payload.errors?.map((e) => e.message).join('; ') || 'Unknown Cloudflare queue error';
    throw new QueueError('API_REJECTED', msg, { responseText: text });
  }

  return payload.result;
}

/**
 * Publish a single JSON message to the queue whose id is held in
 * `env[queueIdEnvKey]`. The message becomes `{ body: <message> }` on the
 * CF side, matching the existing Express `CloudflareQueueClient.publish`.
 */
export async function publishToQueue(
  env: QueuePublishEnv,
  queueIdEnvKey: string,
  message: unknown
): Promise<void> {
  const { accountId, apiToken, baseUrl, queueId } = readConfig(env, queueIdEnvKey);
  await request<unknown>(queueUrl(baseUrl, accountId, queueId), apiToken, { body: message });
}

/**
 * Publish up to 100 messages in one call. Uses the `/batch` endpoint.
 */
export async function publishBatch(
  env: QueuePublishEnv,
  queueIdEnvKey: string,
  messages: unknown[]
): Promise<void> {
  if (messages.length === 0) return;
  if (messages.length > 100) {
    throw new QueueError(
      'CONFIG_MISSING',
      `publishBatch accepts up to 100 messages per call (got ${messages.length})`
    );
  }
  const { accountId, apiToken, baseUrl, queueId } = readConfig(env, queueIdEnvKey);
  await request<unknown>(
    queueUrl(baseUrl, accountId, queueId) + '/batch',
    apiToken,
    { messages: messages.map((m) => ({ body: m })) }
  );
}
