import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import classes from './classes';
import type { AppBindings } from '../types';

const SECRET = 'test-secret';

function mountApp(prisma: unknown) {
  const app = new Hono<AppBindings>();
  app.use('*', async (c, next) => {
    c.set('prisma', prisma as never);
    await next();
  });
  app.route('/api/classes', classes);
  return app;
}

async function tokenAs(role = 'SUPERADMIN') {
  const exp = Math.floor(Date.now() / 1000) + 60;
  return sign({ userId: 'u-1', role, exp }, SECRET, 'HS256');
}

async function sa(path: string, prisma: unknown, token?: string) {
  const app = mountApp(prisma);
  const t = token ?? (await tokenAs('SUPERADMIN'));
  return app.request(path, { headers: { Authorization: `Bearer ${t}` } }, { JWT_SECRET: SECRET });
}

describe('GET /api/classes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 401 without a token', async () => {
    const app = mountApp({ class: { findMany: vi.fn() } });
    const res = await app.request('/api/classes', {}, { JWT_SECRET: SECRET });
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-SUPERADMIN', async () => {
    const res = await sa('/api/classes', { class: { findMany: vi.fn() } }, await tokenAs('TEACHER'));
    expect(res.status).toBe(403);
  });

  it('filters to isArchived: false by default', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes', { class: { findMany } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: false } })
    );
  });

  it('includes archived when includeArchived=true (no isArchived filter)', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes?includeArchived=true', { class: { findMany } });
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {} }));
  });

  it('filters by schoolId', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes?schoolId=s1', { class: { findMany } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: false, schoolId: 's1' } })
    );
  });
});

describe('GET /api/classes/archived', () => {
  beforeEach(() => vi.clearAllMocks());

  it('always filters to isArchived: true', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes/archived', { class: { findMany } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: true } })
    );
  });

  it('respects schoolId alongside the archived filter', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes/archived?schoolId=s1', { class: { findMany } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { isArchived: true, schoolId: 's1' } })
    );
  });
});

describe('GET /api/classes/:id', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const res = await sa('/api/classes/missing', {
      class: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    expect(res.status).toBe(404);
  });

  it('returns the class row when found', async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValue({ id: 'c1', name: 'Math', school: { id: 's1', name: 'A' } });
    const res = await sa('/api/classes/c1', { class: { findUnique } });
    expect(res.status).toBe(200);
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' } })
    );
  });
});

describe('GET /api/classes/:id/teachers', () => {
  it('filters by role=TEACHER and classId via some', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes/c1/teachers', { user: { findMany } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'TEACHER', teacherClasses: { some: { classId: 'c1' } } },
      })
    );
  });
});

describe('GET /api/classes/:id/students', () => {
  it('filters by role=STUDENT and classId via some, orders by tokenNumber', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes/c1/students', { user: { findMany } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { role: 'STUDENT', studentClasses: { some: { classId: 'c1' } } },
        orderBy: { tokenNumber: 'asc' },
      })
    );
  });
});

describe('GET /api/classes/teachers/available/:classId', () => {
  it('excludes teachers already in the class and archived ones', async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes/teachers/available/c1', { user: { findMany } });
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: 'TEACHER',
          isArchived: false,
          teacherClasses: { none: { classId: 'c1' } },
        },
      })
    );
  });
});

describe('GET /api/classes/students/available/:classId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when class does not exist', async () => {
    const res = await sa('/api/classes/students/available/c-ghost', {
      class: { findUnique: vi.fn().mockResolvedValue(null) },
      user: { findMany: vi.fn() },
    });
    expect(res.status).toBe(404);
  });

  it('filters students to the same school, not already in the class, active', async () => {
    const classFindUnique = vi.fn().mockResolvedValue({ schoolId: 's1' });
    const userFindMany = vi.fn().mockResolvedValue([]);
    await sa('/api/classes/students/available/c1', {
      class: { findUnique: classFindUnique },
      user: { findMany: userFindMany },
    });
    expect(classFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, select: { schoolId: true } })
    );
    expect(userFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          role: 'STUDENT',
          isArchived: false,
          studentClasses: { none: { classId: 'c1' } },
          studentSchools: { some: { schoolId: 's1' } },
        },
      })
    );
  });
});

