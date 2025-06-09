import { Request, Response } from 'express';
import prisma from '../utils/prisma';

/**
 * Get overall analytics data within a date range
 * @route GET /api/analytics/overall
 */
export const getOverallAnalytics = async (req: Request, res: Response) => {
    try {
        const { startDate, endDate, schoolIds } = req.query;
        
        if (!startDate || !endDate) {
            return res.status(400).json({ message: 'Start date and end date are required' });
        }

        // Parse date strings to Date objects
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);
        
        // Build filter object
        const filter: any = {
            createdAt: {
                gte: start,
                lte: end
            }
        };

        // Add school filter if provided
        if (schoolIds) {
            const schoolIdArray = Array.isArray(schoolIds) ? schoolIds : [schoolIds];
            filter.class = {
                schoolId: {
                    in: schoolIdArray as string[]
                }
            };
        }
        
        // Get all worksheets in the date range with school filter
        const worksheets = await prisma.worksheet.findMany({
            where: filter
        });
        
        // Calculate analytics metrics
        const totalWorksheets = worksheets.length;
        const totalAbsent = worksheets.filter(w => w.isAbsent).length;
        const absentPercentage = totalWorksheets > 0 ? (totalAbsent / totalWorksheets) * 100 : 0;
        const totalRepeated = worksheets.filter(w => w.isRepeated).length;
        const repetitionRate = totalWorksheets > 0 ? (totalRepeated / totalWorksheets) * 100 : 0;
        
        const gradedWorksheets = worksheets.filter(w => w.grade !== null);
        const totalGraded = gradedWorksheets.length;
        
        // High score is 80% or higher of outOf
        const highScoreCount = gradedWorksheets.filter(w => {
            const outOf = w.outOf || 40; // Default to 40 if outOf is not set
            const minScore = outOf * 0.8; // 80% threshold
            return w.grade !== null && w.grade >= minScore;
        }).length;
        
        const highScorePercentage = totalGraded > 0 ? (highScoreCount / totalGraded) * 100 : 0;
        
        return res.status(200).json({
            totalWorksheets,
            totalAbsent,
            absentPercentage,
            totalRepeated,
            repetitionRate,
            highScoreCount,
            highScorePercentage,
            totalGraded
        });
    } catch (error) {
        console.error('Error getting overall analytics:', error);
        return res.status(500).json({ message: 'Server error while retrieving analytics data' });
    }
};

/**
 * Get overall worksheet analytics with date range filtering
 * @route GET /api/analytics/worksheets
 */
export const getWorksheetAnalytics = async (req: Request, res: Response) => {
    const { startDate, endDate, schoolId } = req.query;
    
    if (!startDate || !endDate) {
        return res.status(400).json({ message: 'Start and end dates are required' });
    }
    
    try {
        const start = new Date(startDate as string);
        const end = new Date(endDate as string);
        
        // Base filter
        const dateFilter = {
            submittedOn: {
                gte: start,
                lte: end
            }
        };
        
        // Additional school filter if provided
        const filter: any = { ...dateFilter };
        if (schoolId) {
            filter.class = {
                schoolId: schoolId as string
            };
        }
        
        // Get all worksheets within the date range
        const worksheets = await prisma.worksheet.findMany({
            where: filter,
            include: {
                class: {
                    select: {
                        id: true,
                        name: true,
                        schoolId: true,
                        school: {
                            select: {
                                id: true,
                                name: true
                            }
                        }
                    }
                }
            }
        });
        
        // Calculate analytics
        const totalWorksheets = worksheets.length;
        const totalAbsent = worksheets.filter(w => w.isAbsent).length;
        const totalRepeated = worksheets.filter(w => w.isRepeated).length;
        
        // Calculate high score percentage (≥80%)
        const highScoreThreshold = 8.0; // 80% of 10
        const highScores = worksheets.filter(w => !w.isAbsent && w.grade !== null && w.grade >= highScoreThreshold).length;
        const nonAbsentCount = totalWorksheets - totalAbsent;
        const highScorePercentage = nonAbsentCount > 0 ? (highScores / nonAbsentCount) * 100 : 0;
        
        // Calculate repetition rate
        const repetitionRate = nonAbsentCount > 0 ? (totalRepeated / nonAbsentCount) * 100 : 0;
        
        // Return compiled analytics
        res.status(200).json({
            totalWorksheets,
            totalAbsent,
            absentPercentage: totalWorksheets > 0 ? (totalAbsent / totalWorksheets) * 100 : 0,
            totalRepeated,
            repetitionRate,
            highScores,
            highScorePercentage,
            dateRange: {
                start: start.toISOString(),
                end: end.toISOString()
            }
        });
    } catch (error) {
        console.error('Error fetching worksheet analytics:', error);
        res.status(500).json({ message: 'Server error while retrieving analytics data' });
    }
};

