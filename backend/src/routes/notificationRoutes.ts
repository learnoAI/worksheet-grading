import express from 'express';
import {
    getNotifications,
    markNotificationAsRead,
    markAllNotificationsAsRead
} from '../controllers/notificationController';
import { auth, asHandler } from '../middleware/utils';

const router = express.Router();

// Get all notifications for the current user
router.get('/', auth, asHandler(getNotifications));

// Mark a notification as read
router.put('/:id/read', auth, asHandler(markNotificationAsRead));

// Mark all notifications as read
router.put('/read-all', auth, asHandler(markAllNotificationsAsRead));

export default router; 