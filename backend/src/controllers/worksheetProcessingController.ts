import { Request, Response } from 'express';
import { randomUUID } from 'crypto';
import {
    GradingJobStatus,
    StorageProvider,
    UserRole,
    WorksheetUploadBatchStatus,
    WorksheetUploadItemStatus
} from '@prisma/client';
import prisma from '../utils/prisma';
import { getPresignedUrl, getPublicObjectUrl, uploadToS3 } from '../services/s3Service';
import config from '../config/env';
import { aiGradingLogger } from '../services/logger';
import { logError } from '../services/errorLogService';
import { captureGradingPipelineEvent } from '../services/posthogService';
import {
    createGradingQueueMessage,
    getGradingQueueClient
} from '../services/queue/gradingQueue';
import { runGradingJob } from '../services/gradingJobRunner';

interface MulterFile extends Express.Multer.File {}

type DispatchState = 'DISPATCHED' | 'PENDING_DISPATCH';

const DIRECT_UPLOAD_URL_TTL_SECONDS = 15 * 60;
const MAX_DIRECT_UPLOAD_ITEMS = 80;
const MAX_DIRECT_UPLOAD_FILES_PER_ITEM = 10;
const MAX_DIRECT_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;

class ValidationError extends Error {
    statusCode = 400;
}

interface DirectUploadFileInput {
    pageNumber: number;
    fileName: string;
    mimeType: string;
    fileSize?: number;
}

interface DirectUploadWorksheetInput {
    studentId: string;
    studentName: string;
    tokenNo?: string;
    worksheetNumber: number;
    worksheetName: string;
    isRepeated: boolean;
    files: DirectUploadFileInput[];
}

function parseBoolean(value: unknown): boolean {
    if (typeof value === 'boolean') {
        return value;
    }

    if (typeof value === 'string') {
        return value.toLowerCase() === 'true';
    }

    return false;
}

function sanitizeFilename(filename: string): string {
    return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        throw new ValidationError(`${fieldName} must be a positive integer`);
    }

    return parsed;
}

function parseSubmittedOn(value: unknown): Date {
    const date = value ? new Date(String(value)) : new Date();
    if (Number.isNaN(date.getTime())) {
        throw new ValidationError('submittedOn must be a valid date');
    }

    date.setUTCHours(0, 0, 0, 0);
    return date;
}

function requireString(value: unknown, fieldName: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new ValidationError(`${fieldName} is required`);
    }

    return value.trim();
}

function optionalString(value: unknown): string | undefined {
    return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function getExtension(fileName: string, mimeType: string): string {
    const sanitized = sanitizeFilename(fileName);
    const extension = sanitized.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0];
    if (extension) {
        return extension.toLowerCase();
    }

    if (mimeType === 'image/png') {
        return '.png';
    }

    if (mimeType === 'image/webp') {
        return '.webp';
    }

    return '.jpg';
}

function buildDirectUploadKey(
    teacherId: string,
    classId: string,
    submittedOn: Date,
    batchId: string,
    item: DirectUploadWorksheetInput,
    file: DirectUploadFileInput
): string {
    const submittedDate = submittedOn.toISOString().slice(0, 10);
    const extension = getExtension(file.fileName, file.mimeType);
    return [
        'worksheet-uploads',
        teacherId,
        classId,
        submittedDate,
        batchId,
        item.studentId,
        `worksheet-${item.worksheetNumber}-page-${file.pageNumber}-${randomUUID()}${extension}`
    ].join('/');
}

