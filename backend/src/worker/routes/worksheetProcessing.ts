import { Hono } from 'hono';
import {
  StorageProvider,
  UserRole,
  WorksheetUploadBatchStatus,
  WorksheetUploadItemStatus,
  GradingJobStatus,
  type PrismaClient,
} from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import {
  createPresignedPutUrl,
  publicObjectUrl,
  StorageError,
} from '../adapters/storage';
import { publishToQueue, QueueError } from '../adapters/queues';
import { uploadObject } from '../adapters/storage';
import { parseMultipartFiles, imageOnlyFilter, UploadError } from '../uploads';
import {
  capturePosthogEvent,
  capturePosthogException,
} from '../adapters/posthog';
import {
  ValidationError,
  assertDirectUploadAccess,
  buildDirectUploadKey,
  normalizeDirectUploadItems,
  parseSubmittedOn,
  requireString,
  DIRECT_UPLOAD_URL_TTL_SECONDS,
  type DirectUploadWorksheetInput,
} from '../lib/directUpload';
import type { AppBindings, WorkerEnv } from '../types';

/**
 * Worksheet processing routes — ports of the 4 handlers in
 * `backend/src/controllers/worksheetProcessingController.ts`.
 *
 * Mounted under `/api/worksheet-processing`. All endpoints require TEACHER,
 * ADMIN, or SUPERADMIN roles. All PostHog events (`direct_upload_*`,
 * `dispatch_*`, etc.) fire through the `posthog` adapter and are
 * deliberately wrapped in `waitUntil`-safe try/catches so analytics
 * failures never block user-facing responses.
 *
 * Unlike the Express version, the Hono worker does not support the inline
 * grading mode (`GRADING_QUEUE_MODE=inline`) — Workers have no
 * `setImmediate` / `runGradingJob` equivalent. The Express fallback
 * handles any legacy deployments that still need inline grading; the
 * worker always publishes to Cloudflare Queues.
 */
const worksheetProcessing = new Hono<AppBindings>();

worksheetProcessing.use('*', authenticate);

const requireAuthoringRole = authorize([UserRole.TEACHER, UserRole.ADMIN, UserRole.SUPERADMIN]);

// ---------- Helpers (route-private) ----------

async function toUploadFileResponse(
  env: WorkerEnv,
  image: {
    id: string;
    pageNumber: number;
    mimeType: string;
    fileSize: number | null;
    originalName: string | null;
    s3Key: string;
    imageUrl: string;
    uploadedAt: Date | null;
  }
): Promise<{
  imageId: string;
  pageNumber: number;
  mimeType: string;
  fileSize: number | null;
  originalName: string | null;
  s3Key: string;
  imageUrl: string;
  uploadedAt: string | null;
  uploadUrl: string | null;
  expiresAt: string | null;
}> {
  const alreadyUploaded = image.uploadedAt !== null;
  return {
    imageId: image.id,
    pageNumber: image.pageNumber,
    mimeType: image.mimeType,
    fileSize: image.fileSize,
    originalName: image.originalName,
    s3Key: image.s3Key,
    imageUrl: image.imageUrl,
    uploadedAt: image.uploadedAt?.toISOString() || null,
    uploadUrl: alreadyUploaded
      ? null
      : await createPresignedPutUrl(
          env,
          image.s3Key,
          image.mimeType,
          DIRECT_UPLOAD_URL_TTL_SECONDS
        ),
    expiresAt: alreadyUploaded
      ? null
      : new Date(Date.now() + DIRECT_UPLOAD_URL_TTL_SECONDS * 1000).toISOString(),
  };
}

interface LoadedBatch {
  id: string;
  classId: string;
  submittedOn: Date;
  status: WorksheetUploadBatchStatus;
  finalizedAt: Date | null;
  teacherId: string;
  items: Array<{
    id: string;
    studentId: string;
    studentName: string;
    tokenNo: string | null;
    worksheetNumber: number;
    worksheetName: string | null;
    isRepeated: boolean;
    status: WorksheetUploadItemStatus;
    jobId: string | null;
    errorMessage: string | null;
    images: Array<{
      id: string;
      pageNumber: number;
      mimeType: string;
      fileSize: number | null;
      originalName: string | null;
      s3Key: string;
      imageUrl: string;
      uploadedAt: Date | null;
    }>;
  }>;
}

