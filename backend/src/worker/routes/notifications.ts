import { Hono } from 'hono';
import { authenticate } from '../middleware/auth';
import type { AppBindings } from '../types';

/**
 * Notification routes — port of `backend/src/routes/notificationRoutes.ts`.
 *
 * Mounted under `/api/notifications`. This file currently only ports the
 * read endpoint (`GET /`). Mutation endpoints (`PUT /:id/read`,
 * `PUT /read-all`) will be added in Phase 5.7.
 */
const notifications = new Hono<AppBindings>();

notifications.use('*', authenticate);

notifications.get('/', async (c) => {
  const user = c.get('user')!; // authenticate guarantees this
  const prisma = c.get('prisma');
  if (!prisma) {
    return c.json({ message: 'Database is not available' }, 500);
  }

  try {
    const rows = await prisma.notification.findMany({
      where: { userId: user.userId },
      orderBy: { createdAt: 'desc' },
    });
    return c.json(rows, 200);
  } catch (error) {
    console.error('Get notifications error:', error);
    return c.json({ message: 'Server error while retrieving notifications' }, 500);
  }
});

export default notifications;