// ---------- Mutation tests ----------

async function postJson(
  app: Hono<AppBindings>,
  path: string,
  body: unknown,
  token?: string
) {
  const t = token ?? (await tokenAs('SUPERADMIN'));
  return app.request(
    path,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${t}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    { JWT_SECRET: SECRET }
  );
}

async function delAuth(app: Hono<AppBindings>, path: string, token?: string) {
  const t = token ?? (await tokenAs('SUPERADMIN'));
  return app.request(
    path,
    { method: 'DELETE', headers: { Authorization: `Bearer ${t}` } },
    { JWT_SECRET: SECRET }
  );
}

describe('POST /api/classes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('rejects missing fields with 400', async () => {
    const app = mountApp({ school: { findUnique: vi.fn() }, class: { findFirst: vi.fn(), create: vi.fn() } });
    const res = await postJson(app, '/api/classes', { name: 'X' });
    expect(res.status).toBe(400);
  });

  it('returns 404 when school does not exist', async () => {
    const app = mountApp({
      school: { findUnique: vi.fn().mockResolvedValue(null) },
      class: { findFirst: vi.fn(), create: vi.fn() },
    });
    const res = await postJson(app, '/api/classes', {
      name: 'C',
      schoolId: 'missing',
      academicYear: '2026',
    });
    expect(res.status).toBe(404);
  });

  it('returns 400 when class with same name+year exists for school', async () => {
    const app = mountApp({
      school: { findUnique: vi.fn().mockResolvedValue({ id: 's1' }) },
      class: {
        findFirst: vi.fn().mockResolvedValue({ id: 'c-existing' }),
        create: vi.fn(),
      },
    });
    const res = await postJson(app, '/api/classes', {
      name: 'C',
      schoolId: 's1',
      academicYear: '2026',
    });
    expect(res.status).toBe(400);
  });

  it('creates and returns 201 with included school + counts', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'c-new',
      name: 'C',
      school: { id: 's1', name: 'A' },
      _count: { studentClasses: 0, teacherClasses: 0, worksheets: 0 },
    });
    const app = mountApp({
      school: { findUnique: vi.fn().mockResolvedValue({ id: 's1' }) },
      class: { findFirst: vi.fn().mockResolvedValue(null), create },
    });
    const res = await postJson(app, '/api/classes', {
      name: '  C  ',
      schoolId: 's1',
      academicYear: '  2026  ',
    });
    expect(res.status).toBe(201);
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { name: 'C', schoolId: 's1', academicYear: '2026' },
      })
    );
  });
});

describe('POST /api/classes/:id/archive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not found', async () => {
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const res = await postJson(app, '/api/classes/missing/archive', {});
    expect(res.status).toBe(404);
  });

  it('returns 400 when already archived', async () => {
    const app = mountApp({
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1',
          isArchived: true,
          name: 'C',
          school: { name: 'A' },
        }),
      },
    });
    const res = await postJson(app, '/api/classes/c1/archive', {});
    expect(res.status).toBe(400);
  });

  it('archives class and orphan students inside a transaction', async () => {
    const txOps = {
      class: {
        update: vi.fn().mockResolvedValue({ id: 'c1', isArchived: true }),
      },
      studentClass: {
        findMany: vi.fn().mockResolvedValue([
          { studentId: 'st1' },
          { studentId: 'st2' },
        ]),
        count: vi
          .fn()
          .mockResolvedValueOnce(2) // st1 still active elsewhere
          .mockResolvedValueOnce(0), // st2 orphaned
      },
      user: { update: vi.fn().mockResolvedValue({}) },
    };
    const app = mountApp({
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1',
          isArchived: false,
          name: 'C',
          school: { name: 'A' },
        }),
      },
      $transaction: vi.fn(async (cb: (tx: typeof txOps) => Promise<unknown>) => cb(txOps)),
    });
    const res = await postJson(app, '/api/classes/c1/archive', {});
    expect(res.status).toBe(200);
    expect(txOps.class.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: { isArchived: true } })
    );
    expect(txOps.user.update).toHaveBeenCalledTimes(1);
    expect(txOps.user.update).toHaveBeenCalledWith({
      where: { id: 'st2' },
      data: { isArchived: true },
    });
  });
});

