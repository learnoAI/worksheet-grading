import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import * as SQLite from 'expo-sqlite';

import {
  DirectUploadItem,
  PageUploadStatus,
  QueuePage,
  QueueStatus,
  QueueWorksheet,
  QueueWorksheetInput,
} from '../types';
import { createLocalId } from '../utils/id';

type WorksheetRow = {
  local_id: string;
  class_id: string;
  class_name: string | null;
  student_id: string;
  student_name: string;
  token_number: string;
  submitted_on: string;
  worksheet_number: number;
  is_repeated: number;
  status: QueueStatus;
  backend_batch_id: string | null;
  backend_item_id: string | null;
  job_id: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
};

type PageRow = {
  id: string;
  worksheet_local_id: string;
  page_number: number;
  local_uri: string;
  mime_type: string;
  file_name: string;
  file_size: number | null;
  width: number | null;
  height: number | null;
  image_id: string | null;
  upload_url: string | null;
  upload_url_expires_at: string | null;
  upload_status: PageUploadStatus;
  uploaded_at: string | null;
  error_message: string | null;
};

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

function nowIso(): string {
  return new Date().toISOString();
}

function queueDirectory(localId: string): string {
  if (!FileSystem.documentDirectory) {
    throw new Error('File system document directory is unavailable');
  }

  return `${FileSystem.documentDirectory}teacher-capture/${localId}/`;
}