function normalizeDirectUploadItems(value: unknown): DirectUploadWorksheetInput[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw new ValidationError('worksheets must include at least one worksheet');
    }

    if (value.length > MAX_DIRECT_UPLOAD_ITEMS) {
        throw new ValidationError(`A batch can include at most ${MAX_DIRECT_UPLOAD_ITEMS} worksheets`);
    }

    const seenWorksheetKeys = new Set<string>();

    return value.map((raw, index) => {
        if (!raw || typeof raw !== 'object') {
            throw new ValidationError(`worksheets[${index}] must be an object`);
        }

        const record = raw as Record<string, unknown>;
        const studentId = requireString(record.studentId, `worksheets[${index}].studentId`);
        const worksheetNumber = parsePositiveInteger(record.worksheetNumber, `worksheets[${index}].worksheetNumber`);
        const studentName = optionalString(record.studentName) || 'Unknown';
        const tokenNo = optionalString(record.tokenNo);
        const worksheetName = optionalString(record.worksheetName) || String(worksheetNumber);
        const filesRaw = record.files;

        if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
            throw new ValidationError(`worksheets[${index}].files must include at least one image`);
        }

        if (filesRaw.length > MAX_DIRECT_UPLOAD_FILES_PER_ITEM) {
            throw new ValidationError(
                `worksheets[${index}].files can include at most ${MAX_DIRECT_UPLOAD_FILES_PER_ITEM} images`
            );
        }

        const worksheetKey = `${studentId}:${worksheetNumber}`;
        if (seenWorksheetKeys.has(worksheetKey)) {
            throw new ValidationError(`Duplicate worksheet ${worksheetNumber} for student ${studentId} in this batch`);
        }
        seenWorksheetKeys.add(worksheetKey);

        const seenPages = new Set<number>();
        const files = filesRaw.map((fileRaw, fileIndex) => {
            if (!fileRaw || typeof fileRaw !== 'object') {
                throw new ValidationError(`worksheets[${index}].files[${fileIndex}] must be an object`);
            }

            const fileRecord = fileRaw as Record<string, unknown>;
            const pageNumber = parsePositiveInteger(
                fileRecord.pageNumber ?? fileIndex + 1,
                `worksheets[${index}].files[${fileIndex}].pageNumber`
            );
            const mimeType = requireString(fileRecord.mimeType, `worksheets[${index}].files[${fileIndex}].mimeType`);
            const fileName = optionalString(fileRecord.fileName) || `page-${pageNumber}.jpg`;
            const fileSize =
                fileRecord.fileSize === undefined || fileRecord.fileSize === null
                    ? undefined
                    : parsePositiveInteger(fileRecord.fileSize, `worksheets[${index}].files[${fileIndex}].fileSize`);

            if (!mimeType.startsWith('image/')) {
                throw new ValidationError(`worksheets[${index}].files[${fileIndex}] must be an image`);
            }

            if (fileSize && fileSize > MAX_DIRECT_UPLOAD_FILE_BYTES) {
                throw new ValidationError(
                    `worksheets[${index}].files[${fileIndex}] exceeds the ${MAX_DIRECT_UPLOAD_FILE_BYTES} byte limit`
                );
            }

            if (seenPages.has(pageNumber)) {
                throw new ValidationError(`Duplicate page ${pageNumber} for worksheet ${worksheetNumber}`);
            }
            seenPages.add(pageNumber);

            return {
                pageNumber,
                fileName,
                mimeType,
                fileSize
            };
        });

        return {
            studentId,
            studentName,
            tokenNo,
            worksheetNumber,
            worksheetName,
            isRepeated: parseBoolean(record.isRepeated),
            files
        };
    });
}

async function assertDirectUploadAccess(req: Request, classId: string, studentIds: string[]): Promise<void> {
    if (!req.user) {
        throw new ValidationError('Authentication required');
    }

    const requesterId = req.user.userId;

    if (req.user.role === UserRole.STUDENT) {
        captureGradingPipelineEvent('request_rejected_ownership', requesterId, {
            reason: 'student_role',
            classId,
            role: req.user.role
        });
        throw new ValidationError('Students cannot create grading upload sessions');
    }

    if (req.user.role === UserRole.TEACHER) {
        const teacherClass = await prisma.teacherClass.findUnique({
            where: {
                teacherId_classId: {
                    teacherId: requesterId,
                    classId
                }
            },
            select: { teacherId: true }
        });

        if (!teacherClass) {
            captureGradingPipelineEvent('request_rejected_ownership', requesterId, {
                reason: 'teacher_not_assigned_to_class',
                classId,
                role: req.user.role
            });
            throw new ValidationError('Teacher is not assigned to this class');
        }
    }

    const uniqueStudentIds = Array.from(new Set(studentIds));
    const studentClasses = await prisma.studentClass.findMany({
        where: {
            classId,
            studentId: { in: uniqueStudentIds }
        },
        select: { studentId: true }
    });

    const validStudentIds = new Set(studentClasses.map((studentClass) => studentClass.studentId));
    const missingStudentIds = uniqueStudentIds.filter((studentId) => !validStudentIds.has(studentId));
    if (missingStudentIds.length > 0) {
        captureGradingPipelineEvent('request_rejected_ownership', requesterId, {
            reason: 'students_not_in_class',
            classId,
            role: req.user.role,
            missingStudentCount: missingStudentIds.length
        });
        throw new ValidationError(`Some students are not assigned to this class: ${missingStudentIds.join(', ')}`);
    }
}