describe('POST /api/classes/:id/unarchive', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when not archived', async () => {
    const app = mountApp({
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1',
          isArchived: false,
          name: 'C',
          school: { name: 'A' },
        }),
      },
    });
    const res = await postJson(app, '/api/classes/c1/unarchive', {});
    expect(res.status).toBe(400);
  });

  it('unarchives and returns the row', async () => {
    const update = vi.fn().mockResolvedValue({ id: 'c1', isArchived: false });
    const app = mountApp({
      class: {
        findUnique: vi.fn().mockResolvedValue({
          id: 'c1',
          isArchived: true,
          name: 'C',
          school: { name: 'A' },
        }),
        update,
      },
    });
    const res = await postJson(app, '/api/classes/c1/unarchive', {});
    expect(res.status).toBe(200);
    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: 'c1' }, data: { isArchived: false } })
    );
  });
});

describe('POST /api/classes/:id/teachers/:teacherId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when class is missing', async () => {
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue(null) },
      user: { findUnique: vi.fn() },
      teacherClass: { findUnique: vi.fn(), create: vi.fn() },
      teacherSchool: { findUnique: vi.fn(), create: vi.fn() },
    });
    const res = await postJson(app, '/api/classes/missing/teachers/t1', {});
    expect(res.status).toBe(404);
  });

  it('returns 404 when teacher does not exist with TEACHER role', async () => {
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', schoolId: 's1' }) },
      user: { findUnique: vi.fn().mockResolvedValue(null) },
      teacherClass: { findUnique: vi.fn(), create: vi.fn() },
      teacherSchool: { findUnique: vi.fn(), create: vi.fn() },
    });
    const res = await postJson(app, '/api/classes/c1/teachers/t-missing', {});
    expect(res.status).toBe(404);
  });

  it('returns 400 when teacher already in class', async () => {
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', schoolId: 's1' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 't1' }) },
      teacherClass: {
        findUnique: vi.fn().mockResolvedValue({ teacherId: 't1' }),
        create: vi.fn(),
      },
      teacherSchool: { findUnique: vi.fn(), create: vi.fn() },
    });
    const res = await postJson(app, '/api/classes/c1/teachers/t1', {});
    expect(res.status).toBe(400);
  });

  it('creates teacher-class and links teacher-school when needed', async () => {
    const tcCreate = vi.fn().mockResolvedValue({});
    const tsCreate = vi.fn().mockResolvedValue({});
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', schoolId: 's1' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 't1' }) },
      teacherClass: { findUnique: vi.fn().mockResolvedValue(null), create: tcCreate },
      teacherSchool: { findUnique: vi.fn().mockResolvedValue(null), create: tsCreate },
    });
    const res = await postJson(app, '/api/classes/c1/teachers/t1', {});
    expect(res.status).toBe(201);
    expect(tcCreate).toHaveBeenCalledWith({ data: { teacherId: 't1', classId: 'c1' } });
    expect(tsCreate).toHaveBeenCalledWith({ data: { teacherId: 't1', schoolId: 's1' } });
  });
});

describe('DELETE /api/classes/:id/teachers/:teacherId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 404 when not assigned', async () => {
    const app = mountApp({
      teacherClass: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn() },
    });
    const res = await delAuth(app, '/api/classes/c1/teachers/t1');
    expect(res.status).toBe(404);
  });

  it('removes the assignment', async () => {
    const del = vi.fn().mockResolvedValue({});
    const app = mountApp({
      teacherClass: {
        findUnique: vi.fn().mockResolvedValue({ teacherId: 't1', classId: 'c1' }),
        delete: del,
      },
    });
    const res = await delAuth(app, '/api/classes/c1/teachers/t1');
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({
      where: { teacherId_classId: { teacherId: 't1', classId: 'c1' } },
    });
  });
});