function extensionFor(fileName: string, mimeType: string, uri: string): string {
  const source = fileName || uri.split('?')[0] || '';
  const extension = source.match(/\.[a-zA-Z0-9]{1,8}$/)?.[0];
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

async function ensureQueueDirectory(localId: string): Promise<string> {
  const directory = queueDirectory(localId);
  await FileSystem.makeDirectoryAsync(directory, { intermediates: true });
  return directory;
}

const COMPRESS_MAX_LONG_EDGE = 1800;
const COMPRESS_MIN_BYTES = 750 * 1024; // 750KB
const COMPRESS_JPEG_QUALITY = 0.80;

async function compressImage(uri: string): Promise<{ uri: string; width: number; height: number }> {
  // Check file size — skip if already small
  const info = await FileSystem.getInfoAsync(uri);
  const size = info.exists && 'size' in info ? info.size : 0;
  if (size > 0 && size < COMPRESS_MIN_BYTES) {
    // Still get dimensions via a no-op manipulate
    const probe = await manipulateAsync(uri, [], { format: SaveFormat.JPEG });
    return { uri, width: probe.width, height: probe.height };
  }

  // Resize long edge to max 1800px and compress to JPEG 80%
  const probe = await manipulateAsync(uri, [], { format: SaveFormat.JPEG });
  const longEdge = Math.max(probe.width, probe.height);
  const needsResize = longEdge > COMPRESS_MAX_LONG_EDGE;

  const result = await manipulateAsync(
    uri,
    needsResize
      ? [{ resize: probe.width >= probe.height
            ? { width: COMPRESS_MAX_LONG_EDGE }
            : { height: COMPRESS_MAX_LONG_EDGE } }]
      : [],
    { compress: COMPRESS_JPEG_QUALITY, format: SaveFormat.JPEG },
  );

  return { uri: result.uri, width: result.width, height: result.height };
}

async function copyPageFile(localId: string, page: QueueWorksheetInput['pages'][number]): Promise<QueuePage> {
  const directory = await ensureQueueDirectory(localId);

  // Compress before copying to queue
  let sourceUri = page.uri;
  let width = page.width ?? null;
  let height = page.height ?? null;
  let mimeType = page.mimeType;

  try {
    const compressed = await compressImage(page.uri);
    sourceUri = compressed.uri;
    width = compressed.width;
    height = compressed.height;
    mimeType = 'image/jpeg';
  } catch {
    // Compression failed — use original
  }

  const fileName = `page-${page.pageNumber}.jpg`;
  const localUri = `${directory}${fileName}`;

  await FileSystem.copyAsync({
    from: sourceUri,
    to: localUri,
  });

  const info = await FileSystem.getInfoAsync(localUri);
  const fileSize = info.exists && 'size' in info ? info.size : page.fileSize ?? null;

  return {
    id: createLocalId('page'),
    worksheetLocalId: localId,
    pageNumber: page.pageNumber,
    localUri,
    mimeType,
    fileName,
    fileSize,
    width,
    height,
    uploadStatus: 'local',
  };
}

function mapWorksheet(row: WorksheetRow, pages: QueuePage[]): QueueWorksheet {
  return {
    localId: row.local_id,
    classId: row.class_id,
    className: row.class_name,
    studentId: row.student_id,
    studentName: row.student_name,
    tokenNumber: row.token_number,
    submittedOn: row.submitted_on,
    worksheetNumber: row.worksheet_number,
    isRepeated: row.is_repeated === 1,
    status: row.status,
    backendBatchId: row.backend_batch_id,
    backendItemId: row.backend_item_id,
    jobId: row.job_id,
    errorMessage: row.error_message,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    pages,
  };
}

function mapPage(row: PageRow): QueuePage {
  return {
    id: row.id,
    worksheetLocalId: row.worksheet_local_id,
    pageNumber: row.page_number,
    localUri: row.local_uri,
    mimeType: row.mime_type,
    fileName: row.file_name,
    fileSize: row.file_size,
    width: row.width,
    height: row.height,
    imageId: row.image_id,
    uploadUrl: row.upload_url,
    uploadUrlExpiresAt: row.upload_url_expires_at,
    uploadStatus: row.upload_status,
    uploadedAt: row.uploaded_at,
    errorMessage: row.error_message,
  };
}

async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync('teacher-capture.db').then(async (db) => {
      await db.execAsync(`
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS worksheets (
          local_id TEXT PRIMARY KEY NOT NULL,
          class_id TEXT NOT NULL,
          class_name TEXT,
          student_id TEXT NOT NULL,
          student_name TEXT NOT NULL,
          token_number TEXT NOT NULL DEFAULT '',
          submitted_on TEXT NOT NULL,
          worksheet_number INTEGER NOT NULL,
          is_repeated INTEGER NOT NULL DEFAULT 0,
          status TEXT NOT NULL,
          backend_batch_id TEXT,
          backend_item_id TEXT,
          job_id TEXT,
          error_message TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS pages (
          id TEXT PRIMARY KEY NOT NULL,
          worksheet_local_id TEXT NOT NULL,
          page_number INTEGER NOT NULL,
          local_uri TEXT NOT NULL,
          mime_type TEXT NOT NULL,
          file_name TEXT NOT NULL,
          file_size INTEGER,
          width INTEGER,
          height INTEGER,
          image_id TEXT,
          upload_url TEXT,
          upload_url_expires_at TEXT,
          upload_status TEXT NOT NULL,
          uploaded_at TEXT,
          error_message TEXT,
          FOREIGN KEY (worksheet_local_id) REFERENCES worksheets(local_id) ON DELETE CASCADE,
          UNIQUE (worksheet_local_id, page_number)
        );

        CREATE INDEX IF NOT EXISTS worksheets_status_idx ON worksheets(status);
        CREATE INDEX IF NOT EXISTS worksheets_class_date_idx ON worksheets(class_id, submitted_on);
        CREATE INDEX IF NOT EXISTS pages_worksheet_idx ON pages(worksheet_local_id);
      `);

      return db;
    });
  }

  return dbPromise;
}

export async function initializeQueueDatabase(): Promise<void> {
  await getDb();
}

