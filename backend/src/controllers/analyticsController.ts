import { Request, Response } from 'express';
import { Prisma } from '@prisma/client';
import prisma, { withDatabaseRetry } from '../utils/prisma';

// Simple in-memory cache for analytics results (5 minute TTL)
interface CacheEntry {
    data: any;
    timestamp: number;
}

const analyticsCache = new Map<string, CacheEntry>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

function getCacheKey(params: Record<string, any>): string {
    return JSON.stringify(params);
}

function setCache(key: string, data: any): void {
    analyticsCache.set(key, {
        data,
        timestamp: Date.now()
    });
}

function getCache(key: string): any | null {
    const entry = analyticsCache.get(key);
    if (!entry) return null;
    
    // Check if cache entry is expired
    if (Date.now() - entry.timestamp > CACHE_TTL) {
        analyticsCache.delete(key);
        return null;
    }
    
    return entry.data;
}

// Clean expired cache entries every 10 minutes
setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of analyticsCache.entries()) {
        if (now - entry.timestamp > CACHE_TTL) {
            analyticsCache.delete(key);
        }
    }
}, 10 * 60 * 1000);

/**
 * Convert date strings to full day ranges
 * If start and end dates are the same, includes the full day (00:00:00 to 23:59:59)
 */
function convertToFullDayRange(startDateStr: string, endDateStr: string) {
    const start = new Date(startDateStr);
    const end = new Date(endDateStr);
    
    // Set start date to beginning of day (00:00:00)
    start.setHours(0, 0, 0, 0);
    
    // Set end date to end of day (23:59:59.999)
    end.setHours(23, 59, 59, 999);
    
    return { start, end };
}

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

        // Create cache key from request parameters
        const cacheKey = getCacheKey({ startDate, endDate, schoolIds });
        
        // Check cache first
        const cachedResult = getCache(cacheKey);
        if (cachedResult) {
            return res.status(200).json(cachedResult);
        }

        // Parse date strings to Date objects with full day range
        const { start, end } = convertToFullDayRange(startDate as string, endDate as string);
        
        // Build filter object
        const filter: any = {
            submittedOn: {
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
        
        // Use parallel aggregation queries for better performance with retry
        const [
            totalStats,
            absentStats,
            repeatedStats,
            gradedStats,
            highScoreStats,
            excellenceStats
        ] = await withDatabaseRetry(async () => 
            Promise.all([
                // Total worksheets count
                prisma.worksheet.count({
                    where: filter
                }),
            
            // Absent worksheets count
            prisma.worksheet.count({
                where: {
                    ...filter,
                    isAbsent: true
                }
            }),
            
            // Repeated worksheets count
            prisma.worksheet.count({
                where: {
                    ...filter,
                    isRepeated: true
                }
            }),
            
            // Graded non-absent worksheets count
            prisma.worksheet.count({
                where: {
                    ...filter,
                    grade: { not: null },
                    isAbsent: false
                }
            }),
            
            // High score count (≥80%) - use raw query for performance
            prisma.$queryRaw<Array<{count: bigint}>>`
                SELECT COUNT(*)::bigint as count
                FROM "Worksheet" w
                LEFT JOIN "Class" c ON w."classId" = c.id
                WHERE w."submittedOn" >= ${start}::timestamp
                AND w."submittedOn" <= ${end}::timestamp
                AND w.grade IS NOT NULL
                AND w."isAbsent" = false
                AND w.grade >= (COALESCE(w."outOf", 40) * 0.8)
                ${schoolIds ? 
                    Prisma.sql`AND c."schoolId" = ANY(${Array.isArray(schoolIds) ? schoolIds : [schoolIds]}::text[])`
                    : Prisma.empty}
            `,
            
            // Excellence score count (≥90%) - use raw query for performance
            prisma.$queryRaw<Array<{count: bigint}>>`
                SELECT COUNT(*)::bigint as count
                FROM "Worksheet" w
                LEFT JOIN "Class" c ON w."classId" = c.id
                WHERE w."submittedOn" >= ${start}::timestamp
                AND w."submittedOn" <= ${end}::timestamp
                AND w.grade IS NOT NULL
                AND w."isAbsent" = false
                AND w.grade >= (COALESCE(w."outOf", 40) * 0.9)
                ${schoolIds ? 
                    Prisma.sql`AND c."schoolId" = ANY(${Array.isArray(schoolIds) ? schoolIds : [schoolIds]}::text[])`
                    : Prisma.empty}
            `
        ])
        );

        // Calculate metrics from aggregated data
        const totalWorksheets = totalStats;
        const totalAbsent = absentStats;
        const totalRepeated = repeatedStats;
        const totalGraded = gradedStats;
        
        const absentPercentage = totalWorksheets > 0 ? (totalAbsent / totalWorksheets) * 100 : 0;
        const repetitionRate = (totalWorksheets - totalAbsent) > 0 ? (totalRepeated / (totalWorksheets - totalAbsent)) * 100 : 0;
        
        const highScoreCount = Number(highScoreStats[0]?.count || 0);
        const highScorePercentage = totalGraded > 0 ? (highScoreCount / totalGraded) * 100 : 0;
        
        const excellenceScoreCount = Number(excellenceStats[0]?.count || 0);
        const excellenceScorePercentage = totalGraded > 0 ? (excellenceScoreCount / totalGraded) * 100 : 0;
        
        const needsRepetitionCount = totalGraded - highScoreCount;
        const needsRepetitionPercentage = totalGraded > 0 ? (needsRepetitionCount / totalGraded) * 100 : 0;
        
        const result = {
            totalWorksheets: totalWorksheets - totalAbsent, // Non-absent worksheets for consistency
            totalAbsent,
            absentPercentage,
            totalRepeated,
            repetitionRate,
            highScoreCount,
            highScorePercentage,
            excellenceScoreCount,
            excellenceScorePercentage,
            totalGraded,
            needsRepetitionCount,
            needsRepetitionPercentage
        };

        // Cache the result
        setCache(cacheKey, result);
        
        return res.status(200).json(result);
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
        const { start, end } = convertToFullDayRange(startDate as string, endDate as string);
        
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
        
        // Use parallel aggregation queries for better performance
        const [
            totalStats,
            absentStats,
            repeatedStats,
            highScoreStats
        ] = await Promise.all([
            // Total worksheets count
            prisma.worksheet.count({
                where: filter
            }),
            
            // Absent worksheets count
            prisma.worksheet.count({
                where: {
                    ...filter,
                    isAbsent: true
                }
            }),
            
            // Repeated worksheets count  
            prisma.worksheet.count({
                where: {
                    ...filter,
                    isRepeated: true
                }
            }),
            
            // High score count (≥80%) - use raw query for performance
            prisma.$queryRaw<Array<{count: bigint}>>`
                SELECT COUNT(*)::bigint as count
                FROM "Worksheet" w
                LEFT JOIN "Class" c ON w."classId" = c.id
                WHERE w."submittedOn" >= ${start}::timestamp
                AND w."submittedOn" <= ${end}::timestamp
                AND w."isAbsent" = false
                AND w.grade IS NOT NULL
                AND w.grade >= (COALESCE(w."outOf", 40) * 0.8)
                ${schoolId ? 
                    Prisma.sql`AND c."schoolId" = ${schoolId}`
                    : Prisma.empty}
            `
        ]);
        
        // Calculate analytics from aggregated data
        const allWorksheets = totalStats;
        const totalAbsent = absentStats;
        const totalRepeated = repeatedStats;
        const highScores = Number(highScoreStats[0]?.count || 0);
        
        const totalWorksheets = allWorksheets - totalAbsent; // Non-absent worksheets
        const absentPercentage = allWorksheets > 0 ? (totalAbsent / allWorksheets) * 100 : 0;
        const repetitionRate = totalWorksheets > 0 ? (totalRepeated / totalWorksheets) * 100 : 0;
        const highScorePercentage = totalWorksheets > 0 ? (highScores / totalWorksheets) * 100 : 0;
          
        // Return compiled analytics
        res.status(200).json({
            totalWorksheets,
            totalAbsent,
            absentPercentage,
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
    const { schoolId, classId, startDate, endDate } = req.query;
    
    try {
        // Base filters for student query
        const filter: any = {
            role: 'STUDENT',
        };
        
        // Apply class filter if provided
        if (classId) {
            filter.studentClasses = {
                some: {
                    classId: classId as string,
                    class: {
                        isArchived: false // Only show students from active classes when filtering by class
                    }
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
        }        // Get all students with their class information
        const students = await prisma.user.findMany({
            where: filter,
            select: {
                id: true,
                username: true,
                name: true,
                tokenNumber: true,
                isArchived: true,
                studentClasses: {
                    where: {
                        class: {
                            isArchived: false // Only include students from active classes
                        }
                    },
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
                    // Apply date filter if provided with full day range
                    where: startDate && endDate ? (() => {
                        const { start, end } = convertToFullDayRange(startDate as string, endDate as string);
                        return {
                            submittedOn: {
                                gte: start,
                                lte: end
                            }
                        };
                    })() : undefined,
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
            const allWorksheets = worksheets.length;
            const absences = worksheets.filter(w => w.isAbsent).length;
            const repetitions = worksheets.filter(w => w.isRepeated).length;
            
            // Calculate graded vs ungraded worksheets - only count non-absent graded worksheets for consistency
            const gradedWorksheets = worksheets.filter(w => w.grade !== null && !w.isAbsent);
            const totalWorksheets = allWorksheets - absences; // Non-absent worksheets
            
            // Get first and last worksheet dates
            const worksheetsWithDates = worksheets.filter(w => w.submittedOn !== null);
            const firstWorksheet = worksheetsWithDates.length > 0 ? worksheetsWithDates[0] : null;
            const lastWorksheet = worksheetsWithDates.length > 0 ? worksheetsWithDates[worksheetsWithDates.length - 1] : null;
            
            // Class and school info (only from active classes)
            const primaryClass = student.studentClasses[0]?.class;
              return {
                id: student.id,
                name: student.name,
                username: student.username,
                tokenNumber: student.tokenNumber,
                isArchived: student.isArchived || false,
                class: primaryClass ? primaryClass.name : 'No Active Class',
                school: primaryClass ? primaryClass.school.name : 'No Active School',
                totalWorksheets,
                absentCount: absences,
                absentPercentage: allWorksheets > 0 ? (absences / allWorksheets) * 100 : 0,
                repeatedCount: repetitions,
                repetitionRate: (allWorksheets - absences) > 0 ? (repetitions / (allWorksheets - absences)) * 100 : 0,
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
        const { includeArchived = 'false' } = req.query;
        const whereConditions: any = {};
        
        if (includeArchived !== 'true') {
            whereConditions.isArchived = false;
        }
        
        const schools = await prisma.school.findMany({
            where: whereConditions,
            select: {
                id: true,
                name: true,
                isArchived: true
            },
            orderBy: [
                { isArchived: 'asc' },
                { name: 'asc' }
            ]
        });
        
        return res.status(200).json(schools);
    } catch (error) {
        console.error('Error getting schools:', error);
        return res.status(500).json({ message: 'Server error while retrieving schools' });
    }
};

export const getFilterOptions = async (req: Request, res: Response) => {
    try {
        const { includeArchived = 'false' } = req.query;
        
        const schoolWhereConditions: any = {};
        if (includeArchived !== 'true') {
            schoolWhereConditions.isArchived = false;
        }
        
        const schools = await prisma.school.findMany({
            where: schoolWhereConditions,
            select: {
                id: true,
                name: true,
                isArchived: true
            },
            orderBy: [
                { isArchived: 'asc' },
                { name: 'asc' }
            ]
        });
        
        const classWhereConditions: any = {};
        if (includeArchived !== 'true') {
            classWhereConditions.isArchived = false;
        }
        
        const classes = await prisma.class.findMany({
            where: classWhereConditions,
            select: {
                id: true,
                name: true,
                schoolId: true,
                isArchived: true
            },
            orderBy: [
                { isArchived: 'asc' },
                { name: 'asc' }
            ]
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
        const { includeArchived = 'false' } = req.query;
        
        // Build filter conditions
        const whereConditions: any = {
            schoolId
        };
        
        // Filter by archive status unless explicitly requesting archived classes
        if (includeArchived !== 'true') {
            whereConditions.isArchived = false;
        }
        
        const classes = await prisma.class.findMany({
            where: whereConditions,
            select: {
                id: true,
                name: true,
                schoolId: true,
                isArchived: true
            },
            orderBy: [
                { isArchived: 'asc' }, // Show active classes first
                { name: 'asc' }
            ]
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
    const { schoolId, classId, startDate, endDate, showArchived = 'active', format = 'csv' } = req.query;
    
    try {
        // Base filters for student query (same as getStudentAnalytics)
        const filter: any = {
            role: 'STUDENT',
        };

        // Apply archive filter based on showArchived parameter
        if (showArchived === 'active') {
            filter.isArchived = false;
        } else if (showArchived === 'archived') {
            filter.isArchived = true;
        }
        // If showArchived === 'all', don't add isArchived filter
        
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
                isArchived: true,
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
                    // Apply date filter if provided with full day range
                    where: startDate && endDate ? (() => {
                        const { start, end } = convertToFullDayRange(startDate as string, endDate as string);
                        return {
                            submittedOn: {
                                gte: start,
                                lte: end
                            }
                        };
                    })() : undefined,
                    orderBy: {
                        submittedOn: 'asc'
                    }
                }
            }
        });
          // Calculate analytics for each student
        const studentsWithAnalytics = students.map(student => {
            const worksheets = student.studentWorksheets;
            const allWorksheets = worksheets.length;
            const absences = worksheets.filter(w => w.isAbsent).length;
            const repetitions = worksheets.filter(w => w.isRepeated).length;
            
            // Calculate graded vs ungraded worksheets - only count non-absent graded worksheets for consistency
            const gradedWorksheets = worksheets.filter(w => w.grade !== null && !w.isAbsent);
            const totalWorksheets = allWorksheets - absences; // Non-absent worksheets
            
            // Get first and last worksheet dates
            const worksheetsWithDates = worksheets.filter(w => w.submittedOn !== null);
            const firstWorksheet = worksheetsWithDates.length > 0 ? worksheetsWithDates[0] : null;
            const lastWorksheet = worksheetsWithDates.length > 0 ? worksheetsWithDates[worksheetsWithDates.length - 1] : null;
            
            // Class and school info
            const primaryClass = student.studentClasses[0]?.class;
            
            // Calculate average grade (excluding absent worksheets)
            const gradedNonAbsentWorksheets = worksheets.filter(w => !w.isAbsent && w.grade !== null);
            const averageGrade = gradedNonAbsentWorksheets.length > 0 
                ? gradedNonAbsentWorksheets.reduce((sum, w) => sum + (w.grade || 0), 0) / gradedNonAbsentWorksheets.length 
                : 0;
              return {
                id: student.id,
                name: student.name,
                username: student.username,
                tokenNumber: student.tokenNumber || '',
                isArchived: student.isArchived || false,
                class: primaryClass ? primaryClass.name : 'No Class',
                school: primaryClass ? primaryClass.school.name : 'No School',
                totalWorksheets,
                absentCount: absences,
                absentPercentage: allWorksheets > 0 ? Number((absences / allWorksheets * 100).toFixed(2)) : 0,
                repeatedCount: repetitions,
                repetitionRate: (allWorksheets - absences) > 0 ? Number((repetitions / (allWorksheets - absences) * 100).toFixed(2)) : 0,
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
                'Status',
                'Total Worksheets',
                'Absent Count',
                'Absent Percentage (%)',
                'Repeated Count',
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
                student.isArchived ? 'Archived' : 'Active',
                student.totalWorksheets,
                student.absentCount,
                student.absentPercentage,
                student.repeatedCount,
                student.repetitionRate,
                student.averageGrade,
                `"${student.firstWorksheetDate}"`,
                `"${student.lastWorksheetDate}"`
            ]);
            
            const csvContent = [csvHeaders.join(','), ...csvRows.map(row => row.join(','))].join('\n');
            
            // Set response headers for CSV download
            const timestamp = new Date().toISOString().split('T')[0];
            let filename = `student_analytics_${timestamp}.csv`;
            
            // Include date range in filename if provided
            if (startDate && endDate) {
                const start = new Date(startDate as string).toISOString().split('T')[0];
                const end = new Date(endDate as string).toISOString().split('T')[0];
                filename = `student_analytics_${start}_to_${end}.csv`;
            }
            
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