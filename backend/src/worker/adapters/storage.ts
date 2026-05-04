import { AwsClient } from 'aws4fetch';
import type { R2Bucket, R2Object, WorkerEnv } from '../types';

/**
 * Workers-native replacement for the subset of `backend/src/services/s3Service.ts`
 * that the Hono worker needs.
 *
 * Two strategies share this module:
 *
 *   1. **R2 binding** (preferred) — `env.WORKSHEET_FILES.put/get/delete`
 *      is zero-latency in-process with no signing overhead. Used for all
 *      buffer-level operations (uploads from inside the worker, deletes,
 *      downloads).
 *
 *   2. **aws4fetch against the R2 S3-compatible endpoint** — used *only*
 *      for presigned URL generation, which R2 bindings don't expose. This
 *      lets the browser upload directly to R2 without streaming through
 *      the worker (important for the direct-upload session flow).
 *
 * Everything here mirrors the Express `s3Service` surface area so routes
 * can swap implementations without logic changes. Missing env/bindings
 * produce `StorageError` with stable `code`s.
 */

export type StorageErrorCode =
  | 'BINDING_MISSING'
  | 'CONFIG_MISSING'
  | 'OBJECT_NOT_FOUND'
  | 'SIGNING_FAILED';

export class StorageError extends Error {
  public readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

function requireBucket(env: WorkerEnv): R2Bucket {
  if (!env.WORKSHEET_FILES) {
    throw new StorageError(
      'BINDING_MISSING',
      'WORKSHEET_FILES R2 binding is not configured'
    );
  }
  return env.WORKSHEET_FILES;
}

function requireS3Config(env: WorkerEnv): {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  endpoint: string;
} {
  const { R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET_NAME, R2_ENDPOINT } = env;
  if (
    !R2_ACCOUNT_ID ||
    !R2_ACCESS_KEY_ID ||
    !R2_SECRET_ACCESS_KEY ||
    !R2_BUCKET_NAME ||
    !R2_ENDPOINT
  ) {
    throw new StorageError(
      'CONFIG_MISSING',
      'R2 S3 credentials are not fully configured (account/access/secret/bucket/endpoint)'
    );
  }
  return {
    accountId: R2_ACCOUNT_ID,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    bucketName: R2_BUCKET_NAME,
    endpoint: R2_ENDPOINT,
  };
}

/**
 * Upload an in-memory buffer to R2. Use for server-side uploads (worksheet
 * images arriving via multipart); for browser-direct uploads, generate a
 * presigned URL with `createPresignedPutUrl` instead.
 */
export async function uploadObject(
  env: WorkerEnv,
  key: string,
  body: ArrayBuffer | Uint8Array | Blob,
  contentType: string
): Promise<{ key: string; publicUrl: string | null }> {
  const bucket = requireBucket(env);
  await bucket.put(key, body, { httpMetadata: { contentType } });
  return { key, publicUrl: publicObjectUrl(env, key) };
}

export async function deleteObject(env: WorkerEnv, key: string): Promise<void> {
  const bucket = requireBucket(env);
  await bucket.delete(key);
}

export async function downloadObject(
  env: WorkerEnv,
  key: string
): Promise<{ body: Uint8Array; contentType: string | null; size: number }> {
  const bucket = requireBucket(env);
  const obj: R2Object | null = await bucket.get(key);
  if (!obj) {
    throw new StorageError('OBJECT_NOT_FOUND', `No object at key "${key}"`);
  }
  const buffer = await obj.arrayBuffer();
  return {
    body: new Uint8Array(buffer),
    contentType: obj.httpMetadata?.contentType ?? null,
    size: obj.size,
  };
}

/**
 * Public URL of an object. Returns `null` if `R2_PUBLIC_BASE_URL` isn't
 * configured — callers can then fall back to a presigned GET URL if they
 * need readable links.
 */
export function publicObjectUrl(env: WorkerEnv, key: string): string | null {
  const base = env.R2_PUBLIC_BASE_URL;
  if (!base) return null;
  // Avoid double slashes; accept base with or without trailing slash.
  const normalizedBase = base.endsWith('/') ? base.slice(0, -1) : base;
  const normalizedKey = key.startsWith('/') ? key.slice(1) : key;
  return `${normalizedBase}/${normalizedKey}`;
}

/**
 * Generate a time-limited PUT URL so the browser can upload directly to R2.
 * Powers the worksheet direct-upload session flow.
 *
 * Expiry is in seconds; matches the 60s default the Express service uses.
 * Signing happens via `aws4fetch` with the R2 S3-compatible endpoint.
 */
export async function createPresignedPutUrl(
  env: WorkerEnv,
  key: string,
  contentType: string,
  expiresInSeconds = 60
): Promise<string> {
  const cfg = requireS3Config(env);
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: 's3',
    region: 'auto',
  });
  const url = new URL(
    `${cfg.endpoint.replace(/\/+$/, '')}/${cfg.bucketName}/${encodeKey(key)}`
  );
  url.searchParams.set('X-Amz-Expires', String(expiresInSeconds));

  let signed: Request;
  try {
    signed = await client.sign(
      new Request(url.toString(), {
        method: 'PUT',
        headers: { 'Content-Type': contentType },
      }),
      { aws: { signQuery: true } }
    );
  } catch (err) {
    throw new StorageError('SIGNING_FAILED', (err as Error).message);
  }
  return signed.url;
}

/**
 * Encode each path segment individually so forward slashes in the key are
 * preserved (R2 uses `/` for pseudo-folders in keys).
 */
function encodeKey(key: string): string {
  return key
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}