export async function queueCapturedWorksheet(input: QueueWorksheetInput): Promise<QueueWorksheet> {
  const db = await getDb();
  const localId = createLocalId('worksheet');
  const createdAt = nowIso();
  const pages = await Promise.all(input.pages.map((page) => copyPageFile(localId, page)));

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO worksheets (
        local_id, class_id, class_name, student_id, student_name, token_number, submitted_on,
        worksheet_number, is_repeated, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        localId,
        input.classId,
        input.className ?? null,
        input.studentId,
        input.studentName,
        input.tokenNumber,
        input.submittedOn,
        input.worksheetNumber,
        input.isRepeated ? 1 : 0,
        'queued',
        createdAt,
        createdAt,
      ],
    );

    for (const page of pages) {
      await db.runAsync(
        `INSERT INTO pages (
          id, worksheet_local_id, page_number, local_uri, mime_type, file_name, file_size,
          width, height, upload_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          page.id,
          localId,
          page.pageNumber,
          page.localUri,
          page.mimeType,
          page.fileName,
          page.fileSize ?? null,
          page.width ?? null,
          page.height ?? null,
          page.uploadStatus,
        ],
      );
    }
  });

  return {
    localId,
    classId: input.classId,
    className: input.className,
    studentId: input.studentId,
    studentName: input.studentName,
    tokenNumber: input.tokenNumber,
    submittedOn: input.submittedOn,
    worksheetNumber: input.worksheetNumber,
    isRepeated: input.isRepeated,
    status: 'queued',
    createdAt,
    updatedAt: createdAt,
    pages,
  };
}

async function getPagesForWorksheet(localId: string): Promise<QueuePage[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<PageRow>(
    'SELECT * FROM pages WHERE worksheet_local_id = ? ORDER BY page_number ASC',
    [localId],
  );

  return rows.map(mapPage);
}

export async function getQueueItem(localId: string): Promise<QueueWorksheet | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<WorksheetRow>('SELECT * FROM worksheets WHERE local_id = ?', [
    localId,
  ]);

  if (!row) {
    return null;
  }

  return mapWorksheet(row, await getPagesForWorksheet(localId));
}

export async function listQueueItems(filters?: {
  submittedOn?: string;
  classIds?: string[];
}): Promise<QueueWorksheet[]> {
  const db = await getDb();
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (filters?.submittedOn) {
    conditions.push('submitted_on = ?');
    params.push(filters.submittedOn);
  }

  if (filters?.classIds && filters.classIds.length > 0) {
    const placeholders = filters.classIds.map(() => '?').join(', ');
    conditions.push(`class_id IN (${placeholders})`);
    params.push(...filters.classIds);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const rows = await db.getAllAsync<WorksheetRow>(
    `SELECT * FROM worksheets ${where} ORDER BY created_at DESC`,
    params as any[],
  );
  const items: QueueWorksheet[] = [];

  for (const row of rows) {
    items.push(mapWorksheet(row, await getPagesForWorksheet(row.local_id)));
  }

  return items;
}

export async function listItemsForUpload(): Promise<QueueWorksheet[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<WorksheetRow>(
    `SELECT * FROM worksheets
     WHERE status IN ('queued', 'uploading', 'uploaded', 'failed')
     ORDER BY created_at ASC`,
  );
  const items: QueueWorksheet[] = [];

  for (const row of rows) {
    items.push(mapWorksheet(row, await getPagesForWorksheet(row.local_id)));
  }

  return items;
}

export async function hasDuplicateLocalWorksheet(
  classId: string,
  studentId: string,
  submittedOn: string,
): Promise<boolean> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    `SELECT COUNT(*) as count FROM worksheets
     WHERE class_id = ? AND student_id = ? AND submitted_on = ?
       AND status NOT IN ('failed')`,
    [classId, studentId, submittedOn],
  );

  return (row?.count ?? 0) > 0;
}

export async function updateWorksheetStatus(
  localId: string,
  status: QueueStatus,
  errorMessage?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE worksheets
     SET status = ?, error_message = ?, updated_at = ?
     WHERE local_id = ?`,
    [status, errorMessage ?? null, nowIso(), localId],
  );
}

export async function markWorksheetUploading(localId: string): Promise<void> {
  await updateWorksheetStatus(localId, 'uploading', null);
}