/**
 * Get student-specific analytics
 * @route GET /api/analytics/students
 */
export const getStudentAnalytics = async (req: Request, res: Response) => {
    const { schoolId, classId } = req.query;
    
    try {
        // Base filters for student query
        const filter: any = {
            role: 'STUDENT',
        };
        
        // Apply class filter if provided
        if (classId) {
            filter.studentClasses = {
                some: {
                    classId: classId as string
                }
            };
        } 
        // Otherwise apply school filter if provided
        else if (schoolId) {
            filter.studentSchools = {
                some: {
                    schoolId: schoolId as string
                }
            };
        }
          // Get all students with their class information
        const students = await prisma.user.findMany({
            where: filter,
            select: {
                id: true,
                username: true,
                name: true,
                tokenNumber: true,
                studentClasses: {
                    include: {
                        class: {
                            include: {
                                school: true
                            }
                        }
                    }
                },
                studentWorksheets: {
                    select: {
                        id: true,
                        submittedOn: true,
                        isAbsent: true,
                        isRepeated: true
                    },
                    orderBy: {
                        submittedOn: 'asc'
                    }
                }
            },
            orderBy: {
                tokenNumber: 'asc'
            }
        });
        
        // Calculate analytics for each student
        const studentsWithAnalytics = students.map(student => {
            const worksheets = student.studentWorksheets;
            const totalWorksheets = worksheets.length;
            const absences = worksheets.filter(w => w.isAbsent).length;
            const repetitions = worksheets.filter(w => w.isRepeated).length;
            
            // Get first and last worksheet dates
            const worksheetsWithDates = worksheets.filter(w => w.submittedOn !== null);
            const firstWorksheet = worksheetsWithDates.length > 0 ? worksheetsWithDates[0] : null;
            const lastWorksheet = worksheetsWithDates.length > 0 ? worksheetsWithDates[worksheetsWithDates.length - 1] : null;
            
            // Class and school info
            const primaryClass = student.studentClasses[0]?.class;
            
            return {
                id: student.id,
                name: student.name,
                username: student.username,
                tokenNumber: student.tokenNumber,
                class: primaryClass ? primaryClass.name : 'No Class',
                school: primaryClass ? primaryClass.school.name : 'No School',
                totalWorksheets,
                absences,
                absentPercentage: totalWorksheets > 0 ? (absences / totalWorksheets) * 100 : 0,
                repetitions,
                repetitionRate: (totalWorksheets - absences) > 0 ? (repetitions / (totalWorksheets - absences)) * 100 : 0,
                firstWorksheetDate: firstWorksheet?.submittedOn ? firstWorksheet.submittedOn.toISOString() : null,
                lastWorksheetDate: lastWorksheet?.submittedOn ? lastWorksheet.submittedOn.toISOString() : null,
            };
        });
        
        res.status(200).json(studentsWithAnalytics);
    } catch (error) {
        console.error('Error fetching student analytics:', error);
        res.status(500).json({ message: 'Server error while retrieving student analytics data' });
    }
};

/**
 * Get all schools for filtering
 * @route GET /api/analytics/schools
 */
