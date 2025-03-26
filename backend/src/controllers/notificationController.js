"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.markAllNotificationsAsRead = exports.markNotificationAsRead = exports.getNotifications = void 0;
const prisma_1 = __importDefault(require("../utils/prisma"));
const client_1 = require("@prisma/client");
/**
 * Get notifications for the current user
 * @route GET /api/notifications
 */
const getNotifications = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Not authenticated' });
        }
        const notifications = yield prisma_1.default.notification.findMany({
            where: { userId: req.user.userId },
            orderBy: {
                createdAt: 'desc'
            }
        });
        return res.status(200).json(notifications);
    }
    catch (error) {
        console.error('Get notifications error:', error);
        return res.status(500).json({ message: 'Server error while retrieving notifications' });
    }
});
exports.getNotifications = getNotifications;
/**
 * Mark a notification as read
 * @route PUT /api/notifications/:id/read
 */
const markNotificationAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Not authenticated' });
        }
        // Find notification and check ownership
        const notification = yield prisma_1.default.notification.findUnique({
            where: { id }
        });
        if (!notification) {
            return res.status(404).json({ message: 'Notification not found' });
        }
        if (notification.userId !== req.user.userId) {
            return res.status(403).json({ message: 'Not authorized to update this notification' });
        }
        // Update notification status
        const updatedNotification = yield prisma_1.default.notification.update({
            where: { id },
            data: { status: client_1.NotificationStatus.READ }
        });
        return res.status(200).json(updatedNotification);
    }
    catch (error) {
        console.error('Mark notification as read error:', error);
        return res.status(500).json({ message: 'Server error while updating notification' });
    }
});
exports.markNotificationAsRead = markNotificationAsRead;
/**
 * Mark all notifications as read for the current user
 * @route PUT /api/notifications/read-all
 */
const markAllNotificationsAsRead = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        if (!req.user) {
            return res.status(401).json({ message: 'Not authenticated' });
        }
        // Update all unread notifications for the user
        yield prisma_1.default.notification.updateMany({
            where: {
                userId: req.user.userId,
                status: client_1.NotificationStatus.UNREAD
            },
            data: {
                status: client_1.NotificationStatus.READ
            }
        });
        return res.status(200).json({ message: 'All notifications marked as read' });
    }
    catch (error) {
        console.error('Mark all notifications as read error:', error);
        return res.status(500).json({ message: 'Server error while updating notifications' });
    }
});
exports.markAllNotificationsAsRead = markAllNotificationsAsRead;
