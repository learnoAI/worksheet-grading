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

// Workflow binding stub used by both /process and /finalize tests. Each
// test that exercises dispatch passes this in via the env override; the
// `create` mock returns an instance whose id matches the jobId, mirroring
// what the CF runtime does (workflow id = grading job id).
function makeWorkflowBindingStub() {
  const create = vi.fn(async ({ id }: { id: string }) => ({ id }));
  const get = vi.fn();
  return { binding: { create, get }, create, get };
}

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
          worksheetUploadBatch: {
            create: batchCreate,
            // No stale batches → supersession is a no-op.
            findMany: vi.fn().mockResolvedValue([]),
            update: vi.fn(),
          },
          worksheetUploadItem: {
            create: itemCreate,
            updateMany: vi.fn().mockResolvedValue({ count: 0 }),
            count: vi.fn().mockResolvedValue(0),
          },
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

  it('supersedes stale UPLOADING batches: PENDING → FAILED, batch FINALIZED, QUEUED untouched', async () => {
    const teacherClassFindUnique = vi.fn().mockResolvedValue({ teacherId: 't1' });
    const studentClassFindMany = vi.fn().mockResolvedValue([{ studentId: 'st1' }]);

    // Two stale batches found; the sweep should mark their PENDING items
    // FAILED. Batch A has only PENDING items (1 here, all FAILED) → finalized.
    // Batch B has a remaining QUEUED item after the sweep → left UPLOADING.
    const staleFindMany = vi
      .fn()
      .mockResolvedValue([{ id: 'stale-a' }, { id: 'stale-b' }]);
    const itemUpdateMany = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })  // stale-a: 1 PENDING marked FAILED
      .mockResolvedValueOnce({ count: 0 }); // stale-b: 0 PENDING (everything QUEUED)
    const itemCount = vi
      .fn()
      .mockResolvedValueOnce(0) // stale-a: no PENDING remaining → finalize
      .mockResolvedValueOnce(2); // stale-b: 2 QUEUED still pending (in the items table) → don't finalize
    const batchUpdate = vi.fn().mockResolvedValue({ id: 'stale-a', status: 'FINALIZED' });

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
          worksheetUploadBatch: {
            create: batchCreate,
            findMany: staleFindMany,
            update: batchUpdate,
          },
          worksheetUploadItem: {
            create: itemCreate,
            updateMany: itemUpdateMany,
            count: itemCount,
          },
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

    // The findMany must be scoped to the same teacher/class/date and only
    // UPLOADING + idle past the threshold.
    const findManyArgs = staleFindMany.mock.calls[0][0];
    expect(findManyArgs.where.teacherId).toBe('t1');
    expect(findManyArgs.where.classId).toBe('c1');
    expect(findManyArgs.where.status).toBe('UPLOADING');
    expect(findManyArgs.where.updatedAt).toMatchObject({ lt: expect.any(Date) });

    // PENDING items in stale batches must be marked FAILED with the
    // canonical reason; updateMany must NOT touch QUEUED items.
    const firstUpdate = itemUpdateMany.mock.calls[0][0];
    expect(firstUpdate.where.status).toBe('PENDING');
    expect(firstUpdate.data.status).toBe('FAILED');
    expect(firstUpdate.data.errorMessage).toBe('Superseded by new upload session');

    // stale-a (no PENDING remaining) → finalized; stale-b is left alone.
    expect(batchUpdate).toHaveBeenCalledTimes(1);
    expect(batchUpdate.mock.calls[0][0].where).toEqual({ id: 'stale-a' });
    expect(batchUpdate.mock.calls[0][0].data.status).toBe('FINALIZED');
    expect(batchUpdate.mock.calls[0][0].data.finalizedAt).toBeInstanceOf(Date);
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