export const getAllSchools = async (req: Request, res: Response) => {
    try {
        const schools = await prisma.school.findMany({
            select: {
                id: true,
                name: true
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
 * Get school and class dropdown options for filtering
 * @route GET /api/analytics/filter-options
 */
export const getFilterOptions = async (req: Request, res: Response) => {
    try {
        // Get all schools
        const schools = await prisma.school.findMany({
            select: {
                id: true,
                name: true
            },
            orderBy: {
                name: 'asc'
            }
        });
        
        // Get all classes
        const classes = await prisma.class.findMany({
            select: {
                id: true,
                name: true,
                schoolId: true
            },
            orderBy: {
                name: 'asc'
            }
        });
        
        res.status(200).json({ schools, classes });
    } catch (error) {
        console.error('Error fetching filter options:', error);
        res.status(500).json({ message: 'Server error while retrieving filter options' });
    }
};

/**
 * Get classes for a school
 * @route GET /api/analytics/schools/:schoolId/classes
 */
export const getClassesBySchool = async (req: Request, res: Response) => {
    try {
        const { schoolId } = req.params;
        
        const classes = await prisma.class.findMany({
            where: {
                schoolId
            },
            select: {
                id: true,
                name: true,
                schoolId: true
            },
            orderBy: {
                name: 'asc'
            }
        });
        
        return res.status(200).json(classes);
    } catch (error) {
        console.error('Error getting classes by school:', error);
        return res.status(500).json({ message: 'Server error while retrieving classes' });
    }
};

/**
 * Manage students in classes (add/remove)
 * @route POST /api/analytics/students/manage
 */
export const manageStudentClass = async (req: Request, res: Response) => {
    const { action, studentId, classId } = req.body;
    
    if (!action || !studentId || !classId) {
        return res.status(400).json({ message: 'Action, student ID, and class ID are required' });
    }
    
    try {
        if (action === 'add') {
            // Check if the student is already in the class
            const existingRelation = await prisma.studentClass.findUnique({
                where: {
                    studentId_classId: {
                        studentId,
                        classId
                    }
                }
            });
            
            if (existingRelation) {
                return res.status(400).json({ message: 'Student is already in this class' });
            }
            
            // Add student to class
            await prisma.studentClass.create({
                data: {
                    studentId,
                    classId
                }
            });
            
            res.status(201).json({ message: 'Student added to class successfully' });
        } else if (action === 'remove') {
            // Remove student from class
            await prisma.studentClass.delete({
                where: {
                    studentId_classId: {
                        studentId,
                        classId
                    }
                }
            });
            
            res.status(200).json({ message: 'Student removed from class successfully' });
        } else {
            res.status(400).json({ message: 'Invalid action. Use "add" or "remove".' });
        }
    } catch (error) {
        console.error('Error managing student class assignment:', error);
        res.status(500).json({ message: 'Server error while managing student class assignment' });
    }
};

/**
 * Remove a student from a class
 * @route DELETE /api/analytics/students/:studentId/classes/:classId
 */
export const removeStudentFromClass = async (req: Request, res: Response) => {
    try {
        const { studentId, classId } = req.params;
        
        // Check if student exists and is in the class
        const studentClass = await prisma.studentClass.findUnique({
            where: {
                studentId_classId: {
                    studentId,
                    classId
                }
            }
        });
        
        if (!studentClass) {
            return res.status(404).json({ message: 'Student is not in this class' });
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
 * Add a student to a class
 * @route POST /api/analytics/students/:studentId/classes/:classId
 */
export const addStudentToClass = async (req: Request, res: Response) => {
    try {
        const { studentId, classId } = req.params;
        
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
        
        // Check if class exists
        const classEntity = await prisma.class.findUnique({
            where: {
                id: classId
            }
        });
        
        if (!classEntity) {
            return res.status(404).json({ message: 'Class not found' });
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
            return res.status(400).json({ message: 'Student is already in this class' });
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
 * Download student analytics as CSV
 * @route GET /api/analytics/students/download
 */
export const downloadStudentAnalytics = async (req: Request, res: Response) => {
    const { schoolId, classId, format = 'csv' } = req.query;
    
    try {
        // Base filters for student query (same as getStudentAnalytics)
        const filter: any = {
            role: 'STUDENT',
        };
        
        // Apply class filter if provided
        if (classId) {
            filter.studentClasses = {
                some: {
                    classId: classId as string
                }
            };
        } 
        // Otherwise apply school filter if provided
        else if (schoolId) {
            filter.studentSchools = {
                some: {
                    schoolId: schoolId as string
                }
            };
        }
        
        // Get all students with their class information
        const students = await prisma.user.findMany({
            where: filter,
            select: {
                id: true,
                username: true,
                name: true,
                tokenNumber: true,
                studentClasses: {
                    include: {
                        class: {
                            include: {
                                school: true
                            }
                        }
                    }
                },
                studentWorksheets: {
                    select: {
                        id: true,
                        submittedOn: true,
                        isAbsent: true,
                        isRepeated: true,
                        grade: true
                    },
                    orderBy: {
                        submittedOn: 'asc'
                    }
                }
            }
        });
        
        // Calculate analytics for each student
        const studentsWithAnalytics = students.map(student => {
            const worksheets = student.studentWorksheets;
            const totalWorksheets = worksheets.length;
            const absences = worksheets.filter(w => w.isAbsent).length;
            const repetitions = worksheets.filter(w => w.isRepeated).length;
            
            // Get first and last worksheet dates
            const worksheetsWithDates = worksheets.filter(w => w.submittedOn !== null);
            const firstWorksheet = worksheetsWithDates.length > 0 ? worksheetsWithDates[0] : null;
            const lastWorksheet = worksheetsWithDates.length > 0 ? worksheetsWithDates[worksheetsWithDates.length - 1] : null;
            
            // Class and school info
            const primaryClass = student.studentClasses[0]?.class;
            
            // Calculate average grade (excluding absent worksheets)
            const gradedWorksheets = worksheets.filter(w => !w.isAbsent && w.grade !== null);
            const averageGrade = gradedWorksheets.length > 0 
                ? gradedWorksheets.reduce((sum, w) => sum + (w.grade || 0), 0) / gradedWorksheets.length 
                : 0;
            
            return {
                id: student.id,
                name: student.name,
                username: student.username,
                tokenNumber: student.tokenNumber || '',
                class: primaryClass ? primaryClass.name : 'No Class',
                school: primaryClass ? primaryClass.school.name : 'No School',
                totalWorksheets,
                absences,
                absentPercentage: totalWorksheets > 0 ? Number((absences / totalWorksheets * 100).toFixed(2)) : 0,
                repetitions,
                repetitionRate: (totalWorksheets - absences) > 0 ? Number((repetitions / (totalWorksheets - absences) * 100).toFixed(2)) : 0,
                averageGrade: Number(averageGrade.toFixed(2)),
                firstWorksheetDate: firstWorksheet?.submittedOn ? firstWorksheet.submittedOn.toISOString().split('T')[0] : '',
                lastWorksheetDate: lastWorksheet?.submittedOn ? lastWorksheet.submittedOn.toISOString().split('T')[0] : '',
            };
        });
        
        if (format === 'csv') {
            // Generate CSV
            const csvHeaders = [
                'Name',
                'Username', 
                'Token Number',
                'School',
                'Class',
                'Total Worksheets',
                'Absences',
                'Absent Percentage (%)',
                'Repetitions',
                'Repetition Rate (%)',
                'Average Grade',
                'First Worksheet Date',
                'Last Worksheet Date'
            ];
            
            const csvRows = studentsWithAnalytics.map(student => [
                `"${student.name}"`,
                `"${student.username}"`,
                `"${student.tokenNumber}"`,
                `"${student.school}"`,
                `"${student.class}"`,
                student.totalWorksheets,
                student.absences,
                student.absentPercentage,
                student.repetitions,
                student.repetitionRate,
                student.averageGrade,
                `"${student.firstWorksheetDate}"`,
                `"${student.lastWorksheetDate}"`
            ]);
            
            const csvContent = [csvHeaders.join(','), ...csvRows.map(row => row.join(','))].join('\n');
            
            // Set response headers for CSV download
            const timestamp = new Date().toISOString().split('T')[0];
            const filename = `student_analytics_${timestamp}.csv`;
            
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
            res.status(200).send(csvContent);
        } else {
            // Return JSON if format is not CSV
            res.status(200).json(studentsWithAnalytics);
        }
    } catch (error) {
        console.error('Error downloading student analytics:', error);
        res.status(500).json({ message: 'Server error while downloading student analytics data' });
    }
};