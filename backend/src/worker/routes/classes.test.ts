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