describe('POST /api/worksheet-processing/process', () => {
  beforeEach(() => vi.clearAllMocks());

  function makeR2Bucket() {
    const puts: Array<{ key: string }> = [];
    return {
      bucket: {
        put: vi.fn(async (key: string) => {
          puts.push({ key });
          return {};
        }),
        get: vi.fn(async () => null),
        delete: vi.fn(async () => {}),
        head: vi.fn(async () => null),
      },
      puts,
    };
  }

  function makeMultipart(
    fields: Record<string, string>,
    files: Array<{ name: string; type: string; size: number }>
  ): RequestInit {
    const fd = new FormData();
    for (const [k, v] of Object.entries(fields)) fd.append(k, v);
    for (const f of files) {
      fd.append('files', new Blob([new Uint8Array(f.size)], { type: f.type }), f.name);
    }
    return { method: 'POST', body: fd };
  }

  it('rejects request with no files', async () => {
    const app = mountApp({});
    const token = await tokenAs('TEACHER');
    const init = makeMultipart(
      {
        token_no: 'T1',
        worksheet_name: 'W',
        classId: 'c1',
        studentId: 'st1',
        worksheetNumber: '5',
      },
      []
    );
    const res = await app.request(
      '/api/worksheet-processing/process',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
  });

  it('rejects missing required metadata fields', async () => {
    const app = mountApp({});
    const token = await tokenAs('TEACHER');
    const init = makeMultipart(
      { token_no: 'T1', worksheet_name: 'W' },
      [{ name: 'a.png', type: 'image/png', size: 10 }]
    );
    const res = await app.request(
      '/api/worksheet-processing/process',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(400);
  });

  it('creates a GradingJob, uploads images to R2, dispatches a workflow, returns 202', async () => {
    const { bucket, puts } = makeR2Bucket();
    const gradingJobCreate = vi.fn().mockResolvedValue({ id: 'job-1' });
    const gradingJobImageCreate = vi.fn().mockResolvedValue({});
    const gradingJobUpdate = vi.fn().mockResolvedValue({});
    const userFindUnique = vi.fn().mockResolvedValue({ name: 'Alice' });
    const wf = makeWorkflowBindingStub();

    const prisma = {
      user: { findUnique: userFindUnique },
      gradingJob: { create: gradingJobCreate, update: gradingJobUpdate },
      gradingJobImage: { create: gradingJobImageCreate },
    };
    const app = mountApp(prisma);
    const token = await tokenAs('TEACHER', 't1');
    const init = makeMultipart(
      {
        token_no: 'T1',
        worksheet_name: 'W',
        classId: 'c1',
        studentId: 'st1',
        worksheetNumber: '5',
      },
      [{ name: 'a.png', type: 'image/png', size: 100 }]
    );
    const res = await app.request(
      '/api/worksheet-processing/process',
      { ...init, headers: { Authorization: `Bearer ${token}` } },
      {
        JWT_SECRET: SECRET,
        WORKSHEET_FILES: bucket as never,
        R2_PUBLIC_BASE_URL: 'https://cdn.example.com',
        GRADING_WORKFLOW: wf.binding,
      }
    );
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; dispatchState: string };
    expect(body.jobId).toBe('job-1');
    expect(body.dispatchState).toBe('DISPATCHED');
    expect(puts.length).toBe(1);
    expect(puts[0].key).toMatch(/^worksheets\/job-1\/\d+-page1-a\.png$/);
    expect(gradingJobImageCreate).toHaveBeenCalled();
    // Workflow created exactly once with the job id as both the
    // instance id and the params.jobId.
    expect(wf.create).toHaveBeenCalledTimes(1);
    const createArgs = wf.create.mock.calls[0][0] as {
      id: string;
      params: { jobId: string };
    };
    expect(createArgs.id).toBe('job-1');
    expect(createArgs.params.jobId).toBe('job-1');
    // The dispatch path also stamps workflowInstanceId on the row.
    const updateData = gradingJobUpdate.mock.calls[0][0].data;
    expect(updateData.workflowInstanceId).toBe('job-1');
    expect(updateData.enqueuedAt).toBeInstanceOf(Date);
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

    const wf = makeWorkflowBindingStub();

    // The finalize handler now scopes to affected items via findMany
    // (loadUploadItems) instead of re-reading the entire batch.
    const itemFindMany = vi.fn().mockImplementation(async () =>
      mutableBatch.items.map((it) => ({ ...it }))
    );

    // The handler now wraps three things in $transaction:
    //   1. createGradingJobFromUploadItem (existing — claim → create job → ...)
    //   2. updateMany(image.uploadedAt) + findMany(item.images)  — Hyperdrive
    //      cache-bypass for the image-uploaded → item-fetch race
    //   3. count(PENDING items) + conditional batch.update FINALIZED — same
    //      cache-bypass for the count-after-job-creation race
    // The mock tx callback includes every method any of the three may call.
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        worksheetUploadItem: {
          updateMany: itemClaim,
          findUnique: itemFindUnique,
          update: itemUpdate,
          findMany: itemFindMany,
          count: itemCount,
        },
        worksheetUploadImage: { updateMany: imageUpdateMany },
        worksheetUploadBatch: { update: batchUpdate },
        gradingJob: { create: gradingJobCreate },
        gradingJobImage: { createMany: gradingJobImageCreateMany },
      })
    );

    const prisma = {
      worksheetUploadBatch: { findUnique: batchFindUnique, update: batchUpdate },
      worksheetUploadImage: { updateMany: imageUpdateMany },
      worksheetUploadItem: {
        count: itemCount,
        update: vi.fn(),
        findMany: itemFindMany,
      },
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
      { JWT_SECRET: SECRET, GRADING_WORKFLOW: wf.binding }
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

    // One workflow per job, with the job id used as both the instance
    // id and the params.jobId.
    expect(wf.create).toHaveBeenCalledTimes(1);
    expect(wf.create.mock.calls[0][0].id).toBe('job-1');
  });

  it('reports pending when an affected item still has missing images on a partial upload', async () => {
    // An item with two images: the client just uploaded img-2 but img-1
    // is still pending. The new affected-only semantic still picks this
    // item up (img-2 is in the uploaded set) and surfaces it as pending.
    const itemImages = [
      {
        id: 'img-1',
        pageNumber: 1,
        mimeType: 'image/png',
        fileSize: null,
        originalName: null,
        s3Key: 'k1',
        imageUrl: 'u1',
        uploadedAt: null as Date | null,
      },
      {
        id: 'img-2',
        pageNumber: 2,
        mimeType: 'image/png',
        fileSize: null,
        originalName: null,
        s3Key: 'k2',
        imageUrl: 'u2',
        uploadedAt: null as Date | null,
      },
    ];
    let mutableBatch = {
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
          images: itemImages,
        },
      ],
    };
    const imageUpdateMany = vi.fn(async () => {
      // Only img-2 is in uploadedImageIds, so only img-2 gets uploadedAt.
      mutableBatch = {
        ...mutableBatch,
        items: mutableBatch.items.map((it) => ({
          ...it,
          images: it.images.map((img) =>
            img.id === 'img-2' ? { ...img, uploadedAt: new Date() } : img
          ),
        })),
      };
      return { count: 1 };
    });
    const batchFindUnique = vi.fn().mockImplementation(async () => mutableBatch);
    const itemFindMany = vi.fn().mockImplementation(async () =>
      mutableBatch.items.map((it) => ({ ...it }))
    );
    const itemCount = vi.fn().mockResolvedValue(1);
    const batchUpdate = vi.fn();
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        worksheetUploadItem: { findMany: itemFindMany, count: itemCount },
        worksheetUploadImage: { updateMany: imageUpdateMany },
        worksheetUploadBatch: { update: batchUpdate },
      })
    );
    const prisma = {
      worksheetUploadBatch: { findUnique: batchFindUnique, update: batchUpdate },
      worksheetUploadImage: { updateMany: imageUpdateMany },
      worksheetUploadItem: {
        count: itemCount,
        findMany: itemFindMany,
      },
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
        body: JSON.stringify({ uploadedImageIds: ['img-2'] }),
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

  it('is a no-op when uploadedImageIds is empty (affected-only scoping)', async () => {
    // The pre-codex behavior would walk every item in the batch on an
    // empty payload. The new semantic says: finalize only commits items
    // whose images the client just uploaded — an empty payload commits
    // nothing. This locks that contract in.
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
          images: [{ id: 'img-1', uploadedAt: null }],
        },
      ],
    });
    const itemFindMany = vi.fn();
    const itemCount = vi.fn().mockResolvedValue(1);
    const imageUpdateMany = vi.fn().mockResolvedValue({ count: 0 });
    const batchUpdate = vi.fn();
    const transaction = vi.fn(async (cb: (tx: unknown) => Promise<unknown>) =>
      cb({
        worksheetUploadItem: { findMany: itemFindMany, count: itemCount },
        worksheetUploadImage: { updateMany: imageUpdateMany },
        worksheetUploadBatch: { update: batchUpdate },
      })
    );
    const prisma = {
      worksheetUploadBatch: { findUnique: batchFindUnique, update: batchUpdate },
      worksheetUploadImage: { updateMany: imageUpdateMany },
      worksheetUploadItem: {
        count: itemCount,
        findMany: itemFindMany,
      },
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
        body: JSON.stringify({ uploadedImageIds: [] }),
      },
      { JWT_SECRET: SECRET }
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      queued: unknown[];
      pending: unknown[];
      failed: unknown[];
    };
    expect(body.queued.length).toBe(0);
    expect(body.pending.length).toBe(0);
    expect(body.failed.length).toBe(0);
    // Cheap-path proof: with no uploaded image IDs, we shouldn't bother
    // hitting findMany at all. loadUploadItems short-circuits on empty.
    expect(itemFindMany).not.toHaveBeenCalled();
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
