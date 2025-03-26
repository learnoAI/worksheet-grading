import express from 'express';
import { body } from 'express-validator';
import {
    createUser,
    updateUser,
    resetPassword,
    getUsers,
    getUserById
} from '../controllers/userController';
import { UserRole } from '@prisma/client';
import { auth, authorizeRoles, asHandler } from '../middleware/utils';

const router = express.Router();

// Create user (admin/superadmin only)
router.post(
    '/',
    [
        auth,
        authorizeRoles([UserRole.ADMIN, UserRole.SUPERADMIN]),
        body('name').notEmpty().withMessage('Name is required'),
        body('username').notEmpty().withMessage('Username is required'),
        body('password').isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('role').isIn(Object.values(UserRole)).withMessage('Invalid role')
    ],
    asHandler(createUser)
);

// Update user
router.put(
    '/:id',
    [
        auth,
        authorizeRoles([UserRole.ADMIN, UserRole.SUPERADMIN]),
        body('name').optional(),
        body('username').optional(),
        body('password').optional().isLength({ min: 6 }).withMessage('Password must be at least 6 characters'),
        body('role').optional().isIn(Object.values(UserRole)).withMessage('Invalid role')
    ],
    asHandler(updateUser)
);

// Reset password (admin/superadmin only)
router.post(
    '/:id/reset-password',
    [
        auth,
        authorizeRoles([UserRole.ADMIN, UserRole.SUPERADMIN]),
        body('newPassword').isLength({ min: 6 }).withMessage('Password must be at least 6 characters')
    ],
    asHandler(resetPassword)
);

// Get all users (filtered by role if provided)
router.get('/', auth, asHandler(getUsers));

// Get user by ID
router.get('/:id', auth, asHandler(getUserById));

export default router; 