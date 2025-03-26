"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const express_validator_1 = require("express-validator");
const userController_1 = require("../controllers/userController");
const client_1 = require("@prisma/client");
const utils_1 = require("../middleware/utils");
const router = express_1.default.Router();
// Create user (admin/superadmin only)
router.post('/', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('name').notEmpty().withMessage('Name is required'),
    (0, express_validator_1.body)('username').notEmpty().withMessage('Username is required'),
    (0, express_validator_1.body)('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    (0, express_validator_1.body)('role').isIn(Object.values(client_1.UserRole)).withMessage('Invalid role')
], (0, utils_1.asHandler)(userController_1.createUser));
// Update user
router.put('/:id', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('name').optional(),
    (0, express_validator_1.body)('username').optional(),
    (0, express_validator_1.body)('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
    (0, express_validator_1.body)('role').optional().isIn(Object.values(client_1.UserRole)).withMessage('Invalid role')
], (0, utils_1.asHandler)(userController_1.updateUser));
// Reset password (admin/superadmin only)
router.post('/:id/reset-password', [
    utils_1.auth,
    (0, utils_1.authorizeRoles)([client_1.UserRole.ADMIN, client_1.UserRole.SUPERADMIN]),
    (0, express_validator_1.body)('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
], (0, utils_1.asHandler)(userController_1.resetPassword));
// Get all users (filtered by role if provided)
router.get('/', utils_1.auth, (0, utils_1.asHandler)(userController_1.getUsers));
// Get user by ID
router.get('/:id', utils_1.auth, (0, utils_1.asHandler)(userController_1.getUserById));
exports.default = router;
