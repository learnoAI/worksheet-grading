import { describe, expect, it, beforeEach, vi, afterEach } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import worksheetProcessing from './worksheetProcessing';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

const baseR2Env = {
  R2_ACCOUNT_ID: 'acct',
  R2_ACCESS_KEY_ID: 'AKID',
  R2_SECRET_ACCESS_KEY: 'SECRET',
  R2_BUCKET_NAME: 'my-bucket',
  R2_ENDPOINT: 'https://acct.r2.cloudflarestorage.com',
  R2_PUBLIC_BASE_URL: 'https://cdn.example.com',
};

const queueEnv = {
  CF_ACCOUNT_ID: 'cf-acct',
  CF_API_TOKEN: 'cf-token',
  CF_QUEUE_ID: 'cf-queue',
};

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/worksheet-processing', worksheetProcessing);
  return app;
}

async function tokenAs(role = 'TEACHER', userId = 't1') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId, role, exp }, SECRET, 'HS256');
}

async function jsonRequest(
  app: Hono<AppBindings>,
  path: string,
  method: string,
  body: unknown,
  env: Record<string, unknown> = {},
  token?: string
): Promise<Response> {
  const t = token ?? (await tokenAs('TEACHER'));
  return app.request(
    path,
    {
      method,
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { JWT_SECRET: SECRET, ...env }
  );
}

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('POST /api/worksheet-processing/upload-session', () => {
  beforeEach(() => vi.clearAllMocks());

  const validBody = {
    classId: 'c1',
    submittedOn: '2026-04-10T00:00:00Z',
    worksheets: [
      {
        studentId: 'st1',
        studentName: 'Alice',
        worksheetNumber: 5,
        files: [{ pageNumber: 1, mimeType: 'image/png', fileName: 'p1.png' }],
      },
    ],
  };

  it('returns 401 without a token', async () => {
    const app = mountApp({});
    const res = await app.request(
      '/api/worksheet-processing/upload-session',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(validBody),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for STUDENT role', async () => {
    const app = mountApp({});
    const res = await jsonRequest(
      app,
      '/api/worksheet-processing/upload-session',
      'POST',
      validBody,
      {},
      await tokenAs('STUDENT', 'stu1')
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when classId is missing', async () => {
    const app = mountApp({});
    const res = await jsonRequest(
      app,
      '/api/worksheet-processing/upload-session',
      'POST',
      { ...validBody, classId: undefined }
    );
    expect(res.status).toBe(400);
  });

  it('returns 400 when teacher is not assigned to the class (ValidationError)', async () => {
    const prisma = {
      teacherClass: { findUnique: vi.fn().mockResolvedValue(null) },
      studentClass: { findMany: vi.fn() },
    };
    const app = mountApp(prisma);
    const res = await jsonRequest(
      app,
      '/api/worksheet-processing/upload-session',
      'POST',
      validBody,
      baseR2Env
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toContain('not assigned to this class');
  });

  it('creates a batch + items + images and returns presigned URLs', async () => {
    const teacherClassFindUnique = vi
      .fn()
      .mockResolvedValue({ teacherId: 't1' });
    const studentClassFindMany = vi.fn().mockResolvedValue([{ studentId: 'st1' }]);

    // Inner tx calls
    const batchCreate = vi.fn().mockResolvedValue({
      id: 'b-new',
      classId: 'c1',
      submittedOn: new Date('2026-04-10T00:00:00Z'),
      status: 'UPLOADING',
      finalizedAt: null,
      teacherId: 't1',
    });
    const itemCreate = vi.fn().mockResolvedValue({
      id: 'item-1',
      studentId: 'st1',
      studentName: 'Alice',
      tokenNo: null,
      worksheetNumber: 5,
      worksheetName: '5',
      isRepeated: false,
      status: 'PENDING',
      jobId: null,
      errorMessage: null,
    });
    const imageCreate = vi.fn().mockResolvedValue({
      id: 'img-1',
      pageNumber: 1,
      mimeType: 'image/png',
      fileSize: null,
      originalName: 'p1.png',
      s3Key: 'some-key',
      imageUrl: 'https://cdn.example.com/some-key',
      uploadedAt: null,
    });

    const prisma = {
      teacherClass: { findUnique: teacherClassFindUnique },
      studentClass: { findMany: studentClassFindMany },
      $transaction: vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
        cb({
          worksheetUploadBatch: { create: batchCreate },
          worksheetUploadItem: { create: itemCreate },
          worksheetUploadImage: { create: imageCreate },
        })
      ),
    };
    const app = mountApp(prisma);
    const res = await jsonRequest(
      app,
      '/api/worksheet-processing/upload-session',
      'POST',
      validBody,
      baseR2Env
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      success: boolean;
      batchId: string;
      items: Array<{ files: Array<{ uploadUrl: string | null; expiresAt: string | null }> }>;
    };
    expect(body.success).toBe(true);
    expect(body.batchId).toBe('b-new');
    expect(body.items.length).toBe(1);
    expect(body.items[0].files.length).toBe(1);
    // Unuploaded image should have an uploadUrl (presigned) and expiresAt
    expect(body.items[0].files[0].uploadUrl).toContain('X-Amz-Signature=');
    expect(body.items[0].files[0].expiresAt).toBeTruthy();
  });
});

describe('GET /api/worksheet-processing/upload-session/:batchId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when batch does not exist', async () => {
    const prisma = {
      worksheetUploadBatch: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const app = mountApp(prisma);
    const token = await tokenAs('TEACHER');
    const res = await app.request(
      '/api/worksheet-processing/upload-session/missing',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET, ...baseR2Env }
    );
    expect(res.status).toBe(404);
  });

  it('returns 404 when teacher does not own the batch', async () => {
    const prisma = {
      worksheetUploadBatch: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'b1',
          classId: 'c1',
          submittedOn: new Date(),
          status: 'UPLOADING',
          finalizedAt: null,
          teacherId: 'other-teacher',
          items: [],
        }),
      },
    };
    const app = mountApp(prisma);
    const token = await tokenAs('TEACHER', 't1');
    const res = await app.request(
      '/api/worksheet-processing/upload-session/b1',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET, ...baseR2Env }
    );
    expect(res.status).toBe(404);
  });

  it('returns the batch with refreshed presigned URLs for pending images', async () => {
    const prisma = {
      worksheetUploadBatch: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'b1',
          classId: 'c1',
          submittedOn: new Date('2026-04-10T00:00:00Z'),
          status: 'UPLOADING',
          finalizedAt: null,
          teacherId: 't1',
          items: [
            {
              id: 'item-1',
              studentId: 'st1',
              studentName: 'Alice',
              tokenNo: null,
              worksheetNumber: 5,
              worksheetName: '5',
              isRepeated: false,
              status: 'PENDING',
              jobId: null,
              errorMessage: null,
              images: [
                {
                  id: 'img-1',
                  pageNumber: 1,
                  mimeType: 'image/png',
                  fileSize: null,
                  originalName: 'p.png',
                  s3Key: 'some-key',
                  imageUrl: 'https://cdn.example.com/some-key',
                  uploadedAt: null,
                },
              ],
            },
          ],
        }),
      },
    };
    const app = mountApp(prisma);
    const token = await tokenAs('TEACHER', 't1');
    const res = await app.request(
      '/api/worksheet-processing/upload-session/b1',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET, ...baseR2Env }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ files: Array<{ uploadUrl: string | null }> }>;
    };
    expect(body.items[0].files[0].uploadUrl).toContain('X-Amz-Signature=');
  });

  it('returns uploadUrl=null for already-uploaded images', async () => {
    const prisma = {
      worksheetUploadBatch: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'b1',
          classId: 'c1',
          submittedOn: new Date(),
          status: 'UPLOADING',
          finalizedAt: null,
          teacherId: 't1',
          items: [
            {
              id: 'item-1',
              studentId: 'st1',
              studentName: 'Alice',
              tokenNo: null,
              worksheetNumber: 5,
              worksheetName: '5',
              isRepeated: false,
              status: 'PENDING',
              jobId: null,
              errorMessage: null,
              images: [
                {
                  id: 'img-1',
                  pageNumber: 1,
                  mimeType: 'image/png',
                  fileSize: null,
                  originalName: null,
                  s3Key: 'k',
                  imageUrl: 'u',
                  uploadedAt: new Date(),
                },
              ],
            },
          ],
        }),
      },
    };
    const app = mountApp(prisma);
    const token = await tokenAs('TEACHER', 't1');
    const res = await app.request(
      '/api/worksheet-processing/upload-session/b1',
      { headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET, ...baseR2Env }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{ files: Array<{ uploadUrl: string | null; uploadedAt: string | null }> }>;
    };
    expect(body.items[0].files[0].uploadUrl).toBeNull();
    expect(body.items[0].files[0].uploadedAt).toBeTruthy();
  });
});