function parsePageNumber(req: Request, index: number): number {
    const pageNumbers = req.body.pageNumbers;

    if (Array.isArray(pageNumbers) && pageNumbers[index] !== undefined) {
        const parsed = Number.parseInt(String(pageNumbers[index]), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : index + 1;
    }

    return index + 1;
}

async function storeJobImages(jobId: string, files: MulterFile[], req: Request): Promise<void> {
    await Promise.all(
        files.map(async (file, index) => {
            const pageNumber = parsePageNumber(req, index);
            // Match the legacy upload key layout to maximize compatibility with existing S3 bucket policies.
            const key = `worksheets/${jobId}/${Date.now()}-page${pageNumber}-${sanitizeFilename(file.originalname)}`;
            const imageUrl = await uploadToS3(file.buffer, key, file.mimetype);

            await prisma.gradingJobImage.create({
                data: {
                    gradingJobId: jobId,
                    storageProvider: config.objectStorage.provider === 'r2' ? 'R2' : 'S3',
                    imageUrl,
                    s3Key: key,
                    pageNumber,
                    mimeType: file.mimetype
                }
            });
        })
    );
}

async function dispatchJob(jobId: string): Promise<{ dispatchState: DispatchState; queuedAt?: string }> {
    captureGradingPipelineEvent('dispatch_attempt', jobId, {
        jobId,
        queueMode: config.grading.queueMode
    });

    if (config.grading.queueMode === 'cloudflare') {
        try {
            const queueClient = getGradingQueueClient();
            const queueMessage = createGradingQueueMessage(jobId);
            await queueClient.publish(queueMessage);
            await prisma.gradingJob.update({
                where: { id: jobId },
                data: {
                    enqueuedAt: new Date(queueMessage.enqueuedAt),
                    dispatchError: null
                }
            });

            captureGradingPipelineEvent('dispatch_succeeded', jobId, {
                jobId,
                queueMode: config.grading.queueMode,
                dispatchState: 'DISPATCHED',
                queuedAt: queueMessage.enqueuedAt
            });

            return {
                dispatchState: 'DISPATCHED',
                queuedAt: queueMessage.enqueuedAt
            };
        } catch (error) {
            const dispatchError = error instanceof Error ? error.message : 'Queue publish failed';

            await prisma.gradingJob.update({
                where: { id: jobId },
                data: {
                    dispatchError,
                    lastErrorAt: new Date()
                }
            });

            await logError('grading-dispatch', error instanceof Error ? error : new Error(dispatchError), {
                jobId
            }).catch(() => {
                // best effort
            });

            captureGradingPipelineEvent('dispatch_failed', jobId, {
                jobId,
                queueMode: config.grading.queueMode,
                dispatchState: 'PENDING_DISPATCH',
                error: dispatchError
            });

            return {
                dispatchState: 'PENDING_DISPATCH'
            };
        }
    }

    const queuedAt = new Date().toISOString();
    await prisma.gradingJob.update({
        where: { id: jobId },
        data: {
            enqueuedAt: new Date(queuedAt),
            dispatchError: null
        }
    });

    captureGradingPipelineEvent('dispatch_succeeded', jobId, {
        jobId,
        queueMode: config.grading.queueMode,
        dispatchState: 'DISPATCHED',
        queuedAt
    });

    setImmediate(() => {
        void runGradingJob(jobId);
    });

    return {
        dispatchState: 'DISPATCHED',
        queuedAt
    };
}

function toUploadFileResponse(image: {
    id: string;
    pageNumber: number;
    mimeType: string;
    fileSize: number | null;
    originalName: string | null;
    s3Key: string;
    imageUrl: string;
    uploadedAt: Date | null;
}) {
    return {
        imageId: image.id,
        pageNumber: image.pageNumber,
        mimeType: image.mimeType,
        fileSize: image.fileSize,
        originalName: image.originalName,
        s3Key: image.s3Key,
        imageUrl: image.imageUrl,
        uploadedAt: image.uploadedAt?.toISOString() || null,
        uploadUrl: image.uploadedAt
            ? null
            : getPresignedUrl(image.s3Key, image.mimeType, DIRECT_UPLOAD_URL_TTL_SECONDS, 'r2'),
        expiresAt: image.uploadedAt
            ? null
            : new Date(Date.now() + DIRECT_UPLOAD_URL_TTL_SECONDS * 1000).toISOString()
    };
}

function serializeUploadBatch(batch: {
    id: string;
    classId: string;
    submittedOn: Date;
    status: WorksheetUploadBatchStatus;
    finalizedAt: Date | null;
    items: {
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
        images: {
            id: string;
            pageNumber: number;
            mimeType: string;
            fileSize: number | null;
            originalName: string | null;
            s3Key: string;
            imageUrl: string;
            uploadedAt: Date | null;
        }[];
    }[];
}) {
    return {
        batchId: batch.id,
        classId: batch.classId,
        submittedOn: batch.submittedOn.toISOString(),
        status: batch.status,
        finalizedAt: batch.finalizedAt?.toISOString() || null,
        items: batch.items.map((item) => ({
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
            files: item.images.map(toUploadFileResponse)
        }))
    };
}

async function loadUploadBatchForUser(batchId: string, req: Request) {
    const batch = await prisma.worksheetUploadBatch.findUnique({
        where: { id: batchId },
        include: {
            items: {
                orderBy: { createdAt: 'asc' },
                include: {
                    images: {
                        orderBy: { pageNumber: 'asc' }
                    }
                }
            }
        }
    });

    if (!batch) {
        return null;
    }

    if (req.user?.role === UserRole.TEACHER && batch.teacherId !== req.user.userId) {
        return null;
    }

    return batch;
}

async function loadUploadItems(batchId: string, itemIds: string[]) {
    if (itemIds.length === 0) {
        return [];
    }

    return prisma.worksheetUploadItem.findMany({
        where: {
            batchId,
            id: { in: itemIds }
        },
        orderBy: { createdAt: 'asc' },
        include: {
            images: {
                orderBy: { pageNumber: 'asc' }
            }
        }
    });
}

async function createGradingJobFromUploadItem(itemId: string): Promise<{
    itemId: string;
    studentId: string;
    worksheetNumber: number;
    jobId: string | null;
    created: boolean;
    error?: string;
}> {
    return prisma.$transaction(async (tx) => {
        const claimed = await tx.worksheetUploadItem.updateMany({
            where: {
                id: itemId,
                status: WorksheetUploadItemStatus.PENDING
            },
            data: {
                status: WorksheetUploadItemStatus.QUEUED,
                errorMessage: null
            }
        });

        const item = await tx.worksheetUploadItem.findUnique({
            where: { id: itemId },
            include: {
                batch: true,
                images: {
                    orderBy: { pageNumber: 'asc' }
                }
            }
        });

        if (!item) {
            throw new Error(`Upload item not found: ${itemId}`);
        }

        if (claimed.count === 0) {
            return {
                itemId: item.id,
                studentId: item.studentId,
                worksheetNumber: item.worksheetNumber,
                jobId: item.jobId,
                created: false,
                error: item.errorMessage || undefined
            };
        }

        if (!item.images.length || item.images.some((image) => !image.uploadedAt)) {
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
                isRepeated: item.isRepeated
            },
            select: { id: true }
        });

        await tx.gradingJobImage.createMany({
            data: item.images.map((image) => ({
                gradingJobId: job.id,
                storageProvider: image.storageProvider,
                imageUrl: image.imageUrl,
                s3Key: image.s3Key,
                pageNumber: image.pageNumber,
                mimeType: image.mimeType
            }))
        });

        await tx.worksheetUploadItem.update({
            where: { id: item.id },
            data: {
                jobId: job.id,
                errorMessage: null
            }
        });

        return {
            itemId: item.id,
            studentId: item.studentId,
            worksheetNumber: item.worksheetNumber,
            jobId: job.id,
            created: true
        };
    });
}