export async function resetItemForRetry(localId: string): Promise<void> {
  const db = await getDb();
  const updatedAt = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE worksheets
       SET status = 'queued', error_message = NULL, updated_at = ?
       WHERE local_id = ?`,
      [updatedAt, localId],
    );
    await db.runAsync(
      `UPDATE pages
       SET upload_status = CASE WHEN uploaded_at IS NOT NULL THEN 'uploaded' ELSE 'local' END,
           error_message = NULL
       WHERE worksheet_local_id = ?`,
      [localId],
    );
  });
}

export async function saveUploadSessionItem(
  worksheet: QueueWorksheet,
  item: DirectUploadItem,
  batchId: string,
): Promise<void> {
  const db = await getDb();
  const updatedAt = nowIso();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE worksheets
       SET backend_batch_id = ?, backend_item_id = ?, job_id = ?, error_message = ?, updated_at = ?
       WHERE local_id = ?`,
      [
        batchId,
        item.itemId,
        item.jobId ?? worksheet.jobId ?? null,
        item.errorMessage ?? null,
        updatedAt,
        worksheet.localId,
      ],
    );

    for (const file of item.files) {
      await db.runAsync(
        `UPDATE pages
         SET image_id = ?, upload_url = ?, upload_url_expires_at = ?, mime_type = COALESCE(?, mime_type)
         WHERE worksheet_local_id = ? AND page_number = ?`,
        [
          file.imageId,
          file.uploadUrl ?? null,
          file.expiresAt ?? null,
          file.mimeType ?? null,
          worksheet.localId,
          file.pageNumber,
        ],
      );
    }
  });
}

export async function markPageUploadStatus(
  pageId: string,
  uploadStatus: PageUploadStatus,
  errorMessage?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE pages
     SET upload_status = ?, error_message = ?, uploaded_at = CASE WHEN ? = 'uploaded' THEN ? ELSE uploaded_at END
     WHERE id = ?`,
    [uploadStatus, errorMessage ?? null, uploadStatus, nowIso(), pageId],
  );
}

export async function markItemFinalized(
  localId: string,
  jobId: string | null | undefined,
): Promise<void> {
  const status: QueueStatus = jobId ? 'grading_queued' : 'uploaded';
  const db = await getDb();
  await db.runAsync(
    `UPDATE worksheets
     SET status = ?, job_id = COALESCE(?, job_id), error_message = NULL, updated_at = ?
     WHERE local_id = ?`,
    [status, jobId ?? null, nowIso(), localId],
  );
}

export async function updateStatusFromGradingJob(
  jobId: string,
  status: QueueStatus,
  errorMessage?: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    `UPDATE worksheets
     SET status = ?, error_message = ?, updated_at = ?
     WHERE job_id = ?`,
    [status, errorMessage ?? null, nowIso(), jobId],
  );
}

export async function listKnownJobItems(): Promise<QueueWorksheet[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<WorksheetRow>(
    `SELECT * FROM worksheets
     WHERE job_id IS NOT NULL
       AND status IN ('grading_queued', 'processing', 'failed')
     ORDER BY updated_at DESC`,
  );
  const items: QueueWorksheet[] = [];

  for (const row of rows) {
    items.push(mapWorksheet(row, await getPagesForWorksheet(row.local_id)));
  }

  return items;
}

async function deleteFileIfExists(uri: string): Promise<void> {
  const info = await FileSystem.getInfoAsync(uri);
  if (info.exists) {
    await FileSystem.deleteAsync(uri, { idempotent: true });
  }
}

export async function deleteLocalFilesForItem(item: QueueWorksheet): Promise<void> {
  await Promise.all(item.pages.map((page) => deleteFileIfExists(page.localUri).catch(() => undefined)));
}

export async function removeQueueItem(localId: string): Promise<void> {
  const db = await getDb();
  const item = await getQueueItem(localId);
  if (item) {
    await deleteLocalFilesForItem(item);
  }

  await db.runAsync('DELETE FROM worksheets WHERE local_id = ?', [localId]);
}
