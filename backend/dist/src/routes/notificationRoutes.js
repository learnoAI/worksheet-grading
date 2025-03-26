"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const notificationController_1 = require("../controllers/notificationController");
const utils_1 = require("../middleware/utils");
const router = express_1.default.Router();
// Get all notifications for the current user
router.get('/', utils_1.auth, (0, utils_1.asHandler)(notificationController_1.getNotifications));
// Mark a notification as read
router.put('/:id/read', utils_1.auth, (0, utils_1.asHandler)(notificationController_1.markNotificationAsRead));
// Mark all notifications as read
router.put('/read-all', utils_1.auth, (0, utils_1.asHandler)(notificationController_1.markAllNotificationsAsRead));
exports.default = router;