/**
 * Create a direct-to-R2 upload session and return short-lived signed PUT URLs.
 * @route POST /api/worksheet-processing/upload-session
 */
export const createDirectUploadSession = async (req: Request, res: Response) => {
    try {
        const teacherId = req.user?.userId;
        if (!teacherId) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }

        const classId = requireString(req.body.classId, 'classId');
        const submittedOn = parseSubmittedOn(req.body.submittedOn);
        const items = normalizeDirectUploadItems(req.body.worksheets);

        await assertDirectUploadAccess(req, classId, items.map((item) => item.studentId));

        // Stale prior batches for this teacher/class/date are abandoned uploads
        // — typically duplicates from a shared login or a tab the user closed
        // mid-flight. Mark their PENDING items FAILED so the new session has a
        // clean slate; QUEUED items are real worksheets in the AI pipeline and
        // are left alone. Threshold avoids interfering with a slow upload that
        // is still genuinely in-flight from another tab.
        let supersededBatchCount = 0;
        let supersededItemCount = 0;

        const created = await prisma.$transaction(async (tx) => {
            const staleCutoff = new Date(Date.now() - config.grading.staleUploadBatchMs);
            const staleBatches = await tx.worksheetUploadBatch.findMany({
                where: {
                    teacherId,
                    classId,
                    submittedOn,
                    status: WorksheetUploadBatchStatus.UPLOADING,
                    updatedAt: { lt: staleCutoff }
                },
                select: { id: true }
            });

            for (const stale of staleBatches) {
                const supersededItems = await tx.worksheetUploadItem.updateMany({
                    where: {
                        batchId: stale.id,
                        status: WorksheetUploadItemStatus.PENDING
                    },
                    data: {
                        status: WorksheetUploadItemStatus.FAILED,
                        errorMessage: 'Superseded by new upload session'
                    }
                });
                supersededItemCount += supersededItems.count;

                const remainingPending = await tx.worksheetUploadItem.count({
                    where: {
                        batchId: stale.id,
                        status: WorksheetUploadItemStatus.PENDING
                    }
                });

                if (remainingPending === 0) {
                    await tx.worksheetUploadBatch.update({
                        where: { id: stale.id },
                        data: {
                            status: WorksheetUploadBatchStatus.FINALIZED,
                            finalizedAt: new Date()
                        }
                    });
                    supersededBatchCount += 1;
                }
            }

            const batch = await tx.worksheetUploadBatch.create({
                data: {
                    classId,
                    teacherId,
                    submittedOn,
                    status: WorksheetUploadBatchStatus.UPLOADING
                },
                select: {
                    id: true,
                    classId: true,
                    submittedOn: true,
                    status: true,
                    finalizedAt: true
                }
            });

            const uploadItems = [];

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
                        status: WorksheetUploadItemStatus.PENDING
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
                        errorMessage: true
                    }
                });

                const images = [];
                for (const file of itemInput.files) {
                    const key = buildDirectUploadKey(teacherId, classId, submittedOn, batch.id, itemInput, file);
                    const image = await tx.worksheetUploadImage.create({
                        data: {
                            itemId: item.id,
                            storageProvider: StorageProvider.R2,
                            imageUrl: getPublicObjectUrl(key, 'r2'),
                            s3Key: key,
                            pageNumber: file.pageNumber,
                            mimeType: file.mimeType,
                            fileSize: file.fileSize,
                            originalName: file.fileName
                        },
                        select: {
                            id: true,
                            pageNumber: true,
                            mimeType: true,
                            fileSize: true,
                            originalName: true,
                            s3Key: true,
                            imageUrl: true,
                            uploadedAt: true
                        }
                    });

                    images.push(image);
                }

                uploadItems.push({
                    ...item,
                    images
                });
            }

            return {
                ...batch,
                items: uploadItems
            };
        });

        captureGradingPipelineEvent('direct_upload_session_created', created.id, {
            batchId: created.id,
            classId,
            teacherId,
            submittedOn: submittedOn.toISOString(),
            worksheetsCount: items.length,
            filesCount: items.reduce((total, item) => total + item.files.length, 0)
        });

        if (supersededItemCount > 0 || supersededBatchCount > 0) {
            captureGradingPipelineEvent('direct_upload_session_superseded_prior', created.id, {
                batchId: created.id,
                classId,
                teacherId,
                supersededBatchCount,
                supersededItemCount,
                staleUploadBatchMs: config.grading.staleUploadBatchMs
            });
        }

        // serializeUploadBatch → toUploadFileResponse → getPresignedUrl can throw
        // synchronously if the R2 signing layer fails (missing/invalid creds,
        // clock skew, bad bucket config). Capture those specifically so a failed
        // upload before grading even starts is visible in PostHog.
        let serializedBatch: ReturnType<typeof serializeUploadBatch>;
        try {
            serializedBatch = serializeUploadBatch(created);
        } catch (presignErr) {
            captureGradingPipelineEvent('direct_upload_presign_failed', created.id, {
                batchId: created.id,
                classId,
                teacherId,
                keysRequested: items.reduce((total, item) => total + item.files.length, 0),
                errorName: presignErr instanceof Error ? presignErr.name : 'UnknownError',
                errorMessage: presignErr instanceof Error ? presignErr.message : String(presignErr)
            });
            throw presignErr;
        }

        return res.status(201).json({
            success: true,
            ...serializedBatch
        });
    } catch (error) {
        const statusCode = error instanceof ValidationError ? error.statusCode : 500;
        const message = error instanceof Error ? error.message : 'Failed to create upload session';

        await logError('direct-upload-session', error instanceof Error ? error : new Error(message), {
            classId: req.body?.classId,
            teacherId: req.user?.userId
        }).catch(() => {
            // best effort
        });

        return res.status(statusCode).json({
            success: false,
            error: statusCode === 500 ? 'Failed to create upload session' : message
        });
    }
};