async function loadUploadBatchForUser(
  prisma: PrismaClient,
  user: { userId: string; role: UserRole },
  batchId: string
): Promise<LoadedBatch | null> {
  const batch = await prisma.worksheetUploadBatch.findUnique({
    where: { id: batchId },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        include: { images: { orderBy: { pageNumber: 'asc' } } },
      },
    },
  });
  if (!batch) return null;
  // Teachers can only access their own batches; ADMIN/SUPERADMIN see all.
  if (user.role === 'TEACHER' && batch.teacherId !== user.userId) return null;
  return batch as unknown as LoadedBatch;
}

async function serializeUploadBatch(env: WorkerEnv, batch: LoadedBatch) {
  return {
    batchId: batch.id,
    classId: batch.classId,
    submittedOn: batch.submittedOn.toISOString(),
    status: batch.status,
    finalizedAt: batch.finalizedAt?.toISOString() || null,
    items: await Promise.all(
      batch.items.map(async (item) => ({
        itemId: item.id,
        studentId: item.studentId,
        studentName: item.studentName,
        tokenNo: item.tokenNo,
        worksheetNumber: item.worksheetNumber,
        worksheetName: item.worksheetName,
        isRepeated: item.isRepeated,
        status: item.status,
        jobId: item.jobId,
        errorMessage: item.errorMessage,
        files: await Promise.all(
          item.images.map((image) => toUploadFileResponse(env, image))
        ),
      }))
    ),
  };
}

/**
 * Dispatch a grading job by publishing a message to CF Queues. On success
 * stamps `enqueuedAt` on the job row. On failure, records `dispatchError`
 * so the dispatch loop picks it up on the next pass. Errors are never
 * rethrown — the caller moves on to the next item in the batch.
 */
async function dispatchJob(
  prisma: PrismaClient,
  env: WorkerEnv,
  jobId: string
): Promise<{ dispatchState: 'DISPATCHED' | 'PENDING_DISPATCH'; queuedAt?: string }> {
  await capturePosthogEvent(env, 'dispatch_attempt', jobId, {
    jobId,
    queueMode: 'cloudflare',
  });

  const queuedAt = new Date().toISOString();
  try {
    await publishToQueue(env, 'CF_QUEUE_ID', {
      jobId,
      enqueuedAt: queuedAt,
      version: 1,
    });
    await prisma.gradingJob.update({
      where: { id: jobId },
      data: { enqueuedAt: new Date(queuedAt), dispatchError: null },
    });
    await capturePosthogEvent(env, 'dispatch_succeeded', jobId, {
      jobId,
      queueMode: 'cloudflare',
      dispatchState: 'DISPATCHED',
      queuedAt,
    });
    return { dispatchState: 'DISPATCHED', queuedAt };
  } catch (error) {
    const dispatchError =
      error instanceof QueueError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
        ? error.message
        : 'Queue publish failed';
    await prisma.gradingJob
      .update({
        where: { id: jobId },
        data: { dispatchError, lastErrorAt: new Date() },
      })
      .catch(() => {
        /* best effort */
      });
    console.error('[grading-dispatch]', error, { jobId });
    await capturePosthogException(env, error, {
      distinctId: jobId,
      stage: 'grading_dispatch',
      extra: { jobId },
    });
    await capturePosthogEvent(env, 'dispatch_failed', jobId, {
      jobId,
      queueMode: 'cloudflare',
      dispatchState: 'PENDING_DISPATCH',
      error: dispatchError,
    });
    return { dispatchState: 'PENDING_DISPATCH' };
  }
}

/**
 * Atomically claim an `UploadItem` (PENDING → QUEUED), create the
 * `GradingJob` + `GradingJobImage` rows, and link the item to the job.
 * Returns `created: false` when another caller already claimed the item
 * so callers know not to re-dispatch. Mirrors the Express transaction.
 */
