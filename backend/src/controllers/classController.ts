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

/**
 * Add a teacher to a class
 * @route POST /api/classes/:id/teachers/:teacherId
 */
export const addTeacherToClass = async (req: Request, res: Response) => {
    const { id: classId, teacherId } = req.params;

    try {
        // Check if class exists
        const classEntity = await prisma.class.findUnique({
            where: { id: classId }
        });

        if (!classEntity) {
            return res.status(404).json({ message: 'Class not found' });
        }

        // Check if teacher exists
        const teacher = await prisma.user.findUnique({
            where: { 
                id: teacherId,
                role: 'TEACHER'
            }
        });

        if (!teacher) {
            return res.status(404).json({ message: 'Teacher not found' });
        }

        // Check if teacher is already in class
        const existingTeacherClass = await prisma.teacherClass.findUnique({
            where: {
                teacherId_classId: {
                    teacherId,
                    classId
                }
            }
        });

        if (existingTeacherClass) {
            return res.status(400).json({ message: 'Teacher is already assigned to this class' });
        }

        // Add teacher to class
        const newTeacherClass = await prisma.teacherClass.create({
            data: {
                teacherId,
                classId
            }
        });

        // Add teacher to school if not already added
        const schoolId = classEntity.schoolId;
        
        const existingTeacherSchool = await prisma.teacherSchool.findUnique({
            where: {
                teacherId_schoolId: {
                    teacherId,
                    schoolId
                }
            }
        });

        if (!existingTeacherSchool) {
            await prisma.teacherSchool.create({
                data: {
                    teacherId,
                    schoolId
                }
            });
        }

        return res.status(201).json(newTeacherClass);
    } catch (error) {
        console.error('Error adding teacher to class:', error);
        return res.status(500).json({ message: 'Server error while adding teacher to class' });
    }
};

/**
 * Remove a teacher from a class
 * @route DELETE /api/classes/:id/teachers/:teacherId
 */
export const removeTeacherFromClass = async (req: Request, res: Response) => {
    const { id: classId, teacherId } = req.params;

    try {
        // Check if teacher-class relationship exists
        const teacherClass = await prisma.teacherClass.findUnique({
            where: {
                teacherId_classId: {
                    teacherId,
                    classId
                }
            }
        });

        if (!teacherClass) {
            return res.status(404).json({ message: 'Teacher is not assigned to this class' });
        }

        // Remove teacher from class
        await prisma.teacherClass.delete({
            where: {
                teacherId_classId: {
                    teacherId,
                    classId
                }
            }
        });

        return res.status(200).json({ message: 'Teacher removed from class successfully' });
    } catch (error) {
        console.error('Error removing teacher from class:', error);
        return res.status(500).json({ message: 'Server error while removing teacher from class' });
    }
};

/**
 * Get teachers for a specific class
 * @route GET /api/classes/:id/teachers
 */
export const getClassTeachers = async (req: Request, res: Response) => {
    const { id: classId } = req.params;

    try {
        const teachers = await prisma.user.findMany({
            where: {
                role: 'TEACHER',
                teacherClasses: {
                    some: {
                        classId
                    }
                }
            },
            select: {
                id: true,
                name: true,
                username: true,
                createdAt: true
            }
        });

        return res.status(200).json(teachers);
    } catch (error) {
        console.error('Error getting class teachers:', error);
        return res.status(500).json({ message: 'Server error while retrieving class teachers' });
    }
};

/**
 * Get available teachers (not assigned to a specific class)
 * @route GET /api/classes/teachers/available/:classId
 */
export const getAvailableTeachers = async (req: Request, res: Response) => {
    const { classId } = req.params;

    try {
        const teachers = await prisma.user.findMany({
            where: {
                role: 'TEACHER',
                isArchived: false,
                teacherClasses: {
                    none: {
                        classId
                    }
                }
            },
            select: {
                id: true,
                name: true,
                username: true,
                createdAt: true
            },
            orderBy: {
                name: 'asc'
            }
        });

        return res.status(200).json(teachers);
    } catch (error) {
        console.error('Error getting available teachers:', error);
        return res.status(500).json({ message: 'Server error while retrieving available teachers' });
    }
};