/**
 * Fetch a direct upload session and refresh signed URLs for unfinished image slots.
 * @route GET /api/worksheet-processing/upload-session/:batchId
 */
export const getDirectUploadSession = async (req: Request, res: Response) => {
    const batch = await loadUploadBatchForUser(req.params.batchId, req);
    if (!batch) {
        return res.status(404).json({ success: false, error: 'Upload session not found' });
    }

    return res.json({
        success: true,
        ...serializeUploadBatch(batch)
    });
};

/**
 * Finalize direct uploads by creating grading jobs from issued R2 keys.
 * @route POST /api/worksheet-processing/upload-session/:batchId/finalize
 */
export const finalizeDirectUploadSession = async (req: Request, res: Response) => {
    try {
        const batch = await loadUploadBatchForUser(req.params.batchId, req);
        if (!batch) {
            return res.status(404).json({ success: false, error: 'Upload session not found' });
        }

        const requestedUploadedIds: string[] = Array.isArray(req.body?.uploadedImageIds)
            ? req.body.uploadedImageIds.filter((id: unknown): id is string => typeof id === 'string')
            : [];
        const issuedImageIds = new Set(batch.items.flatMap((item) => item.images.map((image) => image.id)));
        const uploadedImageIds = requestedUploadedIds.filter((id) => issuedImageIds.has(id));

        if (uploadedImageIds.length > 0) {
            await prisma.worksheetUploadImage.updateMany({
                where: {
                    id: { in: uploadedImageIds }
                },
                data: {
                    uploadedAt: new Date()
                }
            });
        }

        const uploadedImageIdSet = new Set(uploadedImageIds);
        const affectedItemIds = Array.from(new Set(
            batch.items
                .filter((item) => item.images.some((image) => uploadedImageIdSet.has(image.id)))
                .map((item) => item.id)
        ));
        const affectedItems = await loadUploadItems(batch.id, affectedItemIds);

        const queued = [];
        const pending = [];
        const failed = [];
        const readyItems = [];

        for (const item of affectedItems) {
            if (item.status === WorksheetUploadItemStatus.QUEUED && item.jobId) {
                queued.push({
                    itemId: item.id,
                    studentId: item.studentId,
                    worksheetNumber: item.worksheetNumber,
                    jobId: item.jobId,
                    dispatchState: 'DISPATCHED' as DispatchState
                });
                continue;
            }

            if (item.status === WorksheetUploadItemStatus.FAILED) {
                failed.push({
                    itemId: item.id,
                    studentId: item.studentId,
                    worksheetNumber: item.worksheetNumber,
                    error: item.errorMessage || 'Upload item failed'
                });
                continue;
            }

            if (item.status !== WorksheetUploadItemStatus.PENDING) {
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
                    missingImageIds
                });
                continue;
            }

            readyItems.push(item);
        }

        const readyResults = await Promise.allSettled(readyItems.map(async (item) => {
            try {
                const jobResult = await createGradingJobFromUploadItem(item.id);

                if (!jobResult.jobId) {
                    return {
                        kind: 'failed' as const,
                        itemId: item.id,
                        studentId: item.studentId,
                        worksheetNumber: item.worksheetNumber,
                        error: jobResult.error || 'Unable to create grading job'
                    };
                }

                const dispatchResult = jobResult.created
                    ? await dispatchJob(jobResult.jobId)
                    : { dispatchState: 'DISPATCHED' as DispatchState };

                return {
                    kind: 'queued' as const,
                    itemId: item.id,
                    studentId: item.studentId,
                    worksheetNumber: item.worksheetNumber,
                    jobId: jobResult.jobId,
                    dispatchState: dispatchResult.dispatchState,
                    queuedAt: dispatchResult.queuedAt
                };
            } catch (error) {
                const message = error instanceof Error ? error.message : 'Failed to create grading job';
                await prisma.worksheetUploadItem.update({
                    where: { id: item.id },
                    data: {
                        status: WorksheetUploadItemStatus.FAILED,
                        errorMessage: message
                    }
                }).catch(() => {
                    // best effort
                });

                return {
                    kind: 'failed' as const,
                    itemId: item.id,
                    studentId: item.studentId,
                    worksheetNumber: item.worksheetNumber,
                    error: message
                };
            }
        }));

        for (const result of readyResults) {
            if (result.status === 'rejected') {
                failed.push({
                    itemId: 'unknown',
                    studentId: 'unknown',
                    worksheetNumber: 0,
                    error: result.reason instanceof Error ? result.reason.message : 'Failed to finalize upload item'
                });
                continue;
            }

            if (result.value.kind === 'queued') {
                queued.push(result.value);
            } else {
                failed.push(result.value);
            }
        }

        const stillPending = await prisma.worksheetUploadItem.count({
            where: {
                batchId: batch.id,
                status: WorksheetUploadItemStatus.PENDING
            }
        });

        if (stillPending === 0) {
            await prisma.worksheetUploadBatch.update({
                where: { id: batch.id },
                data: {
                    status: WorksheetUploadBatchStatus.FINALIZED,
                    finalizedAt: new Date()
                }
            });
        }

        captureGradingPipelineEvent('direct_upload_session_finalized', batch.id, {
            batchId: batch.id,
            queuedCount: queued.length,
            pendingCount: pending.length,
            failedCount: failed.length
        });

        return res.json({
            success: true,
            batchId: batch.id,
            status: stillPending === 0 ? WorksheetUploadBatchStatus.FINALIZED : WorksheetUploadBatchStatus.UPLOADING,
            queued,
            pending,
            failed
        });
    } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to finalize upload session';
        await logError('direct-upload-finalize', error instanceof Error ? error : new Error(message), {
            batchId: req.params.batchId,
            teacherId: req.user?.userId
        }).catch(() => {
            // best effort
        });

        return res.status(500).json({ success: false, error: 'Failed to finalize upload session' });
    }
};