describe('POST /api/worksheet-processing/upload-session/:batchId/finalize', () => {
  beforeEach(() => vi.clearAllMocks());

  it('marks uploaded image IDs, creates grading jobs, and dispatches to queue', async () => {
    let mutableBatch = {
      id: 'b1',
      classId: 'c1',
      submittedOn: new Date('2026-04-10T00:00:00Z'),
      status: 'UPLOADING',
      finalizedAt: null,
      teacherId: 't1',
      items: [
        {
          id: 'item-1',
          studentId: 'st1',
          studentName: 'Alice',
          tokenNo: null,
          worksheetNumber: 5,
          worksheetName: '5',
          isRepeated: false,
          status: 'PENDING',
          jobId: null,
          errorMessage: null,
          images: [
            {
              id: 'img-1',
              pageNumber: 1,
              mimeType: 'image/png',
              fileSize: null,
              originalName: 'p.png',
              s3Key: 'k-1',
              imageUrl: 'u',
              // null at first → becomes Date after updateMany
              uploadedAt: null as Date | null,
            },
          ],
        },
      ],
    };

    const imageUpdateMany = vi.fn(async () => {
      mutableBatch = {
        ...mutableBatch,
        items: mutableBatch.items.map((it) => ({
          ...it,
          images: it.images.map((img) => ({ ...img, uploadedAt: new Date() })),
        })),
      };
      return { count: 1 };
    });
    const batchFindUnique = vi.fn().mockImplementation(async () => mutableBatch);

    const itemClaim = vi.fn().mockResolvedValue({ count: 1 });
    const itemFindUnique = vi.fn().mockResolvedValue({
      id: 'item-1',
      studentId: 'st1',
      studentName: 'Alice',
      worksheetNumber: 5,
      worksheetName: '5',
      tokenNo: null,
      isRepeated: false,
      jobId: null,
      errorMessage: null,
      batch: {
        classId: 'c1',
        teacherId: 't1',
        submittedOn: new Date('2026-04-10T00:00:00Z'),
      },
      images: [
        {
          id: 'img-1',
          storageProvider: 'R2',
          imageUrl: 'u',
          s3Key: 'k-1',
          pageNumber: 1,
          mimeType: 'image/png',
          uploadedAt: new Date(),
        },
      ],
    });
    const gradingJobCreate = vi.fn().mockResolvedValue({ id: 'job-1' });
    const gradingJobImageCreateMany = vi.fn().mockResolvedValue({ count: 1 });
    const itemUpdate = vi.fn().mockResolvedValue({});
    const gradingJobUpdate = vi.fn().mockResolvedValue({});
    const batchUpdate = vi.fn().mockResolvedValue({});
    const itemCount = vi.fn().mockResolvedValue(0);

    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        worksheetUploadItem: {
          updateMany: itemClaim,
          findUnique: itemFindUnique,
          update: itemUpdate,
        },
        gradingJob: { create: gradingJobCreate },
        gradingJobImage: { createMany: gradingJobImageCreateMany },
      })
    );

    // Mock fetch for the queue publish
    globalThis.fetch = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, result: {} }), { status: 200 })
    ) as unknown as typeof fetch;

    const prisma = {
      worksheetUploadBatch: { findUnique: batchFindUnique, update: batchUpdate },
      worksheetUploadImage: { updateMany: imageUpdateMany },
      worksheetUploadItem: { count: itemCount, update: vi.fn() },
      gradingJob: { update: gradingJobUpdate },
      $transaction: transaction,
    };
    const app = mountApp(prisma);
    const token = await tokenAs('TEACHER', 't1');
    const res = await app.request(
      '/api/worksheet-processing/upload-session/b1/finalize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uploadedImageIds: ['img-1'] }),
      },
      { JWT_SECRET: SECRET, ...queueEnv }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      queued: Array<{ jobId: string; dispatchState: string }>;
      pending: unknown[];
      failed: unknown[];
      status: string;
    };
    expect(body.queued.length).toBe(1);
    expect(body.queued[0].jobId).toBe('job-1');
    expect(body.queued[0].dispatchState).toBe('DISPATCHED');
    expect(body.status).toBe('FINALIZED'); // because itemCount returns 0

    // Queue was hit with the job payload
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('reports pending items when images have not been uploaded yet', async () => {
    const batchFindUnique = vi.fn().mockResolvedValue({
      id: 'b1',
      classId: 'c1',
      submittedOn: new Date(),
      status: 'UPLOADING',
      finalizedAt: null,
      teacherId: 't1',
      items: [
        {
          id: 'item-1',
          studentId: 'st1',
          studentName: 'Alice',
          tokenNo: null,
          worksheetNumber: 5,
          worksheetName: '5',
          isRepeated: false,
          status: 'PENDING',
          jobId: null,
          errorMessage: null,
          images: [
            {
              id: 'img-1',
              pageNumber: 1,
              mimeType: 'image/png',
              fileSize: null,
              originalName: null,
              s3Key: 'k',
              imageUrl: 'u',
              uploadedAt: null,
            },
          ],
        },
      ],
    });
    const prisma = {
      worksheetUploadBatch: { findUnique: batchFindUnique, update: vi.fn() },
      worksheetUploadImage: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
      worksheetUploadItem: { count: vi.fn().mockResolvedValue(1) },
    };
    const app = mountApp(prisma);
    const token = await tokenAs('TEACHER', 't1');
    const res = await app.request(
      '/api/worksheet-processing/upload-session/b1/finalize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ uploadedImageIds: [] }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      queued: unknown[];
      pending: Array<{ missingImageIds: string[] }>;
      failed: unknown[];
      status: string;
    };
    expect(body.queued.length).toBe(0);
    expect(body.pending.length).toBe(1);
    expect(body.pending[0].missingImageIds).toEqual(['img-1']);
    expect(body.status).toBe('UPLOADING');
  });

  it('returns 404 when batch does not exist', async () => {
    const prisma = {
      worksheetUploadBatch: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const app = mountApp(prisma);
    const token = await tokenAs('TEACHER', 't1');
    const res = await app.request(
      '/api/worksheet-processing/upload-session/missing/finalize',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(404);
  });
});
