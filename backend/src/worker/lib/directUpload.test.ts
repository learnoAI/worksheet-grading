import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import {
  ValidationError,
  requireString,
  sanitizeFilename,
  parseSubmittedOn,
  getExtension,
  buildDirectUploadKey,
  normalizeDirectUploadItems,
  assertDirectUploadAccess,
  type DirectUploadWorksheetInput,
} from './directUpload';

describe('requireString', () => {
  it('throws ValidationError on empty or non-string', () => {
    expect(() => requireString('', 'x')).toThrow(ValidationError);
    expect(() => requireString('   ', 'x')).toThrow(ValidationError);
    expect(() => requireString(42, 'x')).toThrow(ValidationError);
    expect(() => requireString(undefined, 'x')).toThrow(ValidationError);
  });
  it('returns trimmed value', () => {
    expect(requireString('  hi  ', 'x')).toBe('hi');
  });
});

describe('sanitizeFilename', () => {
  it('replaces disallowed characters with underscores', () => {
    expect(sanitizeFilename('hello world!.png')).toBe('hello_world_.png');
    // ASCII-only assertion avoids NFD vs NFC normalization ambiguity
    expect(sanitizeFilename('a b$c#d.png')).toBe('a_b_c_d.png');
  });
});

describe('parseSubmittedOn', () => {
  it('returns a UTC-midnight Date for valid input', () => {
    const d = parseSubmittedOn('2026-04-10T15:30:00Z');
    expect(d.getUTCHours()).toBe(0);
    expect(d.toISOString().slice(0, 10)).toBe('2026-04-10');
  });
  it('throws on invalid date string', () => {
    expect(() => parseSubmittedOn('nonsense')).toThrow(ValidationError);
  });
  it('defaults to today when value is undefined/empty', () => {
    const d = parseSubmittedOn(undefined);
    expect(d.getUTCHours()).toBe(0);
  });
});

describe('getExtension', () => {
  it('prefers the filename extension when present', () => {
    expect(getExtension('foo.PNG', 'image/jpeg')).toBe('.png');
  });
  it('falls back to mime-based extension when filename has none', () => {
    expect(getExtension('noext', 'image/png')).toBe('.png');
    expect(getExtension('noext', 'image/webp')).toBe('.webp');
    expect(getExtension('noext', 'image/jpeg')).toBe('.jpg');
  });
});

describe('buildDirectUploadKey', () => {
  it('produces the canonical object key layout', () => {
    const item = {
      studentId: 'st1',
      studentName: 'Alice',
      worksheetNumber: 5,
      worksheetName: '5',
      isRepeated: false,
      files: [],
    } as DirectUploadWorksheetInput;
    const key = buildDirectUploadKey(
      't1',
      'c1',
      new Date('2026-04-10T00:00:00Z'),
      'b1',
      item,
      { pageNumber: 2, fileName: 'img.png', mimeType: 'image/png' },
      'uuid-123'
    );
    expect(key).toBe(
      'worksheet-uploads/t1/c1/2026-04-10/b1/st1/worksheet-5-page-2-uuid-123.png'
    );
  });
});