/**
 * Queue grading job and return immediately.
 * @route POST /api/worksheet-processing/process
 */
export const processWorksheets = async (req: Request, res: Response) => {
    const requestTimer = aiGradingLogger.startTimer();

    const {
        token_no: tokenNo,
        worksheet_name: worksheetName,
        classId,
        studentId,
        studentName,
        worksheetNumber,
        submittedOn,
        isRepeated
    } = req.body;
    const submittedById = req.user?.userId;

    const files = (req.files as MulterFile[]) || [];

    aiGradingLogger.info('Grading request received', {
        tokenNo,
        worksheetName,
        worksheetNumber,
        studentId,
        classId,
        submittedOn,
        filesCount: files.length,
        teacherId: submittedById,
        queueMode: config.grading.queueMode
    });

    captureGradingPipelineEvent('request_received', String(submittedById || studentId || tokenNo || 'unknown'), {
        tokenNo: tokenNo ? String(tokenNo) : null,
        worksheetName: worksheetName ? String(worksheetName) : null,
        worksheetNumber: worksheetNumber ? String(worksheetNumber) : null,
        studentId: studentId ? String(studentId) : null,
        classId: classId ? String(classId) : null,
        filesCount: files.length,
        queueMode: config.grading.queueMode
    });

    if (!tokenNo || !worksheetName || files.length === 0) {
        captureGradingPipelineEvent('request_rejected_validation', String(submittedById || studentId || 'unknown'), {
            reason: 'missing_required_fields_token_or_worksheet_or_files',
            filesCount: files.length
        });
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (!classId || !studentId || !worksheetNumber || !submittedById) {
        captureGradingPipelineEvent('request_rejected_validation', String(submittedById || studentId || 'unknown'), {
            reason: 'missing_required_fields_job_metadata',
            hasClassId: Boolean(classId),
            hasStudentId: Boolean(studentId),
            hasWorksheetNumber: Boolean(worksheetNumber),
            hasTeacherId: Boolean(submittedById)
        });
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (
        config.grading.queueMode === 'cloudflare' &&
        !config.grading.pullWorkerEnabled &&
        files.length > config.grading.fastMaxPages
    ) {
        captureGradingPipelineEvent('request_rejected_validation', String(submittedById || studentId), {
            reason: 'too_many_pages_fast_path',
            filesCount: files.length,
            maxPages: config.grading.fastMaxPages
        });
        return res.status(400).json({
            success: false,
            error: `Too many images. Maximum ${config.grading.fastMaxPages} pages are supported in queue mode right now.`
        });
    }

    let jobId: string | null = null;

    try {
        const resolvedStudentName =
            studentName ||
            (await prisma.user.findUnique({ where: { id: studentId }, select: { name: true } }))?.name ||
            'Unknown';

        const job = await prisma.gradingJob.create({
            data: {
                studentId,
                studentName: resolvedStudentName,
                worksheetNumber: Number.parseInt(String(worksheetNumber), 10),
                worksheetName: String(worksheetName),
                tokenNo: String(tokenNo),
                classId,
                teacherId: submittedById,
                status: GradingJobStatus.QUEUED,
                submittedOn: submittedOn ? new Date(submittedOn) : new Date(),
                isRepeated: parseBoolean(isRepeated)
            },
            select: { id: true }
        });

        jobId = job.id;

        captureGradingPipelineEvent('job_created', job.id, {
            jobId: job.id,
            studentId: String(studentId),
            classId: String(classId),
            teacherId: String(submittedById),
            worksheetNumber: String(worksheetNumber),
            worksheetName: String(worksheetName),
            queueMode: config.grading.queueMode
        });

        await storeJobImages(job.id, files, req);

        captureGradingPipelineEvent('images_stored', job.id, {
            jobId: job.id,
            filesCount: files.length,
            totalBytes: files.reduce((acc, file) => acc + file.size, 0),
            storageProvider: config.objectStorage.provider
        });

        const dispatchResult = await dispatchJob(job.id);

        requestTimer.end('Grading job queued', {
            jobId: job.id,
            dispatchState: dispatchResult.dispatchState,
            queuedAt: dispatchResult.queuedAt
        });

        captureGradingPipelineEvent('request_accepted', job.id, {
            jobId: job.id,
            dispatchState: dispatchResult.dispatchState,
            queuedAt: dispatchResult.queuedAt,
            status: 'queued'
        });

        return res.status(202).json({
            success: true,
            jobId: job.id,
            status: 'queued',
            queuedAt: dispatchResult.queuedAt,
            dispatchState: dispatchResult.dispatchState,
            message:
                dispatchResult.dispatchState === 'DISPATCHED'
                    ? 'Job queued'
                    : 'Job created but dispatch pending; it will be retried automatically'
        });
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const errorDetails = error as { code?: string; statusCode?: number; requestId?: string; name?: string } | undefined;

        if (jobId) {
            await prisma.gradingJob
                .update({
                    where: { id: jobId },
                    data: {
                        status: GradingJobStatus.FAILED,
                        errorMessage,
                        lastErrorAt: new Date(),
                        completedAt: new Date()
                    }
                })
                .catch(() => {
                    // best effort
                });
        }

        await logError('grading-request', error instanceof Error ? error : new Error(errorMessage), {
            jobId,
            studentId,
            classId,
            worksheetNumber,
            errorCode: errorDetails?.code,
            errorStatusCode: errorDetails?.statusCode,
            errorRequestId: errorDetails?.requestId,
            errorName: errorDetails?.name
        }).catch(() => {
            // best effort
        });

        requestTimer.end('Grading request failed', {
            jobId,
            error: errorMessage
        });

        captureGradingPipelineEvent('request_failed', String(jobId || submittedById || studentId || 'unknown'), {
            jobId,
            studentId: studentId ? String(studentId) : null,
            classId: classId ? String(classId) : null,
            worksheetNumber: worksheetNumber ? String(worksheetNumber) : null,
            error: errorMessage,
            errorCode: errorDetails?.code,
            errorStatusCode: errorDetails?.statusCode
        });

        return res.status(500).json({ success: false, error: 'Failed to queue grading job' });
    }
};