describe('POST + DELETE /api/classes/:id/students/:studentId', () => {
  beforeEach(() => vi.clearAllMocks());

  it('add: returns 400 when already in class', async () => {
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', schoolId: 's1' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'st1' }) },
      studentClass: {
        findUnique: vi.fn().mockResolvedValue({ studentId: 'st1' }),
        create: vi.fn(),
      },
      studentSchool: { findUnique: vi.fn(), create: vi.fn() },
    });
    const res = await postJson(app, '/api/classes/c1/students/st1', {});
    expect(res.status).toBe(400);
  });

  it('add: creates student-class and student-school as needed', async () => {
    const scCreate = vi.fn().mockResolvedValue({});
    const ssCreate = vi.fn().mockResolvedValue({});
    const app = mountApp({
      class: { findUnique: vi.fn().mockResolvedValue({ id: 'c1', schoolId: 's1' }) },
      user: { findUnique: vi.fn().mockResolvedValue({ id: 'st1' }) },
      studentClass: { findUnique: vi.fn().mockResolvedValue(null), create: scCreate },
      studentSchool: { findUnique: vi.fn().mockResolvedValue(null), create: ssCreate },
    });
    const res = await postJson(app, '/api/classes/c1/students/st1', {});
    expect(res.status).toBe(201);
    expect(scCreate).toHaveBeenCalled();
    expect(ssCreate).toHaveBeenCalled();
  });

  it('remove: returns 404 when not assigned', async () => {
    const app = mountApp({
      studentClass: { findUnique: vi.fn().mockResolvedValue(null), delete: vi.fn() },
    });
    const res = await delAuth(app, '/api/classes/c1/students/st1');
    expect(res.status).toBe(404);
  });

  it('remove: deletes the student-class join', async () => {
    const del = vi.fn().mockResolvedValue({});
    const app = mountApp({
      studentClass: {
        findUnique: vi.fn().mockResolvedValue({ studentId: 'st1', classId: 'c1' }),
        delete: del,
      },
    });
    const res = await delAuth(app, '/api/classes/c1/students/st1');
    expect(res.status).toBe(200);
    expect(del).toHaveBeenCalledWith({
      where: { studentId_classId: { studentId: 'st1', classId: 'c1' } },
    });
  });
});

describe('POST /api/classes/archive-by-year', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when academicYear is missing', async () => {
    const app = mountApp({});
    const res = await postJson(app, '/api/classes/archive-by-year', {});
    expect(res.status).toBe(400);
  });

  it('returns 404 when no active classes match', async () => {
    const app = mountApp({
      class: { findMany: vi.fn().mockResolvedValue([]) },
    });
    const res = await postJson(app, '/api/classes/archive-by-year', {
      academicYear: '2026',
    });
    expect(res.status).toBe(404);
  });

  it('archives matching classes and orphan students in a transaction', async () => {
    const txOps = {
      class: {
        updateMany: vi.fn().mockResolvedValue({ count: 2 }),
      },
      studentClass: {
        findMany: vi
          .fn()
          .mockResolvedValueOnce([
            { studentId: 'st1' },
            { studentId: 'st2' },
            { studentId: 'st1' }, // duplicate
          ])
          .mockResolvedValueOnce([{ studentId: 'st1' }]), // st1 still active
        count: vi.fn(),
      },
      user: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    };
    const app = mountApp({
      class: {
        findMany: vi.fn().mockResolvedValue([
          { id: 'c1', name: 'A', schoolId: 's1' },
          { id: 'c2', name: 'B', schoolId: 's1' },
        ]),
      },
      $transaction: vi.fn(async (cb: (tx: typeof txOps) => Promise<unknown>) => cb(txOps)),
    });
    const res = await postJson(app, '/api/classes/archive-by-year', {
      academicYear: '2026',
    });
    expect(res.status).toBe(200);
    expect(txOps.user.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ['st2'] } },
      data: { isArchived: true },
    });
  });
});

