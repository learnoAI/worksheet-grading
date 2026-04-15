import { Hono } from 'hono';
import { UserRole, type Prisma } from '@prisma/client';
import { authenticate, authorize } from '../middleware/auth';
import type { AppBindings } from '../types';

/**
 * Analytics routes — partial port of `backend/src/routes/analyticsRoutes.ts`.
 *
 * This file covers the lightweight analytics list endpoints
 * (`GET /schools`, `GET /schools/:schoolId/classes`). The heavier endpoints
 * (`/overall`, `/students`, `/students/download`) depend on an in-memory
 * cache, `setInterval`, and `withDatabaseRetry` — all of which need
 * adapting to the Workers runtime. They ship in Phase 5.11 alongside the
 * service-layer adaptations.
 *
 * All endpoints require SUPERADMIN, matching the Express mount.
 */
const analytics = new Hono<AppBindings>();

analytics.use('*', authenticate);
analytics.use('*', authorize([UserRole.SUPERADMIN]));

analytics.get('/schools', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const includeArchived = c.req.query('includeArchived') === 'true';
  const where: Prisma.SchoolWhereInput = includeArchived ? {} : { isArchived: false };

  try {
    const rows = await prisma.school.findMany({
      where,
      select: { id: true, name: true, isArchived: true },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error getting schools:', error);
    return c.json({ message: 'Server error while retrieving schools' }, 500);
  }
});

analytics.get('/schools/:schoolId/classes', async (c) => {
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const schoolId = c.req.param('schoolId');
  const includeArchived = c.req.query('includeArchived') === 'true';

  const where: Prisma.ClassWhereInput = { schoolId };
  if (!includeArchived) {
    where.isArchived = false;
    // Match Express behavior: also exclude classes under archived schools.
    where.school = { isArchived: false };
  }

  try {
    const rows = await prisma.class.findMany({
      where,
      select: { id: true, name: true, schoolId: true, isArchived: true },
      orderBy: [{ isArchived: 'asc' }, { name: 'asc' }],
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Error getting classes by school:', error);
    return c.json({ message: 'Server error while retrieving classes' }, 500);
  }
});

export default analytics;
