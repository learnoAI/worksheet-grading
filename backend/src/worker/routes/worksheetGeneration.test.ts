import { describe, expect, it, beforeEach, vi, afterAll } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import worksheetGeneration from './worksheetGeneration';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

// Stub the global fetch so the adapter's CF Queue / question-gen calls
// don't try to hit the network. We override this in tests that need to
// assert payloads.
const originalFetch = globalThis.fetch;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ success: true, result: {} }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  );
  globalThis.fetch = fetchMock as unknown as typeof fetch;
  vi.clearAllMocks();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

function mountApp(prisma: unknown, envOverrides: Record<string, unknown> = {}) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/worksheet-generation', worksheetGeneration);
  const env = {
    JWT_SECRET: SECRET,
    CF_ACCOUNT_ID: 'acct-1',
    CF_API_TOKEN: 'tok-1',
    PDF_RENDERING_QUEUE_ID: 'pdf-q',
    QUESTION_GENERATION_QUEUE_ID: 'qgen-q',
    ...envOverrides,
  };
  return { app, env };
}

async function teacherToken(userId = 'teacher-1') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId, role: 'TEACHER', exp }, SECRET, 'HS256');
}

async function studentToken(userId = 'student-1') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId, role: 'STUDENT', exp }, SECRET, 'HS256');
}

function authHeader(token: string) {
  return { Authorization: `Bearer ${token}` };
}

describe('POST /api/worksheet-generation/generate', () => {
  it('returns 401 without token', async () => {
    const { app, env } = mountApp({});
    const res = await app.request(
      '/api/worksheet-generation/generate',
      { method: 'POST' },
      env
    );
    expect(res.status).toBe(401);
  });

  it('returns 403 for STUDENT role', async () => {
    const { app, env } = mountApp({});
    const token = await studentToken();
    const res = await app.request(
      '/api/worksheet-generation/generate',
      {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: 's1', days: 3, startDate: '2026-04-20' }),
      },
      env
    );
    expect(res.status).toBe(403);
  });

  it('returns 400 when required fields are missing', async () => {
    const { app, env } = mountApp({});
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/generate',
      {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      },
      env
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: 'studentId, days, and startDate required',
    });
  });

  it('returns 400 for days outside 1-30', async () => {
    const { app, env } = mountApp({});
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/generate',
      {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: 's1', days: 50, startDate: '2026-04-20' }),
      },
      env
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'days must be 1-30' });
  });

  it('returns 404 when the student does not exist', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/generate',
      {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: 'missing', days: 1, startDate: '2026-04-20' }),
      },
      env
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Student not found' });
  });

  it('generates a worksheet and returns worksheetIds', async () => {
    const prisma = {
      user: { findUnique: vi.fn().mockResolvedValue({ id: 's1' }) },
      worksheetSkillMap: {
        findMany: vi.fn().mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
      studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
      questionBank: {
        count: vi.fn().mockResolvedValue(100),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      mathSkill: { findUnique: vi.fn().mockResolvedValue({ name: 'Math' }) },
      generatedWorksheet: { create: vi.fn().mockResolvedValue({ id: 'ws-1' }) },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/generate',
      {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId: 's1', days: 1, startDate: '2026-04-20' }),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      success: boolean;
      data: { worksheetIds: string[]; status: string };
    };
    expect(body.success).toBe(true);
    expect(body.data.worksheetIds).toEqual(['ws-1']);
    expect(body.data.status).toBe('COMPLETED');
  });
});

describe('POST /api/worksheet-generation/generate-class', () => {
  it('returns 400 when required fields missing', async () => {
    const { app, env } = mountApp({});
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/generate-class',
      {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: 'c1' }),
      },
      env
    );
    expect(res.status).toBe(400);
  });

  it('returns 404 when class does not exist', async () => {
    const prisma = {
      class: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/generate-class',
      {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: 'c-missing', days: 1, startDate: '2026-04-20' }),
      },
      env
    );
    expect(res.status).toBe(404);
  });

  it('creates a batch and returns counts', async () => {
    const prisma = {
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1' }) },
      studentClass: { findMany: vi.fn().mockResolvedValue([{ studentId: 's1' }]) },
      worksheetBatch: {
        create: vi.fn().mockResolvedValue({ id: 'batch-1' }),
        update: vi.fn().mockResolvedValue({}),
      },
      worksheetSkillMap: {
        findMany: vi.fn().mockResolvedValue([{ worksheetNumber: 1, mathSkillId: 'A' }]),
      },
      skillPracticeLog: { findFirst: vi.fn().mockResolvedValue(null) },
      studentSkillMastery: { findMany: vi.fn().mockResolvedValue([]) },
      generatedWorksheet: {
        create: vi.fn().mockResolvedValue({ id: 'ws-1' }),
        findMany: vi.fn().mockResolvedValue([]),
        update: vi.fn(),
      },
      questionBank: {
        count: vi.fn().mockResolvedValue(100),
        findMany: vi.fn().mockResolvedValue([]),
        updateMany: vi.fn(),
      },
      mathSkill: { findUnique: vi.fn().mockResolvedValue({ name: 'Math' }) },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/generate-class',
      {
        method: 'POST',
        headers: { ...authHeader(token), 'Content-Type': 'application/json' },
        body: JSON.stringify({ classId: 'c1', days: 1, startDate: '2026-04-20' }),
      },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: { batchId: string; totalWorksheets: number };
    };
    expect(body.data.batchId).toBe('batch-1');
    expect(body.data.totalWorksheets).toBe(1);
  });
});

