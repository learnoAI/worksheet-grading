/**
 * Helpers for the worksheet-processing direct-upload session flow.
 *
 * Ported verbatim from `backend/src/controllers/worksheetProcessingController.ts`
 * with two adaptations:
 *   1. `assertDirectUploadAccess` takes a Prisma client + user object instead
 *      of a Node request — the worker supplies these from context.
 *   2. `captureGradingPipelineEvent` is fired through the adapter from the
 *      caller; this module only throws `ValidationError` and lets the
 *      route layer translate them to HTTP responses.
 *
 * All numeric constants and validation rules match Express exactly so the
 * frontend contract stays stable during the parallel-run window.
 */

import type { PrismaClient, UserRole } from '@prisma/client';

export const DIRECT_UPLOAD_URL_TTL_SECONDS = 15 * 60;
export const MAX_DIRECT_UPLOAD_ITEMS = 80;
export const MAX_DIRECT_UPLOAD_FILES_PER_ITEM = 10;
export const MAX_DIRECT_UPLOAD_FILE_BYTES = 50 * 1024 * 1024;

export class ValidationError extends Error {
  public readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export interface DirectUploadFileInput {
  pageNumber: number;
  fileName: string;
  mimeType: string;
  fileSize?: number;
}

export interface DirectUploadWorksheetInput {
  studentId: string;
  studentName: string;
  tokenNo?: string;
  worksheetNumber: number;
  worksheetName: string;
  isRepeated: boolean;
  files: DirectUploadFileInput[];
}

function parseBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.toLowerCase() === 'true';
  return false;
}

export function sanitizeFilename(filename: string): string {
  return filename.replace(/[^a-zA-Z0-9._-]/g, '_');
}

