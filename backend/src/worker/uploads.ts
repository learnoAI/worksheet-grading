/**
 * Worker-native replacement for the narrow slice of Multer that the Express
 * backend uses: "give me an array of files uploaded under a specific form
 * field name, each with a buffer and the basic metadata."
 *
 * Multer's interface (for the shape we actually use):
 *   req.files is Express.Multer.File[] where each entry has
 *     { buffer, originalname, mimetype, size, fieldname }
 *
 * This helper reads the Hono request's body as `multipart/form-data`, picks
 * out files under the given field name, and returns that same shape. It is
 * deliberately small — we do NOT try to match every Multer option. Things
 * like disk storage or streaming are intentionally out of scope because the
 * Workers runtime handles files as Blobs, not streams.
 *
 * Limits / filters that Multer provided and we replicate here:
 *   - `maxCount`          — reject when more files than allowed are present
 *   - `maxFileSizeBytes`  — reject any file larger than the limit
 *   - `fileFilter(file)`  — caller-provided predicate (e.g. mime prefix)
 *
 * On any rejection we throw an `UploadError` with a stable `code` so route
 * handlers can map to the same HTTP responses that Express+Multer produced.
 */

export interface UploadedFile {
  fieldname: string;
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Uint8Array;
}

export type UploadErrorCode =
  | 'NO_MULTIPART_BODY'
  | 'NO_FILES_PROVIDED'
  | 'LIMIT_FILE_COUNT'
  | 'LIMIT_FILE_SIZE'
  | 'FILTER_REJECTED';

export class UploadError extends Error {
  public readonly code: UploadErrorCode;
  public readonly file?: { fieldname: string; originalname: string; mimetype: string };

  constructor(code: UploadErrorCode, message: string, file?: UploadError['file']) {
    super(message);
    this.name = 'UploadError';
    this.code = code;
    this.file = file;
  }
}

export interface ParseUploadOptions {
  fieldName: string;
  maxCount?: number;
  maxFileSizeBytes?: number;
  fileFilter?: (file: { mimetype: string; originalname: string }) => boolean;
  /**
   * Whether to throw when zero files are present for the field. Multer
   * silently gives you an empty array, so defaults to `false` to match.
   */
  requireAtLeastOne?: boolean;
}

/**
 * Parses the request body as multipart/form-data and returns the files under
 * the given field name plus a flat map of non-file fields (as strings).
 *
 * Mirrors Multer's default memory-storage behavior.
 */
export async function parseMultipartFiles(
  request: Request,
  options: ParseUploadOptions
): Promise<{ files: UploadedFile[]; fields: Record<string, string> }> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('multipart/form-data')) {
    throw new UploadError(
      'NO_MULTIPART_BODY',
      'Expected Content-Type to be multipart/form-data'
    );
  }

  const form = await request.formData();
  const files: UploadedFile[] = [];
  const fields: Record<string, string> = {};

  for (const [key, value] of form.entries()) {
    if (isFileLike(value)) {
      if (key !== options.fieldName) {
        // Files uploaded under an unexpected field name are ignored — Multer
        // under memoryStorage would either include or reject them depending
        // on whether `upload.array()` or `upload.any()` is used. Our callers
        // always specify a single field, so silently ignore.
        continue;
      }
      files.push(await toUploadedFile(key, value));
    } else {
      // Non-file field — coerce to string. If the same key appears multiple
      // times, the last occurrence wins, which matches Express body-parsing
      // for `application/x-www-form-urlencoded` in this backend.
      fields[key] = String(value);
    }
  }

  applyLimits(files, options);
  return { files, fields };
}

function isFileLike(value: FormDataEntryValue): value is Blob {
  // In the Workers runtime, files come back as `File` (extends `Blob`).
  // Older Node/undici may surface them as plain `Blob`.
  return typeof value === 'object' && value !== null && typeof (value as Blob).arrayBuffer === 'function';
}

async function toUploadedFile(fieldname: string, blob: Blob): Promise<UploadedFile> {
  const arrayBuffer = await blob.arrayBuffer();
  const maybeName = (blob as Blob & { name?: string }).name;
  return {
    fieldname,
    originalname: maybeName && maybeName.length > 0 ? maybeName : 'file',
    mimetype: blob.type || 'application/octet-stream',
    size: blob.size,
    buffer: new Uint8Array(arrayBuffer),
  };
}

function applyLimits(files: UploadedFile[], options: ParseUploadOptions): void {
  if (options.requireAtLeastOne && files.length === 0) {
    throw new UploadError('NO_FILES_PROVIDED', `No files provided for field "${options.fieldName}"`);
  }

  if (options.maxCount !== undefined && files.length > options.maxCount) {
    throw new UploadError(
      'LIMIT_FILE_COUNT',
      `Too many files for field "${options.fieldName}" (max ${options.maxCount})`
    );
  }

  for (const f of files) {
    if (options.maxFileSizeBytes !== undefined && f.size > options.maxFileSizeBytes) {
      throw new UploadError(
        'LIMIT_FILE_SIZE',
        `File "${f.originalname}" exceeds the ${options.maxFileSizeBytes} byte limit`,
        { fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype }
      );
    }
    if (options.fileFilter && !options.fileFilter(f)) {
      throw new UploadError(
        'FILTER_REJECTED',
        `File "${f.originalname}" rejected by filter`,
        { fieldname: f.fieldname, originalname: f.originalname, mimetype: f.mimetype }
      );
    }
  }
}

// ---------- Common filters, lifted from the existing Express routes ----------

/**
 * Accepts any file whose declared mime type starts with `image/`.
 * Matches the existing Multer filter in worksheet routes.
 */
export const imageOnlyFilter: NonNullable<ParseUploadOptions['fileFilter']> = (file) =>
  (file.mimetype || '').startsWith('image/');
