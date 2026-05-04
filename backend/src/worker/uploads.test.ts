import { describe, expect, it } from 'vitest';
import { parseMultipartFiles, UploadError, imageOnlyFilter } from './uploads';

/**
 * Builds a multipart/form-data Request the way the Workers runtime sees it.
 * `FormData` + `fetch` in Node lets us construct the body without crafting
 * boundary headers by hand.
 */
function makeRequest(parts: Array<{ name: string; value: string | Blob; filename?: string }>): Request {
  const fd = new FormData();
  for (const p of parts) {
    if (typeof p.value === 'string') {
      fd.append(p.name, p.value);
    } else {
      fd.append(p.name, p.value, p.filename);
    }
  }
  return new Request('http://x/upload', { method: 'POST', body: fd });
}

function blobOfSize(bytes: number, type = 'image/png'): Blob {
  return new Blob([new Uint8Array(bytes)], { type });
}

describe('parseMultipartFiles', () => {
  it('throws NO_MULTIPART_BODY when content type is not multipart', async () => {
    const req = new Request('http://x/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    await expect(parseMultipartFiles(req, { fieldName: 'images' })).rejects.toMatchObject({
      code: 'NO_MULTIPART_BODY',
    });
  });

  it('returns files with buffer, mimetype, originalname, size', async () => {
    const req = makeRequest([
      { name: 'images', value: blobOfSize(10, 'image/png'), filename: 'a.png' },
      { name: 'images', value: blobOfSize(20, 'image/jpeg'), filename: 'b.jpg' },
      { name: 'classId', value: 'c1' },
    ]);

    const { files, fields } = await parseMultipartFiles(req, { fieldName: 'images' });
    expect(files.length).toBe(2);
    expect(files[0]).toMatchObject({
      fieldname: 'images',
      originalname: 'a.png',
      mimetype: 'image/png',
      size: 10,
    });
    expect(files[0].buffer).toBeInstanceOf(Uint8Array);
    expect(files[0].buffer.byteLength).toBe(10);
    expect(files[1].originalname).toBe('b.jpg');
    expect(fields).toEqual({ classId: 'c1' });
  });

  it('ignores files uploaded under unexpected field names', async () => {
    const req = makeRequest([
      { name: 'images', value: blobOfSize(5, 'image/png'), filename: 'ok.png' },
      { name: 'otherField', value: blobOfSize(5, 'image/png'), filename: 'nope.png' },
    ]);
    const { files } = await parseMultipartFiles(req, { fieldName: 'images' });
    expect(files.length).toBe(1);
    expect(files[0].originalname).toBe('ok.png');
  });

  it('collects non-file fields into the fields map', async () => {
    const req = makeRequest([
      { name: 'images', value: blobOfSize(5, 'image/png'), filename: 'a.png' },
      { name: 'classId', value: 'c1' },
      { name: 'notes', value: 'hello world' },
    ]);
    const { fields } = await parseMultipartFiles(req, { fieldName: 'images' });
    expect(fields).toEqual({ classId: 'c1', notes: 'hello world' });
  });

  it('defaults originalname to "file" when blob has no name', async () => {
    // Using a raw Blob (not File) — FormData won't attach a filename
    const fd = new FormData();
    fd.append('images', new Blob([new Uint8Array(3)], { type: 'image/png' }));
    const req = new Request('http://x/upload', { method: 'POST', body: fd });

    const { files } = await parseMultipartFiles(req, { fieldName: 'images' });
    expect(files.length).toBe(1);
    // Blob without an explicit filename may come through as "blob" depending
    // on runtime — accept either "blob" or our fallback "file".
    expect(['blob', 'file']).toContain(files[0].originalname);
  });

  it('enforces maxCount with LIMIT_FILE_COUNT', async () => {
    const req = makeRequest([
      { name: 'images', value: blobOfSize(1), filename: '1.png' },
      { name: 'images', value: blobOfSize(1), filename: '2.png' },
      { name: 'images', value: blobOfSize(1), filename: '3.png' },
    ]);
    await expect(
      parseMultipartFiles(req, { fieldName: 'images', maxCount: 2 })
    ).rejects.toMatchObject({ code: 'LIMIT_FILE_COUNT' });
  });

  it('enforces maxFileSizeBytes with LIMIT_FILE_SIZE', async () => {
    const req = makeRequest([
      { name: 'images', value: blobOfSize(100), filename: 'big.png' },
    ]);
    await expect(
      parseMultipartFiles(req, { fieldName: 'images', maxFileSizeBytes: 50 })
    ).rejects.toMatchObject({
      code: 'LIMIT_FILE_SIZE',
      file: expect.objectContaining({ originalname: 'big.png' }),
    });
  });

  it('applies fileFilter and rejects non-matching files with FILTER_REJECTED', async () => {
    const req = makeRequest([
      { name: 'images', value: blobOfSize(10, 'text/plain'), filename: 'a.txt' },
    ]);
    await expect(
      parseMultipartFiles(req, { fieldName: 'images', fileFilter: imageOnlyFilter })
    ).rejects.toMatchObject({ code: 'FILTER_REJECTED' });
  });

  it('passes image files through imageOnlyFilter', async () => {
    const req = makeRequest([
      { name: 'images', value: blobOfSize(5, 'image/png'), filename: 'a.png' },
      { name: 'images', value: blobOfSize(5, 'image/jpeg'), filename: 'b.jpg' },
    ]);
    const { files } = await parseMultipartFiles(req, {
      fieldName: 'images',
      fileFilter: imageOnlyFilter,
    });
    expect(files.length).toBe(2);
  });

  it('throws NO_FILES_PROVIDED when requireAtLeastOne=true and no files are uploaded', async () => {
    const req = makeRequest([{ name: 'classId', value: 'c1' }]);
    await expect(
      parseMultipartFiles(req, { fieldName: 'images', requireAtLeastOne: true })
    ).rejects.toMatchObject({ code: 'NO_FILES_PROVIDED' });
  });

  it('returns empty array when requireAtLeastOne is omitted and no files are uploaded', async () => {
    const req = makeRequest([{ name: 'classId', value: 'c1' }]);
    const { files, fields } = await parseMultipartFiles(req, { fieldName: 'images' });
    expect(files).toEqual([]);
    expect(fields).toEqual({ classId: 'c1' });
  });

  it('UploadError instances carry a stable code and optional file metadata', async () => {
    const req = makeRequest([
      { name: 'images', value: blobOfSize(100, 'image/png'), filename: 'big.png' },
    ]);
    try {
      await parseMultipartFiles(req, { fieldName: 'images', maxFileSizeBytes: 50 });
      throw new Error('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(UploadError);
      const u = err as UploadError;
      expect(u.code).toBe('LIMIT_FILE_SIZE');
      expect(u.file).toMatchObject({ originalname: 'big.png', mimetype: 'image/png' });
    }
  });
});
