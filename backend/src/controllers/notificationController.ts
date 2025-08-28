import { Request, Response } from 'express';
import prisma from '../utils/prisma';
import { NotificationStatus } from '@prisma/client';

/**
 * Get notifications for the current user
 * @route GET /api/notifications
 */
export const getNotifications = async (req: Request, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Not authenticated' });
        }

        const notifications = await prisma.notification.findMany({
            where: { userId: req.user.userId },
            orderBy: {
                createdAt: 'desc'
            }
        });

        return res.status(200).json(notifications);
    } catch (error) {
        console.error('Get notifications error:', error);
        return res.status(500).json({ message: 'Server error while retrieving notifications' });
    }
};

/**
 * Mark a notification as read
 * @route PUT /api/notifications/:id/read
 */
export const markNotificationAsRead = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Not authenticated' });
        }

        // Find notification and check ownership
        const notification = await prisma.notification.findUnique({
            where: { id }
        });

        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }

        if (notification.userId !== req.user.userId) {
            return res.status(403).json({ message: 'Not authorized to update this notification' });
        }

        // Update notification status
        const updatedNotification = await prisma.notification.update({
            where: { id },
            data: { status: NotificationStatus.READ }
        });

        return res.status(200).json(updatedNotification);
    } catch (error) {
        console.error('Mark notification as read error:', error);
        return res.status(500).json({ message: 'Server error while updating notification' });
    }
};

/**
 * Mark all notifications as read for the current user
 * @route PUT /api/notifications/read-all
 */
export const markAllNotificationsAsRead = async (req: Request, res: Response) => {
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Not authenticated' });
        }

        // Update all unread notifications for the user
        await prisma.notification.updateMany({
            where: {
                userId: req.user.userId,
                status: NotificationStatus.UNREAD
            },
            data: {
                status: NotificationStatus.READ
            }
        });

        return res.status(200).json({ message: 'All notifications marked as read' });
    } catch (error) {
        console.error('Mark all notifications as read error:', error);
        return res.status(500).json({ message: 'Server error while updating notifications' });
    }
}; 