async function createGradingJobFromUploadItem(
  prisma: PrismaClient,
  itemId: string
): Promise<{
  itemId: string;
  studentId: string;
  worksheetNumber: number;
  jobId: string | null;
  created: boolean;
  error?: string;
}> {
  return prisma.$transaction(async (tx) => {
    const claimed = await tx.worksheetUploadItem.updateMany({
      where: { id: itemId, status: WorksheetUploadItemStatus.PENDING },
      data: {
        status: WorksheetUploadItemStatus.QUEUED,
        errorMessage: null,
      },
    });

    const item = await tx.worksheetUploadItem.findUnique({
      where: { id: itemId },
      include: {
        batch: true,
        images: { orderBy: { pageNumber: 'asc' } },
      },
    });
    if (!item) throw new Error(`Upload item not found: ${itemId}`);

    if (claimed.count === 0) {
      return {
        itemId: item.id,
        studentId: item.studentId,
        worksheetNumber: item.worksheetNumber,
        jobId: item.jobId,
        created: false,
        error: item.errorMessage || undefined,
      };
    }

    if (!item.images.length || item.images.some((img) => !img.uploadedAt)) {
      throw new Error('Upload item is missing one or more uploaded images');
    }

    const job = await tx.gradingJob.create({
      data: {
        studentId: item.studentId,
        studentName: item.studentName,
        worksheetNumber: item.worksheetNumber,
        worksheetName: item.worksheetName || String(item.worksheetNumber),
        tokenNo: item.tokenNo,
        classId: item.batch.classId,
        teacherId: item.batch.teacherId,
        status: GradingJobStatus.QUEUED,
        submittedOn: item.batch.submittedOn,
        isRepeated: item.isRepeated,
      },
      select: { id: true },
    });

    await tx.gradingJobImage.createMany({
      data: item.images.map((image) => ({
        gradingJobId: job.id,
        storageProvider: image.storageProvider,
        imageUrl: image.imageUrl,
        s3Key: image.s3Key,
        pageNumber: image.pageNumber,
        mimeType: image.mimeType,
      })),
    });

    await tx.worksheetUploadItem.update({
      where: { id: item.id },
      data: { jobId: job.id, errorMessage: null },
    });

    return {
      itemId: item.id,
      studentId: item.studentId,
      worksheetNumber: item.worksheetNumber,
      jobId: job.id,
      created: true,
    };
  });
}

// ---------- POST /upload-session ----------