describe('normalizeDirectUploadItems', () => {
  const validItem = {
    studentId: 'st1',
    worksheetNumber: 5,
    studentName: 'Alice',
    worksheetName: '5',
    isRepeated: false,
    files: [{ pageNumber: 1, mimeType: 'image/png', fileName: 'p1.png', fileSize: 1000 }],
  };

  it('rejects non-arrays', () => {
    expect(() => normalizeDirectUploadItems(null)).toThrow(/must include at least one/);
    expect(() => normalizeDirectUploadItems({})).toThrow(/must include at least one/);
    expect(() => normalizeDirectUploadItems([])).toThrow(/must include at least one/);
  });

  it('rejects over-count batches', () => {
    const tooMany = Array.from({ length: 81 }, (_, i) => ({
      ...validItem,
      studentId: `st${i}`,
      worksheetNumber: 1,
    }));
    expect(() => normalizeDirectUploadItems(tooMany)).toThrow(/at most 80/);
  });

  it('rejects duplicate (studentId, worksheetNumber) pairs', () => {
    expect(() => normalizeDirectUploadItems([validItem, { ...validItem }])).toThrow(
      /Duplicate worksheet/
    );
  });

  it('rejects non-image mime types', () => {
    expect(() =>
      normalizeDirectUploadItems([
        {
          ...validItem,
          files: [{ pageNumber: 1, mimeType: 'application/pdf', fileName: 'p.pdf' }],
        },
      ])
    ).toThrow(/must be an image/);
  });

  it('rejects oversized files', () => {
    expect(() =>
      normalizeDirectUploadItems([
        {
          ...validItem,
          files: [
            {
              pageNumber: 1,
              mimeType: 'image/png',
              fileName: 'p.png',
              fileSize: 60 * 1024 * 1024,
            },
          ],
        },
      ])
    ).toThrow(/exceeds/);
  });

  it('rejects duplicate pages within a worksheet', () => {
    expect(() =>
      normalizeDirectUploadItems([
        {
          ...validItem,
          files: [
            { pageNumber: 1, mimeType: 'image/png' },
            { pageNumber: 1, mimeType: 'image/png' },
          ],
        },
      ])
    ).toThrow(/Duplicate page/);
  });

  it('accepts and normalizes defaults', () => {
    const out = normalizeDirectUploadItems([
      {
        studentId: '  st1 ',
        worksheetNumber: '3',
        files: [{ pageNumber: 1, mimeType: 'image/png' }],
      },
    ]);
    expect(out).toEqual([
      {
        studentId: 'st1',
        studentName: 'Unknown',
        tokenNo: undefined,
        worksheetNumber: 3,
        worksheetName: '3',
        isRepeated: false,
        files: [
          {
            pageNumber: 1,
            mimeType: 'image/png',
            fileName: 'page-1.jpg',
            fileSize: undefined,
          },
        ],
      },
    ]);
  });
});

describe('assertDirectUploadAccess', () => {
  it('rejects STUDENT role', async () => {
    const prisma = {
      teacherClass: { findUnique: vi.fn() },
      studentClass: { findMany: vi.fn() },
    } as unknown as PrismaClient;
    await expect(
      assertDirectUploadAccess(prisma, { userId: 'u1', role: 'STUDENT' }, 'c1', ['st1'])
    ).rejects.toThrow(/Students cannot/);
  });

  it('rejects TEACHER not assigned to the class', async () => {
    const prisma = {
      teacherClass: { findUnique: vi.fn().mockResolvedValue(null) },
      studentClass: { findMany: vi.fn() },
    } as unknown as PrismaClient;
    await expect(
      assertDirectUploadAccess(prisma, { userId: 't1', role: 'TEACHER' }, 'c1', ['st1'])
    ).rejects.toThrow(/not assigned to this class/);
  });

  it('rejects when students are not enrolled in the class', async () => {
    const prisma = {
      teacherClass: { findUnique: vi.fn().mockResolvedValue({ teacherId: 't1' }) },
      studentClass: {
        findMany: vi.fn().mockResolvedValue([{ studentId: 'st1' }]),
      },
    } as unknown as PrismaClient;
    await expect(
      assertDirectUploadAccess(
        prisma,
        { userId: 't1', role: 'TEACHER' },
        'c1',
        ['st1', 'st2', 'st3']
      )
    ).rejects.toThrow(/not assigned to this class: st2, st3/);
  });

  it('passes when all students are enrolled and teacher owns class', async () => {
    const prisma = {
      teacherClass: { findUnique: vi.fn().mockResolvedValue({ teacherId: 't1' }) },
      studentClass: {
        findMany: vi.fn().mockResolvedValue([{ studentId: 'st1' }, { studentId: 'st2' }]),
      },
    } as unknown as PrismaClient;
    await expect(
      assertDirectUploadAccess(
        prisma,
        { userId: 't1', role: 'TEACHER' },
        'c1',
        ['st1', 'st2']
      )
    ).resolves.toBeUndefined();
  });

  it('skips teacher-class check for ADMIN/SUPERADMIN', async () => {
    const teacherFindUnique = vi.fn();
    const prisma = {
      teacherClass: { findUnique: teacherFindUnique },
      studentClass: {
        findMany: vi.fn().mockResolvedValue([{ studentId: 'st1' }]),
      },
    } as unknown as PrismaClient;
    await assertDirectUploadAccess(
      prisma,
      { userId: 'a1', role: 'SUPERADMIN' },
      'c1',
      ['st1']
    );
    expect(teacherFindUnique).not.toHaveBeenCalled();
  });
});