export function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ValidationError(`${fieldName} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
}

function parsePositiveInteger(value: unknown, fieldName: string): number {
  const parsed = Number.parseInt(String(value), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ValidationError(`${fieldName} must be a positive integer`);
  }
  return parsed;
}

export function parseSubmittedOn(value: unknown): Date {
  const date = value ? new Date(String(value)) : new Date();
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError('submittedOn must be a valid date');
  }
  date.setUTCHours(0, 0, 0, 0);
  return date;
}

export function getExtension(fileName: string, mimeType: string): string {
  const sanitized = sanitizeFilename(fileName);
  const extension = sanitized.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0];
  if (extension) return extension.toLowerCase();
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/webp') return '.webp';
  return '.jpg';
}

export function buildDirectUploadKey(
  teacherId: string,
  classId: string,
  submittedOn: Date,
  batchId: string,
  item: DirectUploadWorksheetInput,
  file: DirectUploadFileInput,
  uuid: string
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
    `worksheet-${item.worksheetNumber}-page-${file.pageNumber}-${uuid}${extension}`,
  ].join('/');
}

/**
 * Validate + shape the incoming `worksheets` array. Throws `ValidationError`
 * on any problem. Matches the Express version for max counts, required
 * fields, duplicate detection, mime-type guard, and size limits.
 */
export function normalizeDirectUploadItems(value: unknown): DirectUploadWorksheetInput[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ValidationError('worksheets must include at least one worksheet');
  }
  if (value.length > MAX_DIRECT_UPLOAD_ITEMS) {
    throw new ValidationError(
      `A batch can include at most ${MAX_DIRECT_UPLOAD_ITEMS} worksheets`
    );
  }

  const seenWorksheetKeys = new Set<string>();

  return value.map((raw, index) => {
    if (!raw || typeof raw !== 'object') {
      throw new ValidationError(`worksheets[${index}] must be an object`);
    }
    const record = raw as Record<string, unknown>;
    const studentId = requireString(record.studentId, `worksheets[${index}].studentId`);
    const worksheetNumber = parsePositiveInteger(
      record.worksheetNumber,
      `worksheets[${index}].worksheetNumber`
    );
    const studentName = optionalString(record.studentName) || 'Unknown';
    const tokenNo = optionalString(record.tokenNo);
    const worksheetName = optionalString(record.worksheetName) || String(worksheetNumber);
    const filesRaw = record.files;

    if (!Array.isArray(filesRaw) || filesRaw.length === 0) {
      throw new ValidationError(
        `worksheets[${index}].files must include at least one image`
      );
    }
    if (filesRaw.length > MAX_DIRECT_UPLOAD_FILES_PER_ITEM) {
      throw new ValidationError(
        `worksheets[${index}].files can include at most ${MAX_DIRECT_UPLOAD_FILES_PER_ITEM} images`
      );
    }

    const worksheetKey = `${studentId}:${worksheetNumber}`;
    if (seenWorksheetKeys.has(worksheetKey)) {
      throw new ValidationError(
        `Duplicate worksheet ${worksheetNumber} for student ${studentId} in this batch`
      );
    }
    seenWorksheetKeys.add(worksheetKey);

    const seenPages = new Set<number>();
    const files = filesRaw.map((fileRaw, fileIndex) => {
      if (!fileRaw || typeof fileRaw !== 'object') {
        throw new ValidationError(
          `worksheets[${index}].files[${fileIndex}] must be an object`
        );
      }
      const fileRecord = fileRaw as Record<string, unknown>;
      const pageNumber = parsePositiveInteger(
        fileRecord.pageNumber ?? fileIndex + 1,
        `worksheets[${index}].files[${fileIndex}].pageNumber`
      );
      const mimeType = requireString(
        fileRecord.mimeType,
        `worksheets[${index}].files[${fileIndex}].mimeType`
      );
      const fileName = optionalString(fileRecord.fileName) || `page-${pageNumber}.jpg`;
      const fileSize =
        fileRecord.fileSize === undefined || fileRecord.fileSize === null
          ? undefined
          : parsePositiveInteger(
              fileRecord.fileSize,
              `worksheets[${index}].files[${fileIndex}].fileSize`
            );

      if (!mimeType.startsWith('image/')) {
        throw new ValidationError(
          `worksheets[${index}].files[${fileIndex}] must be an image`
        );
      }
      if (fileSize && fileSize > MAX_DIRECT_UPLOAD_FILE_BYTES) {
        throw new ValidationError(
          `worksheets[${index}].files[${fileIndex}] exceeds the ${MAX_DIRECT_UPLOAD_FILE_BYTES} byte limit`
        );
      }
      if (seenPages.has(pageNumber)) {
        throw new ValidationError(
          `Duplicate page ${pageNumber} for worksheet ${worksheetNumber}`
        );
      }
      seenPages.add(pageNumber);

      return { pageNumber, fileName, mimeType, fileSize };
    });

    return {
      studentId,
      studentName,
      tokenNo,
      worksheetNumber,
      worksheetName,
      isRepeated: parseBoolean(record.isRepeated),
      files,
    };
  });
}

/**
 * Enforce that the caller is allowed to create an upload session for
 * `classId` containing exactly the listed `studentIds`. Rules match
 * Express:
 *   - STUDENT role is always rejected.
 *   - TEACHER must be assigned to `classId` via TeacherClass.
 *   - ADMIN / SUPERADMIN skip the teacher check.
 *   - Every student must be enrolled in `classId` via StudentClass.
 *
 * On any violation, throws `ValidationError` (which maps to HTTP 400).
 */
export async function assertDirectUploadAccess(
  prisma: PrismaClient,
  user: { userId: string; role: UserRole },
  classId: string,
  studentIds: string[]
): Promise<void> {
  if (user.role === 'STUDENT') {
    throw new ValidationError('Students cannot create grading upload sessions');
  }

  if (user.role === 'TEACHER') {
    const teacherClass = await prisma.teacherClass.findUnique({
      where: {
        teacherId_classId: { teacherId: user.userId, classId },
      },
      select: { teacherId: true },
    });
    if (!teacherClass) {
      throw new ValidationError('Teacher is not assigned to this class');
    }
  }

  const uniqueStudentIds = Array.from(new Set(studentIds));
  const studentClasses = await prisma.studentClass.findMany({
    where: { classId, studentId: { in: uniqueStudentIds } },
    select: { studentId: true },
  });

  const validStudentIds = new Set(studentClasses.map((sc) => sc.studentId));
  const missingStudentIds = uniqueStudentIds.filter((id) => !validStudentIds.has(id));
  if (missingStudentIds.length > 0) {
    throw new ValidationError(
      `Some students are not assigned to this class: ${missingStudentIds.join(', ')}`
    );
  }
}