describe('GET /api/worksheet-generation/batch/:batchId', () => {
  it('returns 404 when batch is not found', async () => {
    const prisma = { worksheetBatch: { findUnique: vi.fn().mockResolvedValue(null) } };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/batch/missing',
      { headers: authHeader(token) },
      env
    );
    expect(res.status).toBe(404);
  });

  it('returns the batch row on success', async () => {
    const prisma = {
      worksheetBatch: {
        findUnique: vi.fn().mockResolvedValue({ id: 'b1', status: 'COMPLETED' }),
      },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/batch/b1',
      { headers: authHeader(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: { id: string } };
    expect(body.data.id).toBe('b1');
  });
});

describe('GET /api/worksheet-generation/student/:studentId', () => {
  it('returns enriched worksheet rows with skill names', async () => {
    const prisma = {
      generatedWorksheet: {
        findMany: vi.fn().mockResolvedValue([
          {
            id: 'w1',
            scheduledDate: new Date(),
            status: 'COMPLETED',
            pdfUrl: 'https://cdn/w1.pdf',
            newSkillId: 'A',
            reviewSkill1Id: 'B',
            reviewSkill2Id: 'C',
            createdAt: new Date(),
          },
        ]),
      },
      mathSkill: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'A', name: 'Adding' },
          { id: 'B', name: 'Subtracting' },
          { id: 'C', name: 'Multiplying' },
        ]),
      },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/student/s1',
      { headers: authHeader(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      data: Array<{ newSkillName: string; reviewSkill1Name: string }>;
    };
    expect(body.data[0].newSkillName).toBe('Adding');
    expect(body.data[0].reviewSkill1Name).toBe('Subtracting');
  });

  it('returns empty array when student has no worksheets', async () => {
    const prisma = {
      generatedWorksheet: { findMany: vi.fn().mockResolvedValue([]) },
      mathSkill: { findMany: vi.fn().mockResolvedValue([]) },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/student/s1',
      { headers: authHeader(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { data: unknown[] };
    expect(body.data).toEqual([]);
  });
});

describe('GET /api/worksheet-generation/:id/pdf', () => {
  it('returns 404 when worksheet does not exist', async () => {
    const prisma = {
      generatedWorksheet: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/nope/pdf',
      { headers: authHeader(token) },
      env
    );
    expect(res.status).toBe(404);
  });

  it('returns "not ready" JSON when status is not COMPLETED or pdfUrl missing', async () => {
    const prisma = {
      generatedWorksheet: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ status: 'RENDERING', pdfUrl: null }),
      },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/w1/pdf',
      { headers: authHeader(token) },
      env
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; status: string; error: string };
    expect(body.success).toBe(false);
    expect(body.status).toBe('RENDERING');
    expect(body.error).toBe('PDF not ready yet');
  });

  it('redirects (302) to the PDF URL when COMPLETED', async () => {
    const prisma = {
      generatedWorksheet: {
        findUnique: vi
          .fn()
          .mockResolvedValue({ status: 'COMPLETED', pdfUrl: 'https://cdn/w1.pdf' }),
      },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();
    const res = await app.request(
      '/api/worksheet-generation/w1/pdf',
      { headers: authHeader(token), redirect: 'manual' },
      env
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('https://cdn/w1.pdf');
  });

  it('does not match /batch/:batchId or /student/:studentId', async () => {
    // Sanity: static sub-trees should not fall through to /:id/pdf.
    const findUnique = vi.fn();
    const prisma = {
      generatedWorksheet: { findUnique, findMany: vi.fn().mockResolvedValue([]) },
      mathSkill: { findMany: vi.fn().mockResolvedValue([]) },
      worksheetBatch: { findUnique: vi.fn().mockResolvedValue(null) },
    };
    const { app, env } = mountApp(prisma);
    const token = await teacherToken();

    // neither of these should route into the pdf handler
    const r1 = await app.request(
      '/api/worksheet-generation/batch/b-zzz',
      { headers: authHeader(token) },
      env
    );
    const r2 = await app.request(
      '/api/worksheet-generation/student/s-zzz',
      { headers: authHeader(token) },
      env
    );
    expect(r1.status).toBe(404); // batch not found (handler ran, good)
    expect(r2.status).toBe(200); // student list handler ran
    expect(findUnique).not.toHaveBeenCalled();
  });
});
