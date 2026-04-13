import { Request, Response } from 'express';
import bcrypt from 'bcrypt';
import { validationResult } from 'express-validator';
import prisma from '../utils/prisma';
import { UserRole } from '@prisma/client';
import multer from 'multer';
import fs from 'fs';
import path from 'path';

// Configure multer for CSV uploads
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadDir = path.join(__dirname, '../../uploads/csv');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }
        cb(null, uploadDir);
    },
    filename: (req, file, cb) => {
        cb(null, `students-${Date.now()}.csv`);
    }
});

export const upload = multer({ 
    storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'text/csv' || file.originalname.endsWith('.csv')) {
            cb(null, true);
        } else {
            cb(new Error('Only CSV files are allowed'));
        }
    }
});

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

    const { name, username, password, role, tokenNumber, classId, schoolId } = req.body;

    try {
        // Check if username already exists
        const existingUser = await prisma.user.findUnique({
            where: { username }
        });

        if (existingUser) {
            return res.status(400).json({ message: 'Username already exists' });
        }

        // Check if token number already exists (for students)
        if (tokenNumber) {
            const existingToken = await prisma.user.findFirst({
                where: { tokenNumber }
            });

            if (existingToken) {
                return res.status(400).json({ message: 'Token number already exists' });
            }
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
                role: role as UserRole,
                tokenNumber: tokenNumber || null
            },
            select: {
                id: true,
                name: true,
                username: true,
                role: true,
                tokenNumber: true,
                createdAt: true,
                updatedAt: true
            }
        });

        // Handle class and school assignments for students and teachers
        if (role === 'STUDENT' && classId) {
            // Add student to class
            await prisma.studentClass.create({
                data: {
                    studentId: newUser.id,
                    classId
                }
            });

            // Get school from class and add student to school
            const classEntity = await prisma.class.findUnique({
                where: { id: classId },
                select: { schoolId: true }
            });

            if (classEntity) {
                // Check if student-school relationship already exists
                const existingStudentSchool = await prisma.studentSchool.findUnique({
                    where: {
                        studentId_schoolId: {
                            studentId: newUser.id,
                            schoolId: classEntity.schoolId
                        }
                    }
                });

                if (!existingStudentSchool) {
                    await prisma.studentSchool.create({
                        data: {
                            studentId: newUser.id,
                            schoolId: classEntity.schoolId
                        }
                    });
                }
            }
        } else if (role === 'TEACHER' && classId) {
            // Add teacher to class
            await prisma.teacherClass.create({
                data: {
                    teacherId: newUser.id,
                    classId
                }
            });
        }

        // If schoolId is provided for admin, add admin-school relationship
        if (role === 'ADMIN' && schoolId) {
            await prisma.adminSchool.create({
                data: {
                    adminId: newUser.id,
                    schoolId
                }
            });
        }

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
    const { name, username, password, role, tokenNumber } = req.body;

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

        if (name) {
            updateData.name = name;
        }

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

        // Role changes are not allowed via update
        if (role && role !== existingUser.role) {
            return res.status(400).json({ message: 'Changing user role is not allowed' });
        }

        if (tokenNumber !== undefined) {
            // Check if token number is already taken by another user
            if (tokenNumber && tokenNumber !== existingUser.tokenNumber) {
                const existingToken = await prisma.user.findFirst({
                    where: { 
                        tokenNumber,
                        id: { not: id } // Exclude current user
                    }
                });

                if (existingToken) {
                    return res.status(400).json({ message: 'Token number already exists' });
                }
            }
            updateData.tokenNumber = tokenNumber || null;
        }

        // Update user
        const updatedUser = await prisma.user.update({
            where: { id },
            data: updateData,
            select: {
                id: true,
                name: true,
                username: true,
                role: true,
                tokenNumber: true,
                isArchived: true,
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
                name: true,
                username: true,
                role: true,
                tokenNumber: true,
                isArchived: true,
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

/**
 * Upload CSV file to add multiple students
 * @route POST /api/users/upload-csv
 */
export const uploadCsv = async (req: Request, res: Response) => {
    const { students } = req.body; // Array of student objects from frontend

    if (!students || !Array.isArray(students) || students.length === 0) {
        return res.status(400).json({ message: 'No student data provided' });
    }

    const results = {
        created: 0,
        updated: 0,
        errors: [] as string[]
    };

    try {
        for (const studentData of students) {
            const { name, tokenNumber, className, schoolName } = studentData;

            if (!name || !tokenNumber || !className || !schoolName) {
                results.errors.push(`Missing required fields for student: ${name || tokenNumber}`);
                continue;
            }

            try {
                // Find school
                const school = await prisma.school.findFirst({
                    where: { name: schoolName }
                });

                if (!school) {
                    results.errors.push(`School not found: ${schoolName}`);
                    continue;
                }

                // Find class
                const classEntity = await prisma.class.findFirst({
                    where: { 
                        name: className,
                        schoolId: school.id
                    }
                });

                if (!classEntity) {
                    results.errors.push(`Class not found: ${className} in ${schoolName}`);
                    continue;
                }

                // Check if student with token number already exists
                const existingStudent = await prisma.user.findFirst({
                    where: { tokenNumber }
                });

                if (existingStudent) {
                    // Update existing student name if different
                    if (existingStudent.name !== name) {
                        await prisma.user.update({
                            where: { id: existingStudent.id },
                            data: { name }
                        });
                        results.updated++;
                    }

                    // Ensure student is in the correct class
                    const existingStudentClass = await prisma.studentClass.findUnique({
                        where: {
                            studentId_classId: {
                                studentId: existingStudent.id,
                                classId: classEntity.id
                            }
                        }
                    });

                    if (!existingStudentClass) {
                        await prisma.studentClass.create({
                            data: {
                                studentId: existingStudent.id,
                                classId: classEntity.id
                            }
                        });
                    }

                    // Ensure student is in the correct school
                    const existingStudentSchool = await prisma.studentSchool.findUnique({
                        where: {
                            studentId_schoolId: {
                                studentId: existingStudent.id,
                                schoolId: school.id
                            }
                        }
                    });

                    if (!existingStudentSchool) {
                        await prisma.studentSchool.create({
                            data: {
                                studentId: existingStudent.id,
                                schoolId: school.id
                            }
                        });
                    }
                } else {
                    // Create new student
                    const username = name.toLowerCase().replace(/\s+/g, '_') + '_' + tokenNumber;
                    const password = 'saarthi@123'; // Default password

                    // Hash password
                    const salt = await bcrypt.genSalt(10);
                    const hashedPassword = await bcrypt.hash(password, salt);

                    const newStudent = await prisma.user.create({
                        data: {
                            name,
                            username,
                            password: hashedPassword,
                            role: 'STUDENT' as UserRole,
                            tokenNumber
                        }
                    });

                    // Add student to class
                    await prisma.studentClass.create({
                        data: {
                            studentId: newStudent.id,
                            classId: classEntity.id
                        }
                    });

                    // Add student to school
                    await prisma.studentSchool.create({
                        data: {
                            studentId: newStudent.id,
                            schoolId: school.id
                        }
                    });

                    results.created++;
                }
            } catch (error) {
                console.error('Error processing student:', studentData, error);
                results.errors.push(`Failed to process student: ${name} (${tokenNumber})`);
            }
        }

        return res.status(200).json({
            message: 'CSV processing completed',
            results
        });
    } catch (error) {
        console.error('CSV upload error:', error);
        return res.status(500).json({ message: 'Server error during CSV upload' });
    }
};

/**
 * Archive a student (admin/superadmin only)
 * @route POST /api/users/:id/archive
 */
export const archiveStudent = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Check if student exists
        const existingStudent = await prisma.user.findUnique({
            where: { id }
        });

        if (!existingStudent) {
            return res.status(404).json({ message: 'Student not found' });
        }

        // Archive student by updating their status
        await prisma.user.update({
            where: { id },
            data: { isArchived: true }
        });

        return res.status(200).json({ message: 'Student archived successfully' });
    } catch (error) {
        console.error('Archive student error:', error);
        return res.status(500).json({ message: 'Server error during student archiving' });
    }
};

/**
 * Unarchive a student (admin/superadmin only)
 * @route POST /api/users/:id/unarchive
 */
export const unarchiveStudent = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Check if student exists
        const existingStudent = await prisma.user.findUnique({
            where: { id }
        });

        if (!existingStudent) {
            return res.status(404).json({ message: 'Student not found' });
        }

        // Unarchive student by updating their status
        await prisma.user.update({
            where: { id },
            data: { isArchived: false }
        });

        return res.status(200).json({ message: 'Student unarchived successfully' });
    } catch (error) {
        console.error('Unarchive student error:', error);
        return res.status(500).json({ message: 'Server error during student unarchiving' });
    }
};

