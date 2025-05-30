import { Request, Response } from 'express';
import prisma from '../utils/prisma';

/**
 * Get all classes for superadmin with archive status
 * @route GET /api/classes
 */
export const getAllClasses = async (req: Request, res: Response) => {
    try {
        const { includeArchived = 'false', schoolId } = req.query;
        
        // Build filter conditions
        const whereConditions: any = {};
        
        // Filter by archive status unless explicitly requesting archived classes
        if (includeArchived !== 'true') {
            whereConditions.isArchived = false;
        }
        
        // Filter by school if provided
        if (schoolId) {
            whereConditions.schoolId = schoolId as string;
        }
        
        const classes = await prisma.class.findMany({
            where: whereConditions,
            include: {
                school: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                _count: {
                    select: {
                        studentClasses: true,
                        teacherClasses: true,
                        worksheets: true
                    }
                }
            },
            orderBy: [
                { isArchived: 'asc' }, // Show active classes first
                { school: { name: 'asc' } },
                { name: 'asc' }
            ]
        });
        
        return res.status(200).json(classes);
    } catch (error) {
        console.error('Error fetching classes:', error);
        return res.status(500).json({ message: 'Server error while retrieving classes' });
    }
};

/**
 * Get archived classes only
 * @route GET /api/classes/archived
 */
export const getArchivedClasses = async (req: Request, res: Response) => {
    try {
        const { schoolId } = req.query;
        
        const whereConditions: any = {
            isArchived: true
        };
        
        if (schoolId) {
            whereConditions.schoolId = schoolId as string;
        }
        
        const archivedClasses = await prisma.class.findMany({
            where: whereConditions,
            include: {
                school: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                _count: {
                    select: {
                        studentClasses: true,
                        teacherClasses: true,
                        worksheets: true
                    }
                }
            },
            orderBy: [
                { school: { name: 'asc' } },
                { name: 'asc' }
            ]
        });
        
        return res.status(200).json(archivedClasses);
    } catch (error) {
        console.error('Error fetching archived classes:', error);
        return res.status(500).json({ message: 'Server error while retrieving archived classes' });
    }
};

/**
 * Archive a class
 * @route POST /api/classes/:id/archive
 */
export const archiveClass = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        
        // Check if class exists
        const existingClass = await prisma.class.findUnique({
            where: { id },
            include: {
                school: {
                    select: {
                        name: true
                    }
                }
            }
        });
        
        if (!existingClass) {
            return res.status(404).json({ message: 'Class not found' });
        }
        
        // Check if class is already archived
        if (existingClass.isArchived) {
            return res.status(400).json({ message: 'Class is already archived' });
        }
        
        // Archive the class
        const archivedClass = await prisma.class.update({
            where: { id },
            data: { isArchived: true },
            include: {
                school: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                _count: {
                    select: {
                        studentClasses: true,
                        teacherClasses: true,
                        worksheets: true
                    }
                }
            }
        });
        
        return res.status(200).json({
            message: `Class "${existingClass.name}" from ${existingClass.school.name} has been archived`,
            class: archivedClass
        });
    } catch (error) {
        console.error('Error archiving class:', error);
        return res.status(500).json({ message: 'Server error while archiving class' });
    }
};

/**
 * Unarchive a class
 * @route POST /api/classes/:id/unarchive
 */
export const unarchiveClass = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        
        // Check if class exists
        const existingClass = await prisma.class.findUnique({
            where: { id },
            include: {
                school: {
                    select: {
                        name: true
                    }
                }
            }
        });
        
        if (!existingClass) {
            return res.status(404).json({ message: 'Class not found' });
        }
        
        // Check if class is actually archived
        if (!existingClass.isArchived) {
            return res.status(400).json({ message: 'Class is not archived' });
        }
        
        // Unarchive the class
        const unarchivedClass = await prisma.class.update({
            where: { id },
            data: { isArchived: false },
            include: {
                school: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                _count: {
                    select: {
                        studentClasses: true,
                        teacherClasses: true,
                        worksheets: true
                    }
                }
            }
        });
        
        return res.status(200).json({
            message: `Class "${existingClass.name}" from ${existingClass.school.name} has been unarchived`,
            class: unarchivedClass
        });
    } catch (error) {
        console.error('Error unarchiving class:', error);
        return res.status(500).json({ message: 'Server error while unarchiving class' });
    }
};

/**
 * Get class details by ID
 * @route GET /api/classes/:id
 */
export const getClassById = async (req: Request, res: Response) => {
    try {
        const { id } = req.params;
        
        const classEntity = await prisma.class.findUnique({
            where: { id },
            include: {
                school: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                studentClasses: {
                    include: {
                        student: {
                            select: {
                                id: true,
                                name: true,
                                username: true,
                                tokenNumber: true
                            }
                        }
                    }
                },
                teacherClasses: {
                    include: {
                        teacher: {
                            select: {
                                id: true,
                                name: true,
                                username: true
                            }
                        }
                    }
                },
                _count: {
                    select: {
                        worksheets: true
                    }
                }
            }
        });
        
        if (!classEntity) {
            return res.status(404).json({ message: 'Class not found' });
        }
        
        return res.status(200).json(classEntity);
    } catch (error) {
        console.error('Error fetching class details:', error);
        return res.status(500).json({ message: 'Server error while retrieving class details' });
    }
};