worksheetProcessing.post('/upload-session', requireAuthoringRole, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);
  const user = c.get('user')!;
  const teacherId = user.userId;

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'Request body must be JSON' }, 400);
  }

  try {
    const classId = requireString(body.classId, 'classId');
    const submittedOn = parseSubmittedOn(body.submittedOn);
    const items = normalizeDirectUploadItems(body.worksheets);

    await assertDirectUploadAccess(
      prisma,
      user,
      classId,
      items.map((i) => i.studentId)
    );

    const created = await prisma.$transaction(async (tx) => {
      const batch = await tx.worksheetUploadBatch.create({
        data: {
          classId,
          teacherId,
          submittedOn,
          status: WorksheetUploadBatchStatus.UPLOADING,
        },
        select: {
          id: true,
          classId: true,
          submittedOn: true,
          status: true,
          finalizedAt: true,
          teacherId: true,
        },
      });

      const uploadItems = [] as LoadedBatch['items'];

      for (const itemInput of items) {
        const item = await tx.worksheetUploadItem.create({
          data: {
            batchId: batch.id,
            studentId: itemInput.studentId,
            studentName: itemInput.studentName,
            tokenNo: itemInput.tokenNo,
            worksheetNumber: itemInput.worksheetNumber,
            worksheetName: itemInput.worksheetName,
            isRepeated: itemInput.isRepeated,
            status: WorksheetUploadItemStatus.PENDING,
          },
          select: {
            id: true,
            studentId: true,
            studentName: true,
            tokenNo: true,
            worksheetNumber: true,
            worksheetName: true,
            isRepeated: true,
            status: true,
            jobId: true,
            errorMessage: true,
          },
        });

        const images: LoadedBatch['items'][number]['images'] = [];
        for (const file of itemInput.files) {
          const key = buildDirectUploadKey(
            teacherId,
            classId,
            submittedOn,
            batch.id,
            itemInput,
            file,
            crypto.randomUUID()
          );
          const resolvedUrl =
            publicObjectUrl(c.env ?? {}, key) ?? `r2://${key}`;
          const image = await tx.worksheetUploadImage.create({
            data: {
              itemId: item.id,
              storageProvider: StorageProvider.R2,
              imageUrl: resolvedUrl,
              s3Key: key,
              pageNumber: file.pageNumber,
              mimeType: file.mimeType,
              fileSize: file.fileSize ?? null,
              originalName: file.fileName,
            },
            select: {
              id: true,
              pageNumber: true,
              mimeType: true,
              fileSize: true,
              originalName: true,
              s3Key: true,
              imageUrl: true,
              uploadedAt: true,
            },
          });
          images.push({ ...image, storageProvider: StorageProvider.R2 } as never);
        }

        uploadItems.push({ ...item, images } as never);
      }

      return { ...batch, items: uploadItems };
    });

    await capturePosthogEvent(
      c.env ?? {},
      'direct_upload_session_created',
      created.id,
      {
        batchId: created.id,
        classId,
        teacherId,
        submittedOn: submittedOn.toISOString(),
        worksheetsCount: items.length,
        filesCount: items.reduce((total, it) => total + it.files.length, 0),
      }
    );

    let serialized;
    try {
      serialized = await serializeUploadBatch(c.env ?? {}, created);
    } catch (presignErr) {
      await capturePosthogEvent(c.env ?? {}, 'direct_upload_presign_failed', created.id, {
        batchId: created.id,
        classId,
        teacherId,
        keysRequested: items.reduce((total, it) => total + it.files.length, 0),
        errorName: presignErr instanceof Error ? presignErr.name : 'UnknownError',
        errorMessage:
          presignErr instanceof Error ? presignErr.message : String(presignErr),
      });
      throw presignErr;
    }

    return c.json({ success: true, ...serialized }, 201);
  } catch (error) {
    const statusCode = error instanceof ValidationError ? error.statusCode : 500;
    const message = error instanceof Error ? error.message : 'Failed to create upload session';
    console.error('[direct-upload-session]', error, {
      classId: typeof body.classId === 'string' ? body.classId : undefined,
      teacherId,
    });
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: teacherId,
      stage: 'direct_upload_session_create',
      extra: { classId: typeof body.classId === 'string' ? body.classId : undefined },
    });
    return c.json(
      {
        success: false,
        error: statusCode === 500 ? 'Failed to create upload session' : message,
      },
      statusCode as 400 | 500
    );
  }
});

// ---------- GET /upload-session/:batchId ----------

worksheetProcessing.get('/upload-session/:batchId', requireAuthoringRole, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);
  const user = c.get('user')!;
  const batchId = c.req.param('batchId');

  const batch = await loadUploadBatchForUser(prisma, user, batchId);
  if (!batch) {
    return c.json({ success: false, error: 'Upload session not found' }, 404);
  }
  const serialized = await serializeUploadBatch(c.env ?? {}, batch);
  return c.json({ success: true, ...serialized }, 200);
});

// ---------- POST /upload-session/:batchId/finalize ----------