describe('POST /api/classes/upload-class-teachers', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns 400 when rows is empty', async () => {
    const app = mountApp({});
    const res = await postJson(app, '/api/classes/upload-class-teachers', {
      schoolId: 's1',
      rows: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 404 when school not found', async () => {
    const app = mountApp({
      school: { findUnique: vi.fn().mockResolvedValue(null) },
    });
    const res = await postJson(app, '/api/classes/upload-class-teachers', {
      schoolId: 's-missing',
      rows: [{ className: 'C', academicYear: '2026', teacherUsername: 'tch' }],
    });
    expect(res.status).toBe(404);
  });

  it('creates classes, assigns teachers, and reports missing teachers', async () => {
    const classFindFirst = vi
      .fn()
      .mockResolvedValueOnce(null) // first row needs a new class
      .mockResolvedValueOnce({ id: 'c-existing' }); // second row uses existing
    const classCreate = vi.fn().mockResolvedValue({ id: 'c-new' });
    const userFindFirst = vi
      .fn()
      .mockResolvedValueOnce({ id: 't1' })
      .mockResolvedValueOnce(null); // second teacher missing
    const tcFindUnique = vi.fn().mockResolvedValue(null);
    const tcCreate = vi.fn().mockResolvedValue({});
    const tsFindUnique = vi.fn().mockResolvedValue(null);
    const tsCreate = vi.fn().mockResolvedValue({});

    const app = mountApp({
      school: { findUnique: vi.fn().mockResolvedValue({ id: 's1' }) },
      class: { findFirst: classFindFirst, create: classCreate },
      user: { findFirst: userFindFirst },
      teacherClass: { findUnique: tcFindUnique, create: tcCreate },
      teacherSchool: { findUnique: tsFindUnique, create: tsCreate },
    });

    const res = await postJson(app, '/api/classes/upload-class-teachers', {
      schoolId: 's1',
      rows: [
        { className: 'C1', academicYear: '2026', teacherUsername: 'tch1' },
        { className: 'C2', academicYear: '2026', teacherUsername: 'ghost' },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { classesCreated: number; teachersAssigned: number; errors: string[] };
    };
    expect(body.results.classesCreated).toBe(1);
    expect(body.results.teachersAssigned).toBe(1);
    expect(body.results.errors[0]).toContain('ghost');
  });
});

describe('POST /api/classes/upload-student-classes', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reports missing classes per row but processes the rest', async () => {
    const app = mountApp({
      school: { findUnique: vi.fn().mockResolvedValue({ id: 's1' }) },
      class: {
        findFirst: vi
          .fn()
          .mockResolvedValueOnce(null) // first row -> class missing
          .mockResolvedValueOnce({ id: 'c1' }),
      },
      user: {
        findFirst: vi.fn().mockResolvedValue({
          id: 'st-existing',
          isArchived: false,
        }),
      },
      studentClass: {
        findUnique: vi.fn().mockResolvedValue(null),
        create: vi.fn().mockResolvedValue({}),
      },
      studentSchool: {
        findUnique: vi.fn().mockResolvedValue({}),
        create: vi.fn(),
      },
    });
    const res = await postJson(app, '/api/classes/upload-student-classes', {
      schoolId: 's1',
      rows: [
        {
          tokenNumber: 'T1',
          studentName: 'A',
          className: 'NoClass',
          academicYear: '2026',
        },
        {
          tokenNumber: 'T2',
          studentName: 'B',
          className: 'C1',
          academicYear: '2026',
        },
      ],
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      results: { studentsAssigned: number; studentsCreated: number; errors: string[] };
    };
    expect(body.results.studentsAssigned).toBe(1);
    expect(body.results.errors[0]).toContain('Class not found');
  });
});
