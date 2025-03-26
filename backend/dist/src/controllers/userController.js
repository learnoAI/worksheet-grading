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
exports.getUserById = exports.getUsers = exports.resetPassword = exports.updateUser = exports.createUser = void 0;
const bcrypt_1 = __importDefault(require("bcrypt"));
const express_validator_1 = require("express-validator");
const prisma_1 = __importDefault(require("../utils/prisma"));
/**
 * Create a new user (admin/superadmin only)
 * @route POST /api/users
 */
const createUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    // Validate input
    const errors = (0, express_validator_1.validationResult)(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }
    const { name, username, password, role } = req.body;
    try {
        // Check if username already exists
        const existingUser = yield prisma_1.default.user.findUnique({
            where: { username }
        });
        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }
        // Hash password
        const salt = yield bcrypt_1.default.genSalt(10);
        const hashedPassword = yield bcrypt_1.default.hash(password, salt);
        // Create new user
        const newUser = yield prisma_1.default.user.create({
            data: {
                name,
                username,
                password: hashedPassword,
                role: role
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
    }
    catch (error) {
        console.error('Create user error:', error);
        return res.status(500).json({ message: 'Server error during user creation' });
    }
});
exports.createUser = createUser;
/**
 * Update a user
 * @route PUT /api/users/:id
 */
const updateUser = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { username, password, role } = req.body;
    try {
        // Check if user exists
        const existingUser = yield prisma_1.default.user.findUnique({
            where: { id }
        });
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Prepare update data
        const updateData = {};
        if (username) {
            // Check if new username is already taken
            if (username !== existingUser.username) {
                const usernameExists = yield prisma_1.default.user.findUnique({
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
            const salt = yield bcrypt_1.default.genSalt(10);
            updateData.password = yield bcrypt_1.default.hash(password, salt);
        }
        if (role) {
            updateData.role = role;
        }
        // Update user
        const updatedUser = yield prisma_1.default.user.update({
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
    }
    catch (error) {
        console.error('Update user error:', error);
        return res.status(500).json({ message: 'Server error during user update' });
    }
});
exports.updateUser = updateUser;
/**
 * Reset user password (admin/superadmin only)
 * @route POST /api/users/:id/reset-password
 */
const resetPassword = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    const { newPassword } = req.body;
    try {
        // Check if user exists
        const existingUser = yield prisma_1.default.user.findUnique({
            where: { id }
        });
        if (!existingUser) {
            return res.status(404).json({ message: 'User not found' });
        }
        // Hash new password
        const salt = yield bcrypt_1.default.genSalt(10);
        const hashedPassword = yield bcrypt_1.default.hash(newPassword, salt);
        // Update user password
        yield prisma_1.default.user.update({
            where: { id },
            data: { password: hashedPassword }
        });
        return res.status(200).json({ message: 'Password reset successful' });
    }
    catch (error) {
        console.error('Password reset error:', error);
        return res.status(500).json({ message: 'Server error during password reset' });
    }
});
exports.resetPassword = resetPassword;
/**
 * Get all users (filtered by role if provided)
 * @route GET /api/users
 */
const getUsers = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    try {
        const role = req.query.role;
        const users = yield prisma_1.default.user.findMany({
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
    }
    catch (error) {
        console.error('Get users error:', error);
        return res.status(500).json({ message: 'Server error while retrieving users' });
    }
});
exports.getUsers = getUsers;
/**
 * Get a specific user by ID
 * @route GET /api/users/:id
 */
const getUserById = (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    const { id } = req.params;
    try {
        const user = yield prisma_1.default.user.findUnique({
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
    }
    catch (error) {
        console.error('Get user by ID error:', error);
        return res.status(500).json({ message: 'Server error while retrieving user' });
    }
});
exports.getUserById = getUserById;