/**
 * Get students for a specific class
 * @route GET /api/classes/:id/students
 */
export const getClassStudents = async (req: Request, res: Response) => {
    const { id: classId } = req.params;

    try {
        const students = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                studentClasses: {
                    some: {
                        classId
                    }
                }
            },
            select: {
                id: true,
                name: true,
                username: true,
                tokenNumber: true,
                isArchived: true,
                createdAt: true
            },
            orderBy: {
                tokenNumber: 'asc'
            }
        });

        return res.status(200).json(students);
    } catch (error) {
        console.error('Error getting class students:', error);
        return res.status(500).json({ message: 'Server error while retrieving class students' });
    }
};

/**
 * Get available students (not assigned to a specific class)
 * @route GET /api/classes/students/available/:classId
 */
export const getAvailableStudents = async (req: Request, res: Response) => {
    const { classId } = req.params;

    try {
        // Get the school ID for this class
        const classEntity = await prisma.class.findUnique({
            where: { id: classId },
            select: { schoolId: true }
        });

        if (!classEntity) {
            return res.status(404).json({ message: 'Class not found' });
        }

        const students = await prisma.user.findMany({
            where: {
                role: 'STUDENT',
                isArchived: false,
                studentClasses: {
                    none: {
                        classId
                    }
                },
                studentSchools: {
                    some: {
                        schoolId: classEntity.schoolId
                    }
                }
            },
            select: {
                id: true,
                name: true,
                username: true,
                tokenNumber: true,
                createdAt: true
            },
            orderBy: {
                tokenNumber: 'asc'
            }
        });

        return res.status(200).json(students);
    } catch (error) {
        console.error('Error getting available students:', error);
        return res.status(500).json({ message: 'Server error while retrieving available students' });
    }
};

/**
 * Add a student to a class
 * @route POST /api/classes/:id/students/:studentId
 */
export const addStudentToClass = async (req: Request, res: Response) => {
    const { id: classId, studentId } = req.params;

    try {
        // Check if class exists
        const classEntity = await prisma.class.findUnique({
            where: { id: classId }
        });

        if (!classEntity) {
            return res.status(404).json({ message: 'Class not found' });
        }

        // Check if student exists
        const student = await prisma.user.findUnique({
            where: { 
                id: studentId,
                role: 'STUDENT'
            }
        });

        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        // Check if student is already in class
        const existingStudentClass = await prisma.studentClass.findUnique({
            where: {
                studentId_classId: {
                    studentId,
                    classId
                }
            }
        });

        if (existingStudentClass) {
            return res.status(400).json({ message: 'Student is already assigned to this class' });
        }

        // Add student to class
        const newStudentClass = await prisma.studentClass.create({
            data: {
                studentId,
                classId
            }
        });

        // Add student to school if not already added
        const schoolId = classEntity.schoolId;
        
        const existingStudentSchool = await prisma.studentSchool.findUnique({
            where: {
                studentId_schoolId: {
                    studentId,
                    schoolId
                }
            }
        });

        if (!existingStudentSchool) {
            await prisma.studentSchool.create({
                data: {
                    studentId,
                    schoolId
                }
            });
        }

        return res.status(201).json(newStudentClass);
    } catch (error) {
        console.error('Error adding student to class:', error);
        return res.status(500).json({ message: 'Server error while adding student to class' });
    }
};

/**
 * Remove a student from a class
 * @route DELETE /api/classes/:id/students/:studentId
 */
export const removeStudentFromClass = async (req: Request, res: Response) => {
    const { id: classId, studentId } = req.params;

    try {
        // Check if student-class relationship exists
        const studentClass = await prisma.studentClass.findUnique({
            where: {
                studentId_classId: {
                    studentId,
                    classId
                }
            }
        });

        if (!studentClass) {
            return res.status(404).json({ message: 'Student is not assigned to this class' });
        }

        // Remove student from class
        await prisma.studentClass.delete({
            where: {
                studentId_classId: {
                    studentId,
                    classId
                }
            }
        });

        return res.status(200).json({ message: 'Student removed from class successfully' });
    } catch (error) {
        console.error('Error removing student from class:', error);
        return res.status(500).json({ message: 'Server error while removing student from class' });
    }
};
