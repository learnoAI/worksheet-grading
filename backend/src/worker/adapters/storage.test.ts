import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  uploadObject,
  deleteObject,
  downloadObject,
  publicObjectUrl,
  createPresignedPutUrl,
  StorageError,
} from './storage';
import type { R2Bucket, R2Object, WorkerEnv } from '../types';

/**
 * Builds a minimal in-memory R2 bucket that records the put/get/delete
 * calls so tests can assert against them. We store values as ArrayBuffer
 * so `.arrayBuffer()` on the returned R2Object returns a copy.
 */
function makeBucket(): R2Bucket & { _calls: { put: unknown[]; get: string[]; delete: unknown[] } } {
  const store = new Map<string, { body: ArrayBuffer; contentType: string }>();
  const calls = { put: [] as unknown[], get: [] as string[], delete: [] as unknown[] };
  return {
    _calls: calls,
    async put(key, body, options) {
      calls.put.push({ key, body, options });
      let buf: ArrayBuffer;
      if (body instanceof ArrayBuffer) buf = body;
      else if (body instanceof Uint8Array) buf = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength) as ArrayBuffer;
      else if (body instanceof Blob) buf = await body.arrayBuffer();
      else buf = new TextEncoder().encode(String(body)).buffer as ArrayBuffer;
      store.set(key, { body: buf, contentType: options?.httpMetadata?.contentType ?? 'application/octet-stream' });
      return {};
    },
    async get(key): Promise<R2Object | null> {
      calls.get.push(key);
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.body.byteLength,
        etag: 'etag-' + key,
        httpMetadata: { contentType: entry.contentType },
        body: null,
        async arrayBuffer() {
          return entry.body.slice(0);
        },
      };
    },
    async delete(key) {
      calls.delete.push(key);
      if (Array.isArray(key)) {
        for (const k of key) store.delete(k);
      } else {
        store.delete(key);
      }
    },
    async head(key) {
      const entry = store.get(key);
      if (!entry) return null;
      return {
        key,
        size: entry.body.byteLength,
        etag: 'etag-' + key,
        httpMetadata: { contentType: entry.contentType },
        async arrayBuffer() {
          return entry.body.slice(0);
        },
      };
    },
  };
}

function envWith(bucket?: R2Bucket, overrides: Partial<WorkerEnv> = {}): WorkerEnv {
  return {
    WORKSHEET_FILES: bucket,
    R2_PUBLIC_BASE_URL: 'https://cdn.example.com',
    R2_ACCOUNT_ID: 'acct',
    R2_ACCESS_KEY_ID: 'AKID',
    R2_SECRET_ACCESS_KEY: 'SECRET',
    R2_BUCKET_NAME: 'my-bucket',
    R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
    ...overrides,
  };
}

describe('uploadObject', () => {
  beforeEach(() => vi.clearAllMocks());

  it('throws BINDING_MISSING when R2 bucket is not bound', async () => {
    await expect(
      uploadObject(envWith(undefined), 'k', new Uint8Array([1]), 'image/png')
    ).rejects.toMatchObject({ code: 'BINDING_MISSING' });
  });

  it('puts the body on the bucket with the content-type metadata', async () => {
    const bucket = makeBucket();
    const env = envWith(bucket);
    const { key, publicUrl } = await uploadObject(
      env,
      'worksheets/a.png',
      new Uint8Array([1, 2, 3]),
      'image/png'
    );
    expect(key).toBe('worksheets/a.png');
    expect(publicUrl).toBe('https://cdn.example.com/worksheets/a.png');
    expect(bucket._calls.put.length).toBe(1);
    expect(bucket._calls.put[0]).toMatchObject({
      key: 'worksheets/a.png',
      options: { httpMetadata: { contentType: 'image/png' } },
    });
  });

  it('returns null publicUrl when R2_PUBLIC_BASE_URL is unset', async () => {
    const bucket = makeBucket();
    const env = envWith(bucket, { R2_PUBLIC_BASE_URL: undefined });
    const { publicUrl } = await uploadObject(env, 'x', new Uint8Array([1]), 'image/png');
    expect(publicUrl).toBeNull();
  });
});

describe('deleteObject', () => {
  it('forwards the key to bucket.delete', async () => {
    const bucket = makeBucket();
    const env = envWith(bucket);
    await uploadObject(env, 'k', new Uint8Array([1]), 'image/png');
    await deleteObject(env, 'k');
    expect(bucket._calls.delete).toContain('k');
  });

  it('throws BINDING_MISSING when bucket is not bound', async () => {
    await expect(deleteObject(envWith(undefined), 'k')).rejects.toMatchObject({
      code: 'BINDING_MISSING',
    });
  });
});

describe('downloadObject', () => {
  it('throws OBJECT_NOT_FOUND when the key does not exist', async () => {
    const bucket = makeBucket();
    const env = envWith(bucket);
    await expect(downloadObject(env, 'missing')).rejects.toMatchObject({
      code: 'OBJECT_NOT_FOUND',
    });
  });

  it('returns the object bytes, size, and content-type', async () => {
    const bucket = makeBucket();
    const env = envWith(bucket);
    await uploadObject(env, 'x.png', new Uint8Array([9, 8, 7]), 'image/png');
    const { body, contentType, size } = await downloadObject(env, 'x.png');
    expect(body).toBeInstanceOf(Uint8Array);
    expect(Array.from(body)).toEqual([9, 8, 7]);
    expect(contentType).toBe('image/png');
    expect(size).toBe(3);
  });
});

describe('publicObjectUrl', () => {
  it('joins base + key with a single slash regardless of trailing state', () => {
    const env = envWith(undefined, { R2_PUBLIC_BASE_URL: 'https://cdn.example.com/' });
    expect(publicObjectUrl(env, '/foo/bar.png')).toBe('https://cdn.example.com/foo/bar.png');
  });

  it('returns null when R2_PUBLIC_BASE_URL is unset', () => {
    const env = envWith(undefined, { R2_PUBLIC_BASE_URL: undefined });
    expect(publicObjectUrl(env, 'x')).toBeNull();
  });
});

describe('createPresignedPutUrl', () => {
  it('throws CONFIG_MISSING when S3 credentials are incomplete', async () => {
    const env = envWith(undefined, { R2_ACCESS_KEY_ID: undefined });
    await expect(
      createPresignedPutUrl(env, 'k', 'image/png')
    ).rejects.toMatchObject({ code: 'CONFIG_MISSING' });
  });

  it('returns a signed URL that includes the S3 query parameters', async () => {
    const env = envWith(undefined);
    const url = await createPresignedPutUrl(env, 'folder/a.png', 'image/png', 120);
    // aws4fetch produces pre-signed URLs with these canonical S3 params.
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Signature=');
    expect(url).toContain('X-Amz-Expires=120');
    expect(url).toContain('folder/a.png');
    expect(url.startsWith('https://acct.r2.cloudflarestorage.com')).toBe(true);
  });
});

describe('StorageError', () => {
  it('carries a stable code', () => {
    const e = new StorageError('CONFIG_MISSING', 'explanation');
    expect(e).toBeInstanceOf(Error);
    expect(e.code).toBe('CONFIG_MISSING');
    expect(e.name).toBe('StorageError');
  });
});
