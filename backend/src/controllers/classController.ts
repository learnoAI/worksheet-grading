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
        
        // Use a transaction to archive class and all its students
        const archivedClass = await prisma.$transaction(async (tx) => {
            // Archive the class
            const archived = await tx.class.update({
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

            // Get all students in this class
            const studentClasses = await tx.studentClass.findMany({
                where: { classId: id },
                select: { studentId: true }
            });

            const studentIds = studentClasses.map(sc => sc.studentId);

            // Archive students who are only in this class (not in other active classes)
            if (studentIds.length > 0) {
                for (const studentId of studentIds) {
                    // Check if student has any other active classes
                    const activeClassCount = await tx.studentClass.count({
                        where: {
                            studentId,
                            class: {
                                isArchived: false
                            },
                            classId: { not: id } // Exclude the current class being archived
                        }
                    });

                    // If student has no other active classes, archive them
                    if (activeClassCount === 0) {
                        await tx.user.update({
                            where: { id: studentId },
                            data: { isArchived: true }
                        });
                    }
                }
            }

            return archived;
        });
        
        return res.status(200).json({
            message: `Class "${existingClass.name}" from ${existingClass.school.name} and all associated students have been archived`,
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

/**
 * Bulk archive all active classes for a given academic year
 * @route POST /api/classes/archive-by-year
 */
export const archiveClassesByYear = async (req: Request, res: Response) => {
    try {
        const { academicYear, schoolId } = req.body;

        if (!academicYear) {
            return res.status(400).json({ message: 'Academic year is required' });
        }

        // Build filter — optionally scope to a single school
        const whereConditions: any = {
            academicYear: academicYear.trim(),
            isArchived: false
        };

        if (schoolId) {
            whereConditions.schoolId = schoolId;
        }

        // Find all active classes for this academic year (and school if provided)
        const activeClasses = await prisma.class.findMany({
            where: whereConditions,
            select: { id: true, name: true, schoolId: true }
        });

        if (activeClasses.length === 0) {
            return res.status(404).json({ message: `No active classes found for academic year ${academicYear}${schoolId ? ' in selected school' : ''}` });
        }

        const classIds = activeClasses.map(c => c.id);

        const result = await prisma.$transaction(async (tx) => {
            // Archive all classes
            const archivedCount = await tx.class.updateMany({
                where: { id: { in: classIds } },
                data: { isArchived: true }
            });

            // Get all students in these classes
            const studentClasses = await tx.studentClass.findMany({
                where: { classId: { in: classIds } },
                select: { studentId: true }
            });

            const uniqueStudentIds = [...new Set(studentClasses.map(sc => sc.studentId))];
            let archivedStudentCount = 0;

            // Archive students who have no other active classes
            for (const studentId of uniqueStudentIds) {
                const activeClassCount = await tx.studentClass.count({
                    where: {
                        studentId,
                        class: { isArchived: false }
                    }
                });

                if (activeClassCount === 0) {
                    await tx.user.update({
                        where: { id: studentId },
                        data: { isArchived: true }
                    });
                    archivedStudentCount++;
                }
            }

            return { archivedClassCount: archivedCount.count, archivedStudentCount };
        });

        return res.status(200).json({
            message: `Archived ${result.archivedClassCount} classes and ${result.archivedStudentCount} students for academic year ${academicYear}`,
            ...result
        });
    } catch (error) {
        console.error('Error bulk archiving classes:', error);
        return res.status(500).json({ message: 'Server error while bulk archiving classes' });
    }
};

/**
 * Upload class-teacher mapping CSV for a school
 * @route POST /api/classes/upload-class-teachers
 */
export const uploadClassTeachersCsv = async (req: Request, res: Response) => {
    const { schoolId, rows } = req.body;

    if (!schoolId) {
        return res.status(400).json({ message: 'School ID is required' });
    }

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: 'No data provided' });
    }

    const results = {
        classesCreated: 0,
        teachersAssigned: 0,
        errors: [] as string[]
    };

    try {
        const school = await prisma.school.findUnique({ where: { id: schoolId } });
        if (!school) {
            return res.status(404).json({ message: 'School not found' });
        }

        for (const row of rows) {
            const { className, academicYear, teacherUsername } = row;

            if (!className || !academicYear || !teacherUsername) {
                results.errors.push(`Missing required fields in row: ${JSON.stringify(row)}`);
                continue;
            }

            try {
                // Find or create class
                let classEntity = await prisma.class.findFirst({
                    where: {
                        name: className.trim(),
                        schoolId,
                        academicYear: academicYear.trim()
                    }
                });

                if (!classEntity) {
                    classEntity = await prisma.class.create({
                        data: {
                            name: className.trim(),
                            schoolId,
                            academicYear: academicYear.trim()
                        }
                    });
                    results.classesCreated++;
                }

                // Find teacher by username
                const teacher = await prisma.user.findFirst({
                    where: {
                        username: teacherUsername.trim(),
                        role: 'TEACHER'
                    }
                });

                if (!teacher) {
                    results.errors.push(`Teacher not found: ${teacherUsername}`);
                    continue;
                }

                // Assign teacher to class if not already assigned
                const existingTeacherClass = await prisma.teacherClass.findUnique({
                    where: {
                        teacherId_classId: {
                            teacherId: teacher.id,
                            classId: classEntity.id
                        }
                    }
                });

                if (!existingTeacherClass) {
                    await prisma.teacherClass.create({
                        data: {
                            teacherId: teacher.id,
                            classId: classEntity.id
                        }
                    });

                    // Ensure teacher is linked to school
                    const existingTeacherSchool = await prisma.teacherSchool.findUnique({
                        where: {
                            teacherId_schoolId: {
                                teacherId: teacher.id,
                                schoolId
                            }
                        }
                    });

                    if (!existingTeacherSchool) {
                        await prisma.teacherSchool.create({
                            data: { teacherId: teacher.id, schoolId }
                        });
                    }

                    results.teachersAssigned++;
                }
            } catch (error) {
                console.error('Error processing row:', row, error);
                results.errors.push(`Failed to process: ${className} / ${teacherUsername}`);
            }
        }

        return res.status(200).json({
            message: `Created ${results.classesCreated} classes, assigned ${results.teachersAssigned} teachers`,
            results
        });
    } catch (error) {
        console.error('Error uploading class-teacher CSV:', error);
        return res.status(500).json({ message: 'Server error during class-teacher CSV upload' });
    }
};

/**
 * Upload student-class mapping CSV for a school
 * @route POST /api/classes/upload-student-classes
 */
export const uploadStudentClassesCsv = async (req: Request, res: Response) => {
    const { schoolId, rows } = req.body;

    if (!schoolId) {
        return res.status(400).json({ message: 'School ID is required' });
    }

    if (!rows || !Array.isArray(rows) || rows.length === 0) {
        return res.status(400).json({ message: 'No data provided' });
    }

    const results = {
        studentsAssigned: 0,
        studentsCreated: 0,
        errors: [] as string[]
    };

    try {
        const school = await prisma.school.findUnique({ where: { id: schoolId } });
        if (!school) {
            return res.status(404).json({ message: 'School not found' });
        }

        for (const row of rows) {
            const { tokenNumber, studentName, className, academicYear } = row;

            if (!tokenNumber || !studentName || !className || !academicYear) {
                results.errors.push(`Missing required fields in row: ${JSON.stringify(row)}`);
                continue;
            }

            try {
                // Find class
                const classEntity = await prisma.class.findFirst({
                    where: {
                        name: className.trim(),
                        schoolId,
                        academicYear: academicYear.trim()
                    }
                });

                if (!classEntity) {
                    results.errors.push(`Class not found: ${className} (${academicYear}) — upload class-teacher CSV first`);
                    continue;
                }

                // Find or create student
                let student = await prisma.user.findFirst({
                    where: { tokenNumber: tokenNumber.trim() }
                });

                if (!student) {
                    const bcrypt = await import('bcrypt');
                    const username = studentName.trim().toLowerCase().replace(/\s+/g, '_') + '_' + tokenNumber.trim();
                    const salt = await bcrypt.genSalt(10);
                    const hashedPassword = await bcrypt.hash('saarthi@123', salt);

                    student = await prisma.user.create({
                        data: {
                            name: studentName.trim(),
                            username,
                            password: hashedPassword,
                            role: 'STUDENT',
                            tokenNumber: tokenNumber.trim()
                        }
                    });
                    results.studentsCreated++;
                } else {
                    // Unarchive student if they were previously archived
                    if (student.isArchived) {
                        await prisma.user.update({
                            where: { id: student.id },
                            data: { isArchived: false }
                        });
                    }
                }

                // Assign student to class if not already assigned
                const existingStudentClass = await prisma.studentClass.findUnique({
                    where: {
                        studentId_classId: {
                            studentId: student.id,
                            classId: classEntity.id
                        }
                    }
                });

                if (!existingStudentClass) {
                    await prisma.studentClass.create({
                        data: {
                            studentId: student.id,
                            classId: classEntity.id
                        }
                    });
                    results.studentsAssigned++;
                }

                // Ensure student is linked to school
                const existingStudentSchool = await prisma.studentSchool.findUnique({
                    where: {
                        studentId_schoolId: {
                            studentId: student.id,
                            schoolId
                        }
                    }
                });

                if (!existingStudentSchool) {
                    await prisma.studentSchool.create({
                        data: { studentId: student.id, schoolId }
                    });
                }
            } catch (error) {
                console.error('Error processing row:', row, error);
                results.errors.push(`Failed to process student: ${studentName} (${tokenNumber})`);
            }
        }

        return res.status(200).json({
            message: `Assigned ${results.studentsAssigned} students (${results.studentsCreated} newly created)`,
            results
        });
    } catch (error) {
        console.error('Error uploading student-class CSV:', error);
        return res.status(500).json({ message: 'Server error during student-class CSV upload' });
    }
};

/**
 * Create a new class
 * @route POST /api/classes
 */
export const createClass = async (req: Request, res: Response) => {
    const { name, schoolId, academicYear } = req.body;

    try {
        // Validate input
        if (!name || !schoolId || !academicYear) {
            return res.status(400).json({ message: 'Name, school ID, and academic year are required' });
        }

        // Check if school exists
        const school = await prisma.school.findUnique({
            where: { id: schoolId }
        });

        if (!school) {
            return res.status(404).json({ message: 'School not found' });
        }

        // Check if class with same name already exists in this school
        const existingClass = await prisma.class.findFirst({
            where: {
                name: name.trim(),
                schoolId,
                academicYear: academicYear.trim()
            }
        });

        if (existingClass) {
            return res.status(400).json({ message: 'A class with this name already exists in this school for this academic year' });
        }

        // Create the class
        const newClass = await prisma.class.create({
            data: {
                name: name.trim(),
                schoolId,
                academicYear: academicYear.trim()
            },
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

        return res.status(201).json(newClass);
    } catch (error) {
        console.error('Error creating class:', error);
        return res.status(500).json({ message: 'Server error while creating class' });
    }
};
