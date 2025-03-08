import express from 'express';
import { body } from 'express-validator';
import { login, getCurrentUser } from '../controllers/authController';
import { auth, asHandler } from '../middleware/utils';

const router = express.Router();

// Login route
router.post(
    '/login',
    [
        body('username').notEmpty().withMessage('Username is required'),
        body('password').notEmpty().withMessage('Password is required')
    ],
    asHandler(login)
);

// Get current user route (protected)
router.get('/me', auth, asHandler(getCurrentUser));

export default router; 