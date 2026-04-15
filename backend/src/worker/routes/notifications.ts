import { Hono } from 'hono';
import { NotificationStatus } from '@prisma/client';
import { authenticate } from '../middleware/auth';
import type { AppBindings } from '../types';

/**
 * Notification routes — port of `backend/src/routes/notificationRoutes.ts`.
 *
 * Mounted under `/api/notifications`. Covers:
 *   GET    /            — list the current user's notifications
 *   PUT    /:id/read    — mark a specific notification as read
 *   PUT    /read-all    — mark all unread notifications as read
 *
 * Route order note: `/read-all` is declared before `/:id/read` so the
 * literal path is not swallowed by the param route.
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

notifications.put('/read-all', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  try {
    await prisma.notification.updateMany({
      where: { userId: user.userId, status: NotificationStatus.UNREAD },
      data: { status: NotificationStatus.READ },
    });
    return c.json({ message: 'All notifications marked as read' }, 200);
  } catch (error) {
    console.error('Mark all notifications as read error:', error);
    return c.json({ message: 'Server error while updating notifications' }, 500);
  }
});

notifications.put('/:id/read', async (c) => {
  const user = c.get('user')!;
  const prisma = c.get('prisma');
  if (!prisma) return c.json({ message: 'Database is not available' }, 500);

  const id = c.req.param('id');
  try {
    const existing = await prisma.notification.findUnique({ where: { id } });
    if (!existing) {
      return c.json({ message: 'Notification not found' }, 404);
    }
    if (existing.userId !== user.userId) {
      return c.json({ message: 'Not authorized to update this notification' }, 403);
    }

    const updated = await prisma.notification.update({
      where: { id },
      data: { status: NotificationStatus.READ },
    });
    return c.json(updated, 200);
  } catch (error) {
    console.error('Mark notification as read error:', error);
    return c.json({ message: 'Server error while updating notification' }, 500);
  }
});

export default notifications;