/**
 * Get all users with complete details including pagination
 * @route GET /api/users/with-details
 */
export const getUsersWithDetails = async (req: Request, res: Response) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 30;
        const role = req.query.role as UserRole | undefined;
        const isArchived = req.query.isArchived === 'true' ? true : req.query.isArchived === 'false' ? false : undefined;
        const searchTerm = req.query.search as string;

        const offset = (page - 1) * limit;

        // Build where clause
        const where: any = {};
        
        if (role) {
            where.role = role;
        }
        
        if (isArchived !== undefined) {
            where.isArchived = isArchived;
        }
        
        if (searchTerm) {
            where.OR = [
                { name: { contains: searchTerm, mode: 'insensitive' } },
                { username: { contains: searchTerm, mode: 'insensitive' } },
                { tokenNumber: { contains: searchTerm, mode: 'insensitive' } }
            ];
        }

        // Get total count for pagination
        const totalCount = await prisma.user.count({ where });

        // Get users with all details
        const users = await prisma.user.findMany({
            where,
            select: {
                id: true,
                name: true,
                username: true,
                role: true,
                tokenNumber: true,
                isArchived: true,
                createdAt: true,
                updatedAt: true,
                // Student relationships
                studentClasses: {
                    include: {
                        class: {
                            include: {
                                school: {
                                    select: {
                                        id: true,
                                        name: true
                                    }
                                }
                            }
                        }
                    }
                },
                studentSchools: {
                    include: {
                        school: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                },
                // Teacher relationships
                teacherClasses: {
                    include: {
                        class: {
                            include: {
                                school: {
                                    select: {
                                        id: true,
                                        name: true
                                    }
                                }
                            }
                        }
                    }
                },
                // Admin relationships
                adminSchools: {
                    include: {
                        school: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            },
            orderBy: [
                { isArchived: 'asc' },
                { role: 'asc' },
                { name: 'asc' }
            ],
            skip: offset,
            take: limit
        });

        const totalPages = Math.ceil(totalCount / limit);

        return res.status(200).json({
            users,
            pagination: {
                currentPage: page,
                totalPages,
                totalCount,
                hasNextPage: page < totalPages,
                hasPrevPage: page > 1
            }
        });
    } catch (error) {
        console.error('Get users with details error:', error);
        return res.status(500).json({ message: 'Server error while retrieving users' });
    }
};