import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import prisma from '../utils/prisma';

/**
 * Get all schools for superadmin with archive status
 * @route GET /api/schools
 */
export const getAllSchools = async (req: Request, res: Response) => {
    try {
        const { includeArchived = 'false' } = req.query;
        
        // Build filter conditions
        const whereConditions: any = {};
        
        // Filter by archive status based on the view
        if (includeArchived === 'true') {
            // Show only archived schools
            whereConditions.isArchived = true;
        } else {
            // Show only active schools
            whereConditions.isArchived = false;
        }
        
        const schools = await prisma.school.findMany({
            where: whereConditions,
            select: {
                id: true,
                name: true,
                isArchived: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: {
                        classes: true,
                        studentSchools: true,
                        teacherSchools: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
        
        return res.status(200).json(schools);
    } catch (error) {
        console.error('Error getting schools:', error);
        return res.status(500).json({ message: 'Server error while retrieving schools' });
    }
};

/**
 * Get archived schools only
 * @route GET /api/schools/archived
 */
export const getArchivedSchools = async (req: Request, res: Response) => {
    try {
        const archivedSchools = await prisma.school.findMany({
            where: {
                isArchived: true
            },
            select: {
                id: true,
                name: true,
                isArchived: true,
                createdAt: true,
                updatedAt: true,
                _count: {
                    select: {
                        classes: true,
                        studentSchools: true,
                        teacherSchools: true
                    }
                }
            },
            orderBy: {
                name: 'asc'
            }
        });
        
        return res.status(200).json(archivedSchools);
    } catch (error) {
        console.error('Error fetching archived schools:', error);
        return res.status(500).json({ message: 'Server error while retrieving archived schools' });
    }
};

/**
 * Get school by ID
 * @route GET /api/schools/:id
 */
export const getSchoolById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const school = await prisma.school.findUnique({
            where: { id },
            include: {
                classes: {
                    select: {
                        id: true,
                        name: true,
                        isArchived: true,
                        _count: {
                            select: {
                                studentClasses: true,
                                teacherClasses: true
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        classes: true,
                        studentSchools: true,
                        teacherSchools: true
                    }
                }
            }
        });
        
        if (!school) {
            return res.status(404).json({ message: 'School not found' });
        }
        
        return res.status(200).json(school);
    } catch (error) {
        console.error('Error fetching school details:', error);
        return res.status(500).json({ message: 'Server error while retrieving school details' });
    }
};

/**
 * Create a new school
 * @route POST /api/schools
 */
export const createSchool = async (req: Request, res: Response) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { name } = req.body;

    try {
        // Check if school with the same name already exists
        const existingSchool = await prisma.school.findFirst({
            where: { 
                name: {
                    equals: name,
                    mode: 'insensitive'
                }
            }
        });

        if (existingSchool) {
            return res.status(400).json({ message: 'A school with this name already exists' });
        }

        // Create the school
        const newSchool = await prisma.school.create({
            data: {
                name: name.trim()
            }
        });

        return res.status(201).json(newSchool);
    } catch (error) {
        console.error('Error creating school:', error);
        return res.status(500).json({ message: 'Server error while creating school' });
    }
};

/**
 * Update a school
 * @route PUT /api/schools/:id
 */
export const updateSchool = async (req: Request, res: Response) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { id } = req.params;
    const { name } = req.body;

    try {
        // Check if school exists
        const existingSchool = await prisma.school.findUnique({
            where: { id }
        });

        if (!existingSchool) {
            return res.status(404).json({ message: 'School not found' });
        }

        // Check if another school with the same name already exists (excluding current school)
        if (name) {
            const duplicateSchool = await prisma.school.findFirst({
                where: { 
                    name: {
                        equals: name,
                        mode: 'insensitive'
                    },
                    id: {
                        not: id
                    }
                }
            });

            if (duplicateSchool) {
                return res.status(400).json({ message: 'A school with this name already exists' });
            }
        }

        // Update the school
        const updatedSchool = await prisma.school.update({
            where: { id },
            data: {
                ...(name && { name: name.trim() })
            }
        });

        return res.status(200).json(updatedSchool);
    } catch (error) {
        console.error('Error updating school:', error);
        return res.status(500).json({ message: 'Server error while updating school' });
    }
};

/**
 * Archive a school
 * @route POST /api/schools/:id/archive
 */
export const archiveSchool = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Check if school exists
        const existingSchool = await prisma.school.findUnique({
            where: { id }
        });

        if (!existingSchool) {
            return res.status(404).json({ message: 'School not found' });
        }

        // Use a transaction to archive school, all its classes, and all associated students
        await prisma.$transaction(async (tx) => {
            // Archive the school
            await tx.school.update({
                where: { id },
                data: { isArchived: true }
            });

            // Archive all classes belonging to this school
            await tx.class.updateMany({
                where: { schoolId: id },
                data: { isArchived: true }
            });

            // Get all students associated with this school
            const studentSchools = await tx.studentSchool.findMany({
                where: { schoolId: id },
                select: { studentId: true }
            });

            const studentIds = studentSchools.map(ss => ss.studentId);

            // Archive all students who are only in this school (not in other active schools)
            if (studentIds.length > 0) {
                for (const studentId of studentIds) {
                    // Check if student has any other active schools
                    const activeSchoolCount = await tx.studentSchool.count({
                        where: {
                            studentId,
                            school: {
                                isArchived: false
                            },
                            schoolId: { not: id } // Exclude the current school being archived
                        }
                    });

                    // If student has no other active schools, archive them
                    if (activeSchoolCount === 0) {
                        await tx.user.update({
                            where: { id: studentId },
                            data: { isArchived: true }
                        });
                    }
                }
            }
        });

        return res.status(200).json({ 
            message: 'School and all associated classes and students archived successfully' 
        });
    } catch (error) {
        console.error('Archive school error:', error);
        return res.status(500).json({ message: 'Server error during school archiving' });
    }
};

/**
 * Unarchive a school
 * @route POST /api/schools/:id/unarchive
 */
export const unarchiveSchool = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Check if school exists
        const existingSchool = await prisma.school.findUnique({
            where: { id }
        });

        if (!existingSchool) {
            return res.status(404).json({ message: 'School not found' });
        }

        // Unarchive school by updating their status
        await prisma.school.update({
            where: { id },
            data: { isArchived: false }
        });

        return res.status(200).json({ message: 'School unarchived successfully' });
    } catch (error) {
        console.error('Unarchive school error:', error);
        return res.status(500).json({ message: 'Server error during school unarchiving' });
    }
};

/**
 * Delete a school (only if no classes or users are associated)
 * @route DELETE /api/schools/:id
 */
export const deleteSchool = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Check if school exists
        const existingSchool = await prisma.school.findUnique({
            where: { id },
            include: {
                _count: {
                    select: {
                        classes: true,
                        studentSchools: true,
                        teacherSchools: true,
                        adminSchools: true
                    }
                }
            }
        });

        if (!existingSchool) {
            return res.status(404).json({ message: 'School not found' });
        }

        // Check if school has any associated data
        const { _count } = existingSchool;
        if (_count.classes > 0 || _count.studentSchools > 0 || _count.teacherSchools > 0 || _count.adminSchools > 0) {
            return res.status(400).json({ 
                message: 'Cannot delete school with associated classes or users. Please archive it instead.' 
            });
        }

        // Delete the school
        await prisma.school.delete({
            where: { id }
        });

        return res.status(200).json({ message: 'School deleted successfully' });
    } catch (error) {
        console.error('Delete school error:', error);
        return res.status(500).json({ message: 'Server error during school deletion' });
    }
};