worksheetProcessing.post(
  '/upload-session/:batchId/finalize',
  requireAuthoringRole,
  async (c) => {
    const prisma = c.get('prisma');
    if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);
    const user = c.get('user')!;
    const batchId = c.req.param('batchId');

    try {
      const batch = await loadUploadBatchForUser(prisma, user, batchId);
      if (!batch) {
        return c.json({ success: false, error: 'Upload session not found' }, 404);
      }

      let body: Record<string, unknown> = {};
      try {
        body = await c.req.json();
      } catch {
        // body is optional
      }
      const requestedUploadedIds: string[] = Array.isArray(body.uploadedImageIds)
        ? body.uploadedImageIds.filter((id): id is string => typeof id === 'string')
        : [];
      const issuedImageIds = new Set(
        batch.items.flatMap((item) => item.images.map((image) => image.id))
      );
      const uploadedImageIds = requestedUploadedIds.filter((id) => issuedImageIds.has(id));

      if (uploadedImageIds.length > 0) {
        await prisma.worksheetUploadImage.updateMany({
          where: { id: { in: uploadedImageIds } },
          data: { uploadedAt: new Date() },
        });
      }

      const refreshedBatch = await loadUploadBatchForUser(prisma, user, batch.id);
      if (!refreshedBatch) {
        return c.json({ success: false, error: 'Upload session not found' }, 404);
      }

      const queued: Array<{
        itemId: string;
        studentId: string;
        worksheetNumber: number;
        jobId: string;
        dispatchState: 'DISPATCHED' | 'PENDING_DISPATCH';
        queuedAt?: string;
      }> = [];
      const pending: Array<{
        itemId: string;
        studentId: string;
        worksheetNumber: number;
        missingImageIds: string[];
      }> = [];
      const failed: Array<{
        itemId: string;
        studentId: string;
        worksheetNumber: number;
        error: string;
      }> = [];

      for (const item of refreshedBatch.items) {
        if (item.status === WorksheetUploadItemStatus.QUEUED && item.jobId) {
          queued.push({
            itemId: item.id,
            studentId: item.studentId,
            worksheetNumber: item.worksheetNumber,
            jobId: item.jobId,
            dispatchState: 'DISPATCHED',
          });
          continue;
        }

        if (item.status === WorksheetUploadItemStatus.FAILED) {
          failed.push({
            itemId: item.id,
            studentId: item.studentId,
            worksheetNumber: item.worksheetNumber,
            error: item.errorMessage || 'Upload item failed',
          });
          continue;
        }

        const missingImageIds = item.images
          .filter((image) => !image.uploadedAt)
          .map((image) => image.id);
        if (missingImageIds.length > 0) {
          pending.push({
            itemId: item.id,
            studentId: item.studentId,
            worksheetNumber: item.worksheetNumber,
            missingImageIds,
          });
          continue;
        }

        try {
          const jobResult = await createGradingJobFromUploadItem(prisma, item.id);
          if (!jobResult.jobId) {
            failed.push({
              itemId: item.id,
              studentId: item.studentId,
              worksheetNumber: item.worksheetNumber,
              error: jobResult.error || 'Unable to create grading job',
            });
            continue;
          }
          const dispatchResult = jobResult.created
            ? await dispatchJob(prisma, c.env ?? {}, jobResult.jobId)
            : { dispatchState: 'DISPATCHED' as const };
          queued.push({
            itemId: item.id,
            studentId: item.studentId,
            worksheetNumber: item.worksheetNumber,
            jobId: jobResult.jobId,
            dispatchState: dispatchResult.dispatchState,
            queuedAt:
              'queuedAt' in dispatchResult ? dispatchResult.queuedAt : undefined,
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Failed to create grading job';
          failed.push({
            itemId: item.id,
            studentId: item.studentId,
            worksheetNumber: item.worksheetNumber,
            error: message,
          });
          await prisma.worksheetUploadItem
            .update({
              where: { id: item.id },
              data: {
                status: WorksheetUploadItemStatus.FAILED,
                errorMessage: message,
              },
            })
            .catch(() => {
              /* best effort */
            });
        }
      }

      const stillPending = await prisma.worksheetUploadItem.count({
        where: {
          batchId: batch.id,
          status: WorksheetUploadItemStatus.PENDING,
        },
      });
      if (stillPending === 0) {
        await prisma.worksheetUploadBatch.update({
          where: { id: batch.id },
          data: {
            status: WorksheetUploadBatchStatus.FINALIZED,
            finalizedAt: new Date(),
          },
        });
      }

      await capturePosthogEvent(c.env ?? {}, 'direct_upload_session_finalized', batch.id, {
        batchId: batch.id,
        queuedCount: queued.length,
        pendingCount: pending.length,
        failedCount: failed.length,
      });

      return c.json(
        {
          success: true,
          batchId: batch.id,
          status:
            stillPending === 0
              ? WorksheetUploadBatchStatus.FINALIZED
              : WorksheetUploadBatchStatus.UPLOADING,
          queued,
          pending,
          failed,
        },
        200
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to finalize upload session';
      console.error('[direct-upload-finalize]', error, {
        batchId,
        teacherId: user.userId,
      });
      await capturePosthogException(c.env ?? {}, error, {
        distinctId: user.userId,
        stage: 'direct_upload_session_finalize',
        extra: { batchId },
      });
      return c.json({ success: false, error: 'Failed to finalize upload session' }, 500);
    }
  }
);

// ---------- POST /process ----------

/**
 * `POST /api/worksheet-processing/process` — multipart image upload that
 * creates a `GradingJob`, stores images in R2, then dispatches via the CF
 * Queues publisher. The Express version also supports an `inline` queue
 * mode that runs grading in-process via `setImmediate`; the Workers
 * runtime cannot support that, so this route requires
 * `GRADING_QUEUE_MODE=cloudflare` (the production default).
 *
 * Field names match the Express handler for bug-compat with the mobile
 * client:
 *   `files` (multipart) up to 10 image files, 50 MB each
 *   `token_no`, `worksheet_name`, `classId`, `studentId`, `studentName`,
 *   `worksheetNumber`, `submittedOn`, `isRepeated` (form fields)
 */
worksheetProcessing.post('/process', requireAuthoringRole, async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ success: false, error: 'Database is not available' }, 500);
  const user = c.get('user')!;
  const submittedById = user.userId;

  // Parse multipart body: image-only, 50 MB per file, up to 10 files.
  let parsed;
  try {
    parsed = await parseMultipartFiles(c.req.raw, {
      fieldName: 'files',
      maxCount: 10,
      maxFileSizeBytes: 50 * 1024 * 1024,
      fileFilter: imageOnlyFilter,
      requireAtLeastOne: false,
    });
  } catch (err) {
    if (err instanceof UploadError) {
      await capturePosthogEvent(
        c.env ?? {},
        'image_upload_rejected',
        submittedById,
        { reason: err.code, path: '/api/worksheet-processing/process' }
      );
      return c.json({ success: false, error: err.message }, 400);
    }
    throw err;
  }

  const { files, fields } = parsed;
  const tokenNo = fields.token_no;
  const worksheetName = fields.worksheet_name;
  const classId = fields.classId;
  const studentId = fields.studentId;
  const studentNameField = fields.studentName;
  const worksheetNumberRaw = fields.worksheetNumber;
  const submittedOnField = fields.submittedOn;
  const isRepeatedField = fields.isRepeated;

  if (!tokenNo || !worksheetName || files.length === 0) {
    await capturePosthogEvent(
      c.env ?? {},
      'request_rejected_validation',
      submittedById,
      {
        reason: 'missing_required_fields_token_or_worksheet_or_files',
        filesCount: files.length,
      }
    );
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }
  if (!classId || !studentId || !worksheetNumberRaw) {
    await capturePosthogEvent(
      c.env ?? {},
      'request_rejected_validation',
      submittedById,
      {
        reason: 'missing_required_fields_job_metadata',
        hasClassId: Boolean(classId),
        hasStudentId: Boolean(studentId),
        hasWorksheetNumber: Boolean(worksheetNumberRaw),
      }
    );
    return c.json({ success: false, error: 'Missing required fields' }, 400);
  }

  await capturePosthogEvent(c.env ?? {}, 'request_received', submittedById, {
    tokenNo,
    worksheetName,
    worksheetNumber: worksheetNumberRaw,
    studentId,
    classId,
    filesCount: files.length,
    queueMode: 'cloudflare',
  });

  let jobId: string | null = null;

  try {
    const resolvedStudentName =
      studentNameField ||
      (
        await prisma.user.findUnique({
          where: { id: studentId },
          select: { name: true },
        })
      )?.name ||
      'Unknown';

    const parsedIsRepeated = isRepeatedField === 'true';
    const parsedSubmittedOn = submittedOnField ? new Date(submittedOnField) : new Date();

    const job = await prisma.gradingJob.create({
      data: {
        studentId,
        studentName: resolvedStudentName,
        worksheetNumber: Number.parseInt(worksheetNumberRaw, 10),
        worksheetName,
        tokenNo,
        classId,
        teacherId: submittedById,
        status: GradingJobStatus.QUEUED,
        submittedOn: parsedSubmittedOn,
        isRepeated: parsedIsRepeated,
      },
      select: { id: true },
    });
    jobId = job.id;

    await capturePosthogEvent(c.env ?? {}, 'job_created', job.id, {
      jobId: job.id,
      studentId,
      classId,
      teacherId: submittedById,
      worksheetNumber: worksheetNumberRaw,
      worksheetName,
      queueMode: 'cloudflare',
    });

    // Upload each file to R2 and create a GradingJobImage row.
    // Uses the same key layout as legacy uploads for bucket-policy compat.
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const pageNumber = i + 1;
      const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
      const key = `worksheets/${job.id}/${Date.now()}-page${pageNumber}-${safeName}`;
      const { publicUrl } = await uploadObject(
        c.env ?? {},
        key,
        file.buffer,
        file.mimetype
      );
      await prisma.gradingJobImage.create({
        data: {
          gradingJobId: job.id,
          storageProvider: 'R2',
          imageUrl: publicUrl ?? `r2://${key}`,
          s3Key: key,
          pageNumber,
          mimeType: file.mimetype,
        },
      });
    }

    await capturePosthogEvent(c.env ?? {}, 'images_stored', job.id, {
      jobId: job.id,
      filesCount: files.length,
      totalBytes: files.reduce((acc, file) => acc + file.size, 0),
      storageProvider: 'R2',
    });

    const dispatchResult = await dispatchJob(prisma, c.env ?? {}, job.id);

    await capturePosthogEvent(c.env ?? {}, 'request_accepted', job.id, {
      jobId: job.id,
      dispatchState: dispatchResult.dispatchState,
      queuedAt: dispatchResult.queuedAt,
      status: 'queued',
    });

    return c.json(
      {
        success: true,
        jobId: job.id,
        status: 'queued',
        queuedAt: dispatchResult.queuedAt,
        dispatchState: dispatchResult.dispatchState,
        message:
          dispatchResult.dispatchState === 'DISPATCHED'
            ? 'Job queued'
            : 'Job created but dispatch pending; it will be retried automatically',
      },
      202
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    if (jobId) {
      await prisma.gradingJob
        .update({
          where: { id: jobId },
          data: {
            status: GradingJobStatus.FAILED,
            errorMessage,
            lastErrorAt: new Date(),
            completedAt: new Date(),
          },
        })
        .catch(() => {
          /* best effort */
        });
    }
    console.error('[grading-request]', error, {
      jobId,
      studentId,
      classId,
      worksheetNumber: worksheetNumberRaw,
    });
    await capturePosthogException(c.env ?? {}, error, {
      distinctId: jobId ?? submittedById,
      stage: 'grading_request',
      extra: { jobId, studentId, classId, worksheetNumber: worksheetNumberRaw },
    });
    return c.json({ success: false, error: 'Failed to queue grading job' }, 500);
  }
});

export default worksheetProcessing;

/**
 * Exported only for testing — lets tests reach into the handlers without
 * spinning up a full Hono request.
 */
export const __internal = {
  toUploadFileResponse,
  serializeUploadBatch,
  loadUploadBatchForUser,
  dispatchJob,
  createGradingJobFromUploadItem,
};
