import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { validationResult } from 'express-validator';
import prisma from '../utils/prisma';
import { UserRole } from '@prisma/client';

/**
 * Create a new user (admin/superadmin only)
 * @route POST /api/users
 */
export const createUser = async (req: Request, res: Response) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name, username, password, role } = req.body;

    try {
        // Check if username already exists
        const existingUser = await prisma.user.findUnique({
            where: { username }
        });

        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        // Hash password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(password, salt);

        // Create new user
        const newUser = await prisma.user.create({
            data: {
                name,
                username,
                password: hashedPassword,
                role: role as UserRole
            },
            select: {
                id: true,
                username: true,
                role: true,
                createdAt: true,
                updatedAt: true
            }
        });

        return res.status(201).json(newUser);
    } catch (error) {
        console.error('Create user error:', error);
        return res.status(500).json({ message: 'Server error during user creation' });
    }
};

/**
 * Update a user
 * @route PUT /api/users/:id
 */
export const updateUser = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { username, password, role } = req.body;

    try {
        // Check if user exists
        const existingUser = await prisma.user.findUnique({
            where: { id }
        });

        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Prepare update data
        const updateData: any = {};

        if (username) {
            // Check if new username is already taken
            if (username !== existingUser.username) {
                const usernameExists = await prisma.user.findUnique({
                    where: { username }
                });

                if (usernameExists) {
                    return res.status(400).json({ message: 'Username already exists' });
                }

                updateData.username = username;
            }
        }

        if (password) {
            // Hash new password
            const salt = await bcrypt.genSalt(10);
            updateData.password = await bcrypt.hash(password, salt);
        }

        if (role) {
            updateData.role = role;
        }

        // Update user
        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                username: true,
                role: true,
                createdAt: true,
                updatedAt: true
            }
        });

        return res.status(200).json(updatedUser);
    } catch (error) {
        console.error('Update user error:', error);
        return res.status(500).json({ message: 'Server error during user update' });
    }
};

/**
 * Reset user password (admin/superadmin only)
 * @route POST /api/users/:id/reset-password
 */
export const resetPassword = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { newPassword } = req.body;

    try {
        // Check if user exists
        const existingUser = await prisma.user.findUnique({
            where: { id }
        });

        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }

        // Hash new password
        const salt = await bcrypt.genSalt(10);
        const hashedPassword = await bcrypt.hash(newPassword, salt);

        // Update user password
        await prisma.user.update({
            where: { id },
            data: { password: hashedPassword }
        });

        return res.status(200).json({ message: 'Password reset successful' });
    } catch (error) {
        console.error('Password reset error:', error);
        return res.status(500).json({ message: 'Server error during password reset' });
    }
};

/**
 * Get all users (filtered by role if provided)
 * @route GET /api/users
 */
export const getUsers = async (req: Request, res: Response) => {
    try {
        const role = req.query.role as UserRole | undefined;

        const users = await prisma.user.findMany({
            where: role ? { role } : undefined,
            select: {
                id: true,
                username: true,
                role: true,
                createdAt: true,
                updatedAt: true
            }
        });

        return res.status(200).json(users);
    } catch (error) {
        console.error('Get users error:', error);
        return res.status(500).json({ message: 'Server error while retrieving users' });
    }
};

/**
 * Get a specific user by ID
 * @route GET /api/users/:id
 */
export const getUserById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const user = await prisma.user.findUnique({
            where: { id },
            select: {
                id: true,
                username: true,
                role: true,
                createdAt: true,
                updatedAt: true
            }
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json(user);
    } catch (error) {
        console.error('Get user by ID error:', error);
        return res.status(500).json({ message: 'Server error while retrieving user' });
    }
}; 