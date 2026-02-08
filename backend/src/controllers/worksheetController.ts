import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import prisma from '../utils/prisma';
import { uploadToS3 } from '../services/s3Service';
import { enqueueWorksheet } from '../services/queueService';
import { ProcessingStatus } from '@prisma/client';
import fetch from 'node-fetch';

interface MulterFile extends Express.Multer.File { }

/**
 * Upload a worksheet with multiple images
 * @route POST /api/worksheets/upload
 */
export const uploadWorksheet = async (req: Request, res: Response) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    // Check if files were uploaded
    if (!req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({ message: 'No files uploaded' });
    }

    const { classId, studentId, notes } = req.body;
    // Access files array directly
    const files = req.files as MulterFile[];

    try {
        // Check if class exists
        const classExists = await prisma.class.findUnique({
            where: { id: classId }
        });

        if (!classExists) {
            return res.status(404).json({ message: 'Class not found' });
        }

        // If studentId is provided, check if student exists
        if (studentId) {
            const student = await prisma.user.findFirst({
                where: {
                    id: studentId,
                    role: 'STUDENT',
                    studentClasses: {
                        some: {
                            classId
                        }
                    }
                }
            });

            if (!student) {
                return res.status(404).json({ message: 'Student not found in this class' });
            }
        }

        // Create worksheet record
        const worksheet = await prisma.worksheet.create({
            data: {
                notes: notes || null,
                status: ProcessingStatus.PENDING,
                submittedById: req.user!.userId,
                classId,
                studentId: studentId || null
            }
        });

        // Upload each file to S3 and create WorksheetImage records
        const imagePromises = files.map(async (file: MulterFile, index: number) => {
            // Get page number from the request or use the index
            const pageNumber = req.body.pageNumbers && Array.isArray(req.body.pageNumbers) ?
                parseInt(req.body.pageNumbers[index] as string) :
                index + 1;

            // Generate unique filename
            const timestamp = Date.now();
            const filename = `worksheets/${worksheet.id}/${timestamp}-page${pageNumber}-${file.originalname.replace(/\s+/g, '_')}`;

            // Upload to S3
            const imageUrl = await uploadToS3(
                file.buffer,
                filename,
                file.mimetype
            );

            // Create WorksheetImage record
            return prisma.worksheetImage.create({
                data: {
                    imageUrl,
                    pageNumber,
                    worksheetId: worksheet.id
                }
            });
        });

        // Wait for all images to be uploaded and records created
        const worksheetImages = await Promise.all(imagePromises);

        // Enqueue for processing
        await enqueueWorksheet(worksheet.id);

        return res.status(201).json({
            id: worksheet.id,
            images: worksheetImages,
            status: worksheet.status,
            message: 'Worksheet uploaded and queued for processing'
        });
    } catch (error) {
        console.error('Worksheet upload error:', error);
        return res.status(500).json({ message: 'Server error during worksheet upload' });
    }
};

/**
 * Get all worksheets for a class
 * @route GET /api/worksheets/class/:classId
 */
export const getWorksheetsByClass = async (req: Request, res: Response) => {
    const { classId } = req.params;

    try {
        const worksheets = await prisma.worksheet.findMany({
            where: { classId },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                images: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        return res.status(200).json(worksheets);
    } catch (error) {
        console.error('Get worksheets by class error:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheets' });
    }
};

/**
 * Get all worksheets for a student
 * @route GET /api/worksheets/student/:studentId
 */
export const getWorksheetsByStudent = async (req: Request, res: Response) => {
    const { studentId } = req.params;

    try {
        // First check if student exists
        const student = await prisma.user.findFirst({
            where: {
                id: studentId,
                role: 'STUDENT'
            }
        });

        if (!student) {
            return res.status(404).json({ message: 'Student not found' });
        }

        const worksheets = await prisma.worksheet.findMany({
            where: { studentId },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                template: {
                    select: {
                        id: true,
                        worksheetNumber: true
                    }
                },
                images: true
            },
            orderBy: {
                createdAt: 'desc'
            }
        });

        return res.status(200).json(worksheets);
    } catch (error) {
        console.error('Get worksheets by student error:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheets' });
    }
};

/**
 * Get a specific worksheet by ID
 * @route GET /api/worksheets/:id
 */
export const getWorksheetById = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        const worksheet = await prisma.worksheet.findUnique({
            where: { id },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                images: true
            }
        });

        if (!worksheet) {
            return res.status(404).json({ message: 'Worksheet not found' });
        }

        return res.status(200).json(worksheet);
    } catch (error) {
        console.error('Get worksheet by ID error:', error);
        return res.status(500).json({ message: 'Server error while retrieving worksheet' });
    }
};

// Get classes for a teacher
export const getTeacherClasses = async (req: Request, res: Response) => {
    const { teacherId } = req.params; const classes = await prisma.teacherClass.findMany({
        where: {
            teacherId: teacherId,
            class: {
                isArchived: false  // Filter out archived classes
            }
        },
        include: {
            class: {
                include: {
                    school: true
                }
            }
        }
    });

    // Transform the data to match the frontend's needs
    const transformedClasses = classes.map(tc => ({
        id: tc.class.id,
        name: `${tc.class.school.name} - ${tc.class.name}`,
    }));

    res.json(transformedClasses);
};

// Get students in a class
export const getClassStudents = async (req: Request, res: Response) => {
    const { classId } = req.params;

    const students = await prisma.studentClass.findMany({
        where: {
            classId: classId,
            student: {
                isArchived: false
            }
        },
        include: {
            student: {
                select: {
                    id: true,
                    username: true,
                    name: true,
                    tokenNumber: true
                }
            }
        }
    });

    // Transform the data to match the frontend's needs
    const transformedStudents = students.map(sc => ({
        id: sc.student.id,
        username: sc.student.username,
        name: sc.student.name,
        tokenNumber: sc.student.tokenNumber
    }));

    res.json(transformedStudents);
};

// Get worksheet templates
export const getWorksheetTemplates = async (req: Request, res: Response) => {
    const templates = await prisma.worksheetTemplate.findMany({
        select: {
            id: true,
            worksheetNumber: true
        },
        orderBy: {
            worksheetNumber: 'asc'
        }
    });

    res.json(templates);
};

// Create a graded worksheet
export const createGradedWorksheet = async (req: Request, res: Response) => {
    const { classId, studentId, worksheetNumber, grade, notes, submittedOn, isAbsent, isRepeated, isIncorrectGrade, gradingDetails, wrongQuestionNumbers } = req.body;
    const submittedById = req.user?.userId;

    // Normalize submittedOn to midnight UTC for consistent unique constraint matching
    const submittedOnDate = submittedOn ? new Date(submittedOn) : new Date();
    submittedOnDate.setUTCHours(0, 0, 0, 0);

    try {
        // If student is absent, create a record marking them as absent
        if (isAbsent) {
            // Use upsert to prevent duplicates for absent records
            // worksheetNumber = 0 for absent students
            let worksheet;
            try {
                worksheet = await prisma.worksheet.upsert({
                    where: {
                        unique_worksheet_per_student_day: {
                            studentId,
                            classId,
                            worksheetNumber: 0,
                            submittedOn: submittedOnDate
                        }
                    },
                    update: {
                        grade: 0,
                        notes: notes || 'Student absent',
                        status: ProcessingStatus.COMPLETED,
                        isAbsent: true,
                        worksheetNumber: 0,
                    },
                    create: {
                        classId,
                        studentId,
                        submittedById: submittedById!,
                        worksheetNumber: 0,
                        grade: 0,
                        notes: notes || 'Student absent',
                        status: ProcessingStatus.COMPLETED,
                        outOf: 40,
                        submittedOn: submittedOnDate,
                        isAbsent: true,
                        isRepeated: false,
                        isIncorrectGrade: false,
                    }
                });
            } catch (upsertError: any) {
                if (upsertError?.code === 'P2002') {
                    const existing = await prisma.worksheet.findFirst({
                        where: { studentId, classId, worksheetNumber: 0, submittedOn: submittedOnDate }
                    });
                    if (existing) {
                        worksheet = await prisma.worksheet.update({
                            where: { id: existing.id },
                            data: {
                                grade: 0,
                                notes: notes || 'Student absent',
                                status: ProcessingStatus.COMPLETED,
                                isAbsent: true,
                                worksheetNumber: 0,
                            }
                        });
                    } else {
                        throw upsertError;
                    }
                } else {
                    throw upsertError;
                }
            }

            return res.status(201).json(worksheet);
        }

        // For non-absent students, handle normally
        // Make sure worksheetNumber is a valid number
        const worksheetNum = Number(worksheetNumber);
        if (isNaN(worksheetNum) || worksheetNum <= 0) {
            return res.status(400).json({ message: 'Valid worksheet number is required for non-absent students' });
        }

        // Make sure grade is a valid number
        const gradeValue = Number(grade);
        if (isNaN(gradeValue) || gradeValue < 0 || gradeValue > 40) {
            return res.status(400).json({ message: 'Valid grade between 0 and 40 is required for non-absent students' });
        }

        // Find the template by worksheet number for non-absent students
        const template = await prisma.worksheetTemplate.findFirst({
            where: {
                worksheetNumber: worksheetNum
            }
        });

        // Use upsert to prevent duplicates from race conditions
        let worksheet;
        try {
            worksheet = await prisma.worksheet.upsert({
                where: {
                    unique_worksheet_per_student_day: {
                        studentId,
                        classId,
                        worksheetNumber: worksheetNum,
                        submittedOn: submittedOnDate
                    }
                },
                update: {
                    grade: gradeValue,
                    notes,
                    status: ProcessingStatus.COMPLETED,
                    isIncorrectGrade: isIncorrectGrade || false,
                    isRepeated: isRepeated || false,
                    gradingDetails: gradingDetails || null,
                    wrongQuestionNumbers: wrongQuestionNumbers || null,
                    worksheetNumber: worksheetNum,
                },
                create: {
                    classId,
                    studentId,
                    submittedById: submittedById!,
                    templateId: template?.id,
                    worksheetNumber: worksheetNum,
                    grade: gradeValue,
                    notes,
                    status: ProcessingStatus.COMPLETED,
                    outOf: 40,
                    submittedOn: submittedOnDate,
                    isAbsent: false,
                    isRepeated: isRepeated || false,
                    isIncorrectGrade: isIncorrectGrade || false,
                    gradingDetails: gradingDetails || null,
                    wrongQuestionNumbers: wrongQuestionNumbers || null,
                }
            });
        } catch (upsertError: any) {
            if (upsertError?.code === 'P2002') {
                const existing = await prisma.worksheet.findFirst({
                    where: { studentId, classId, worksheetNumber: worksheetNum, submittedOn: submittedOnDate }
                });
                if (existing) {
                    worksheet = await prisma.worksheet.update({
                        where: { id: existing.id },
                        data: {
                            grade: gradeValue,
                            notes,
                            status: ProcessingStatus.COMPLETED,
                            isIncorrectGrade: isIncorrectGrade || false,
                            isRepeated: isRepeated || false,
                            gradingDetails: gradingDetails || null,
                            wrongQuestionNumbers: wrongQuestionNumbers || null,
                            worksheetNumber: worksheetNum,
                        }
                    });
                } else {
                    throw upsertError;
                }
            } else {
                throw upsertError;
            }
        }

        res.status(201).json(worksheet);
    } catch (error) {
        console.error('Create graded worksheet error:', error);
        return res.status(500).json({ message: 'Server error while creating worksheet' });
    }
};

// Find worksheet by class, student, and date range
export const findWorksheetByClassStudentDate = async (req: Request, res: Response) => {
    const { classId, studentId, startDate, endDate } = req.query;

    if (!classId || !studentId || !startDate || !endDate) {
        return res.status(400).json({ message: 'Missing required query parameters' });
    }

    try {
        const worksheet = await prisma.worksheet.findFirst({
            where: {
                classId: classId as string,
                studentId: studentId as string,
                submittedOn: {
                    gte: new Date(startDate as string),
                    lt: new Date(endDate as string)
                }
            },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                template: true
            }
        });

        return res.status(200).json(worksheet);
    } catch (error) {
        console.error('Find worksheet error:', error);
        return res.status(500).json({ message: 'Server error while finding worksheet' });
    }
};

// Find ALL worksheets by class, student, and date range (for multiple worksheets per day)
export const findAllWorksheetsByClassStudentDate = async (req: Request, res: Response) => {
    const { classId, studentId, startDate, endDate } = req.query;

    if (!classId || !studentId || !startDate || !endDate) {
        return res.status(400).json({ message: 'Missing required query parameters' });
    }

    try {
        const worksheets = await prisma.worksheet.findMany({
            where: {
                classId: classId as string,
                studentId: studentId as string,
                submittedOn: {
                    gte: new Date(startDate as string),
                    lt: new Date(endDate as string)
                }
            },
            include: {
                submittedBy: {
                    select: {
                        id: true,
                        username: true,
                        role: true
                    }
                },
                class: {
                    select: {
                        id: true,
                        name: true
                    }
                },
                template: true,
                images: {
                    orderBy: {
                        pageNumber: 'asc'
                    }
                }
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        return res.status(200).json(worksheets);
    } catch (error) {
        console.error('Find all worksheets error:', error);
        return res.status(500).json({ message: 'Server error while finding worksheets' });
    }
};

// Update a graded worksheet
export const updateGradedWorksheet = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { classId, studentId, worksheetNumber, grade, notes, submittedOn, isAbsent, isRepeated, isIncorrectGrade, gradingDetails } = req.body;
    const submittedById = req.user?.userId;

    try {
        // Find the existing worksheet
        const existingWorksheet = await prisma.worksheet.findUnique({
            where: { id }
        });

        if (!existingWorksheet) {
            return res.status(404).json({ message: 'No worksheet found to update' });
        }

        // If student is marked as absent, completely clear all grade data
        if (isAbsent) {
            const worksheet = await prisma.worksheet.update({
                where: { id },
                data: {
                    class: {
                        connect: { id: classId }
                    },
                    student: {
                        connect: { id: studentId }
                    },
                    submittedBy: {
                        connect: { id: submittedById! }
                    },
                    grade: 0, // Force zero grade for absent student
                    notes: notes || 'Student absent',
                    status: ProcessingStatus.COMPLETED,
                    outOf: 40,
                    template: {
                        disconnect: true // Remove template association
                    },
                    submittedOn: submittedOn ? new Date(submittedOn) : undefined,
                    isAbsent: true,
                    isRepeated: false, // Can't be repeated if absent
                    isIncorrectGrade: false, // Absent students can't have incorrect grades
                }
            });

            return res.status(200).json(worksheet);
        }

        // For non-absent students, handle normally
        // Make sure worksheetNumber is a valid number
        const worksheetNum = Number(worksheetNumber);
        if (isNaN(worksheetNum) || worksheetNum <= 0) {
            return res.status(400).json({ message: 'Valid worksheet number is required for non-absent students' });
        }

        // Make sure grade is a valid number
        const gradeValue = Number(grade);
        if (isNaN(gradeValue) || gradeValue < 0 || gradeValue > 40) {
            return res.status(400).json({ message: 'Valid grade between 0 and 40 is required for non-absent students' });
        }

        // Find the template by worksheet number
        const template = await prisma.worksheetTemplate.findFirst({
            where: {
                worksheetNumber: worksheetNum
            }
        });

        if (!template) {
        }

        const data = {
            class: {
                connect: { id: classId }
            },
            student: {
                connect: { id: studentId }
            },
            submittedBy: {
                connect: { id: submittedById! }
            },
            grade: gradeValue,
            notes,
            status: ProcessingStatus.COMPLETED,
            outOf: 40,
            ...(template ? {
                template: {
                    connect: { id: template.id }
                }
            } : {}),
            submittedOn: submittedOn ? new Date(submittedOn) : undefined,
            isAbsent: false,
            isRepeated: isRepeated || false,
            isIncorrectGrade: isIncorrectGrade || false,
            gradingDetails: gradingDetails || null,
        }

        const worksheet = await prisma.worksheet.update({
            where: { id },
            data
        });

        res.status(200).json(worksheet);
    } catch (error) {
        console.error('Update graded worksheet error:', error);
        return res.status(500).json({ message: 'Server error while updating worksheet' });
    }
};

export const deleteGradedWorksheet = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        await prisma.worksheet.delete({
            where: { id }
        });

        return res.status(200).json({ message: 'Worksheet deleted successfully' });
    } catch (error) {
        console.error('Delete graded worksheet error:', error);
        return res.status(500).json({ message: 'Server error while deleting worksheet' });
    }
};

export const getPreviousWorksheets = async (req: Request, res: Response) => {
    const { classId, studentId, endDate } = req.query;

    if (!classId || !studentId || !endDate) {
        return res.status(400).json({ message: 'Missing required query parameters' });
    }

    try {
        const endDateObj = new Date(endDate as string);
        const currentDate = new Date();

        const isFutureDate = endDateObj > currentDate;

        const worksheets = await prisma.worksheet.findMany({
            where: {
                classId: classId as string,
                studentId: studentId as string,
                ...(isFutureDate ? {} : {
                    submittedOn: {
                        lt: endDateObj
                    }
                }),
                status: ProcessingStatus.COMPLETED
            },
            include: {
                template: true
            },
            orderBy: {
                submittedOn: 'desc'
            }
        });

        return res.status(200).json(worksheets);
    } catch (error) {
        console.error('Get previous worksheets error:', error);
        return res.status(500).json({ message: 'Server error while retrieving previous worksheets' });
    }
};

/**
 * Get all worksheets for a class on a specific date
 * @route GET /api/worksheets/class-date
 */
export const getClassWorksheetsForDate = async (req: Request, res: Response) => {
    const { classId, submittedOn } = req.query;

    if (!classId || !submittedOn) {
        return res.status(400).json({ message: 'Missing required query parameters: classId and submittedOn' });
    }

    try {
        const dateStr = submittedOn as string;
        const date = new Date(dateStr);
        const startDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const endDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1));

        // 1. Get all students in the class
        const studentClasses = await prisma.studentClass.findMany({
            where: {
                classId: classId as string,
                student: {
                    isArchived: false
                }
            },
            include: {
                student: {
                    select: {
                        id: true,
                        name: true,
                        tokenNumber: true
                    }
                }
            }
        });

        const students = studentClasses.map(sc => sc.student);
        const studentIds = students.map(s => s.id);

        // 2. Fetch all worksheets for this class on this date (single query)
        const worksheetsOnDate = await prisma.worksheet.findMany({
            where: {
                classId: classId as string,
                studentId: { in: studentIds },
                submittedOn: {
                    gte: startDate,
                    lt: endDate
                }
            },
            include: {
                template: {
                    select: {
                        id: true,
                        worksheetNumber: true
                    }
                },
                images: {
                    orderBy: {
                        pageNumber: 'asc'
                    }
                }
            },
            orderBy: {
                createdAt: 'asc'
            }
        });

        // Group worksheets by studentId
        const worksheetsByStudent: Record<string, typeof worksheetsOnDate> = {};
        for (const ws of worksheetsOnDate) {
            if (ws.studentId) {
                if (!worksheetsByStudent[ws.studentId]) {
                    worksheetsByStudent[ws.studentId] = [];
                }
                worksheetsByStudent[ws.studentId].push(ws);
            }
        }

        // Calculate stats for the response
        const studentsWithWorksheets = new Set<string>();
        let gradedCount = 0;
        let absentCount = 0;
        let pendingCount = 0;

        for (const ws of worksheetsOnDate) {
            if (ws.studentId) {
                studentsWithWorksheets.add(ws.studentId);
            }
            if (ws.isAbsent) {
                absentCount++;
            } else if (ws.grade !== null && ws.status === ProcessingStatus.COMPLETED) {
                gradedCount++;
            } else if (ws.status === ProcessingStatus.PENDING || ws.status === ProcessingStatus.PROCESSING) {
                pendingCount++;
            }
        }

        const stats = {
            totalStudents: students.length,
            studentsWithWorksheets: studentsWithWorksheets.size,
            gradedCount,
            absentCount,
            pendingCount
        };

        // 3. For students without worksheets on this date, get lightweight summary for recommendations
        const studentsWithoutWorksheets = studentIds.filter(id => !worksheetsByStudent[id]);

        let studentSummaries: Record<string, { lastWorksheetNumber: number | null; lastGrade: number | null; completedWorksheetNumbers: number[]; recommendedWorksheetNumber: number; isRecommendedRepeated: boolean }> = {};

        if (studentsWithoutWorksheets.length > 0) {
            const endDateForHistory = new Date(dateStr);
            endDateForHistory.setHours(23, 59, 59, 999);

            // Fetch only the minimal data needed for recommendations
            const historyData = await prisma.worksheet.findMany({
                where: {
                    classId: classId as string,
                    studentId: { in: studentsWithoutWorksheets },
                    submittedOn: {
                        lt: endDateForHistory
                    },
                    status: ProcessingStatus.COMPLETED,
                    isAbsent: false,
                    grade: { not: null }
                },
                select: {
                    studentId: true,
                    grade: true,
                    submittedOn: true,
                    worksheetNumber: true
                },
                orderBy: {
                    submittedOn: 'desc'
                }
            });

            // Build lightweight summaries with recommendations
            const PROGRESSION_THRESHOLD = 32;

            for (const studentId of studentsWithoutWorksheets) {
                const studentHistory = historyData.filter(h => h.studentId === studentId);
                const completedNumbers = studentHistory
                    .filter(h => h.worksheetNumber)
                    .map(h => h.worksheetNumber);

                const latest = studentHistory[0];
                const lastWorksheetNumber = latest?.worksheetNumber ?? null;
                const lastGrade = latest?.grade ?? null;
                const uniqueCompleted = [...new Set(completedNumbers)];

                // Calculate recommendation
                let recommendedWorksheetNumber = 1;
                let isRecommendedRepeated = false;

                if (lastWorksheetNumber !== null && lastGrade !== null) {
                    if (lastGrade >= PROGRESSION_THRESHOLD) {
                        recommendedWorksheetNumber = lastWorksheetNumber + 1;
                        isRecommendedRepeated = uniqueCompleted.includes(recommendedWorksheetNumber);
                    } else {
                        recommendedWorksheetNumber = lastWorksheetNumber;
                        isRecommendedRepeated = true;
                    }
                }

                studentSummaries[studentId] = {
                    lastWorksheetNumber,
                    lastGrade,
                    completedWorksheetNumbers: uniqueCompleted,
                    recommendedWorksheetNumber,
                    isRecommendedRepeated
                };
            }
        }

        return res.status(200).json({
            students,
            worksheetsByStudent,
            studentSummaries,
            stats
        });
    } catch (error) {
        console.error('Get class worksheets for date error:', error);
        return res.status(500).json({ message: 'Server error while retrieving class worksheets' });
    }
};

export const getIncorrectGradingWorksheets = async (req: Request, res: Response) => {
    try {
        const { page = '1', pageSize = '10', startDate, endDate } = req.query as {
            page?: string;
            pageSize?: string;
            startDate?: string;
            endDate?: string;
        };

        const pageNum = Math.max(parseInt(page || '1', 10) || 1, 1);
        const sizeNum = Math.min(Math.max(parseInt(pageSize || '10', 10) || 10, 1), 100);

        const where: any = {
            isIncorrectGrade: true,
            status: ProcessingStatus.COMPLETED,
        };

        if (startDate || endDate) {
            const submittedOn: any = {};
            if (startDate) {
                const start = new Date(startDate);
                submittedOn.gte = start;
            }
            if (endDate) {
                const end = new Date(endDate);
                const endExclusive = new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate() + 1));
                submittedOn.lt = endExclusive;
            }
            where.submittedOn = submittedOn;
        }

        const worksheets = await prisma.worksheet.findMany({
            where,
            include: {
                student: { select: { id: true, name: true, tokenNumber: true } },
                submittedBy: { select: { name: true, username: true } },
                class: { select: { name: true } }
            },
            orderBy: [
                { submittedOn: 'desc' },
                { worksheetNumber: 'asc' }
            ]
        });

        const transformed = worksheets.map(worksheet => ({
            id: worksheet.id,
            worksheetNumber: worksheet.worksheetNumber || 0,
            grade: worksheet.grade || 0,
            submittedOn: worksheet.submittedOn,
            adminComments: worksheet.adminComments,
            student: {
                id: worksheet.student?.id || null,
                name: worksheet.student?.name || 'Unknown',
                tokenNumber: worksheet.student?.tokenNumber || 'N/A'
            },
            submittedBy: {
                name: worksheet.submittedBy.name,
                username: worksheet.submittedBy.username
            },
            class: { name: worksheet.class.name },
            gradingDetails: worksheet.gradingDetails
        }));

        const seen = new Set<string>();
        const deduped: typeof transformed = [] as any;
        for (const w of transformed) {
            const dt = w.submittedOn ? new Date(w.submittedOn as any) : new Date(0);
            const dateKey = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
            const studentKey = w.student?.id || 'unknown';
            const key = `${studentKey}|${w.worksheetNumber}|${dateKey}`;
            if (!seen.has(key)) {
                seen.add(key);
                deduped.push(w);
            }
        }

        const total = deduped.length;
        const startIdx = (pageNum - 1) * sizeNum;
        const endIdx = startIdx + sizeNum;
        const data = deduped.slice(startIdx, endIdx).map(w => ({
            id: w.id,
            worksheetNumber: w.worksheetNumber,
            grade: w.grade,
            submittedOn: w.submittedOn,
            adminComments: w.adminComments,
            student: { name: w.student.name, tokenNumber: w.student.tokenNumber },
            submittedBy: { name: w.submittedBy.name, username: w.submittedBy.username },
            class: { name: w.class.name },
            gradingDetails: w.gradingDetails
        }));

        return res.status(200).json({ data, total, page: pageNum, pageSize: sizeNum });
    } catch (error) {
        console.error('Get incorrect grading worksheets error:', error);
        return res.status(500).json({ message: 'Server error while retrieving incorrect grading worksheets' });
    }
};

export const updateWorksheetAdminComments = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { adminComments } = req.body;

    try {
        const existingWorksheet = await prisma.worksheet.findUnique({
            where: { id }
        });

        if (!existingWorksheet) {
            return res.status(404).json({ message: 'Worksheet not found' });
        }

        const updatedWorksheet = await prisma.worksheet.update({
            where: { id },
            data: {
                adminComments: adminComments || null,
                updatedAt: new Date()
            }
        });

        return res.status(200).json({
            message: 'Admin comments updated successfully',
            worksheet: updatedWorksheet
        });
    } catch (error) {
        console.error('Update worksheet admin comments error:', error);
        return res.status(500).json({ message: 'Server error while updating admin comments' });
    }
};

export const markWorksheetAsCorrectlyGraded = async (req: Request, res: Response) => {
    const { id } = req.params;

    try {
        // Find the existing worksheet
        const existingWorksheet = await prisma.worksheet.findUnique({
            where: { id }
        });

        if (!existingWorksheet) {
            return res.status(404).json({ message: 'Worksheet not found' });
        }

        // Update the worksheet to mark it as correctly graded
        const updatedWorksheet = await prisma.worksheet.update({
            where: { id },
            data: {
                isIncorrectGrade: false,
                updatedAt: new Date()
            }
        });

        return res.status(200).json({
            message: 'Worksheet marked as correctly graded',
            worksheet: updatedWorksheet
        });
    } catch (error) {
        console.error('Mark worksheet as correctly graded error:', error);
        return res.status(500).json({ message: 'Server error while updating worksheet grading status' });
    }
};

/**
 * Get worksheet images from Python API
 * @route GET /api/worksheets/images
 */
export const getWorksheetImages = async (req: Request, res: Response) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { token_no, worksheet_name } = req.body;
    const pythonApiUrl = process.env.PYTHON_API_URL;

    if (!pythonApiUrl) {
        console.error('PYTHON_API_URL environment variable not set');
        return res.status(500).json({
            message: 'Server configuration error: PYTHON_API_URL not set'
        });
    }

    try {
        // Call Python API to get worksheet images
        const response = await fetch(
            `${pythonApiUrl}/get-worksheet-images`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    token_no: token_no as string,
                    worksheet_name: worksheet_name as string
                })
            }
        );

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                message: error.message || 'Failed to fetch images from Python API'
            });
        }

        const imageUrls = await response.json();
        return res.status(200).json(imageUrls);
    } catch (error) {
        console.error('Get worksheet images error:', error);
        return res.status(500).json({ message: 'Server error while fetching worksheet images' });
    }
};

/**
 * Get total AI graded worksheets count from Python API
 */
export const getTotalAiGraded = async (req: Request, res: Response) => {
    const pythonApiUrl = process.env.PYTHON_API_URL;

    if (!pythonApiUrl) {
        console.error('PYTHON_API_URL environment variable not set');
        return res.status(500).json({
            message: 'Server configuration error: PYTHON_API_URL not set'
        });
    }

    try {
        const { startDate, endDate } = req.body;

        // Build the request body for Python API
        const requestBody: { full: boolean; start_time?: string; end_time?: string } = {
            full: !startDate && !endDate, // full is true if no dates provided
        };

        if (startDate) {
            requestBody.start_time = startDate;
        }
        if (endDate) {
            requestBody.end_time = endDate;
        }

        const response = await fetch(`${pythonApiUrl}/total-ai-graded`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                message: error.message || 'Failed to fetch total AI graded count from Python API'
            });
        }

        const data = await response.json();
        return res.status(200).json(data);
    } catch (error) {
        console.error('Get total AI graded error:', error);
        return res.status(500).json({ message: 'Server error while fetching total AI graded count' });
    }
};

/**
 * Get student grading details from Python API
 * @route POST /api/worksheets/student-grading-details
 */
export const getStudentGradingDetails = async (req: Request, res: Response) => {
    // Validate input
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
    }

    const { token_no, worksheet_name, overall_score } = req.body;
    const pythonApiUrl = process.env.PYTHON_API_URL;

    if (!pythonApiUrl) {
        console.error('PYTHON_API_URL environment variable not set');
        return res.status(500).json({
            message: 'Server configuration error: PYTHON_API_URL not set'
        });
    }

    try {
        // Prepare request body for Python API
        const requestBody: any = {
            token_no: token_no as string,
            worksheet_name: worksheet_name as string
        };

        // Only include overall_score if it's provided
        if (overall_score !== undefined && overall_score !== null) {
            requestBody.overall_score = overall_score as number;
        }

        // Call Python API to get student grading details
        const response = await fetch(
            `${pythonApiUrl}/student-grading-details`,
            {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(requestBody)
            }
        );

        if (!response.ok) {
            const error = await response.json();
            return res.status(response.status).json({
                message: error.message || 'Failed to fetch grading details from Python API'
            });
        }

        const gradingDetails = await response.json();
        return res.status(200).json(gradingDetails);
    } catch (error) {
        console.error('Get student grading details error:', error);
        return res.status(500).json({ message: 'Server error while fetching student grading details' });
    }
};

// ============================================================================
// NEW ENDPOINTS FOR FRONTEND OPTIMIZATION
// ============================================================================

/**
 * Check if a worksheet would be a repeat for a student
 * Moves the "is repeated" logic from frontend to backend
 * @route POST /api/worksheets/check-repeated
 */
export const checkIsRepeated = async (req: Request, res: Response) => {
    const { classId, studentId, worksheetNumber, beforeDate } = req.body;

    if (!classId || !studentId || !worksheetNumber) {
        return res.status(400).json({ message: 'Missing required fields: classId, studentId, worksheetNumber' });
    }

    try {
        const worksheetNum = parseInt(worksheetNumber);
        if (isNaN(worksheetNum) || worksheetNum <= 0) {
            return res.status(400).json({ message: 'Invalid worksheet number' });
        }

        // Find the template for this worksheet number
        const template = await prisma.worksheetTemplate.findFirst({
            where: { worksheetNumber: worksheetNum }
        });

        if (!template) {
            return res.status(200).json({
                isRepeated: false,
                reason: 'Template not found for this worksheet number'
            });
        }

        // Build date filter
        const dateFilter: any = {};
        if (beforeDate) {
            const beforeDateObj = new Date(beforeDate);
            beforeDateObj.setUTCHours(23, 59, 59, 999);
            dateFilter.lt = beforeDateObj;
        }

        // Check if student has completed this worksheet before
        const existingWorksheet = await prisma.worksheet.findFirst({
            where: {
                classId,
                studentId,
                templateId: template.id,
                status: ProcessingStatus.COMPLETED,
                isAbsent: false,
                grade: { not: null },
                ...(beforeDate ? { submittedOn: dateFilter } : {})
            },
            select: {
                id: true,
                grade: true,
                submittedOn: true
            },
            orderBy: {
                submittedOn: 'desc'
            }
        });

        const isRepeated = !!existingWorksheet;

        return res.status(200).json({
            isRepeated,
            previousWorksheet: existingWorksheet ? {
                id: existingWorksheet.id,
                grade: existingWorksheet.grade,
                submittedOn: existingWorksheet.submittedOn
            } : null
        });
    } catch (error) {
        console.error('Check is repeated error:', error);
        return res.status(500).json({ message: 'Server error while checking repeated status' });
    }
};

/**
 * Get recommended next worksheet for a student
 * Moves progression threshold logic from frontend to backend
 * @route POST /api/worksheets/recommend-next
 */
export const getRecommendedWorksheet = async (req: Request, res: Response) => {
    const { classId, studentId, beforeDate } = req.body;
    const PROGRESSION_THRESHOLD = parseInt(process.env.PROGRESSION_THRESHOLD || '32');

    if (!classId || !studentId) {
        return res.status(400).json({ message: 'Missing required fields: classId, studentId' });
    }

    try {
        // Build date filter
        const dateFilter: any = {};
        if (beforeDate) {
            const beforeDateObj = new Date(beforeDate);
            beforeDateObj.setUTCHours(23, 59, 59, 999);
            dateFilter.lt = beforeDateObj;
        }

        // Get student's last completed worksheet
        const lastWorksheet = await prisma.worksheet.findFirst({
            where: {
                classId,
                studentId,
                status: ProcessingStatus.COMPLETED,
                isAbsent: false,
                grade: { not: null },
                ...(beforeDate ? { submittedOn: dateFilter } : {})
            },
            orderBy: {
                submittedOn: 'desc'
            }
        });

        if (!lastWorksheet || !lastWorksheet.worksheetNumber) {
            // No previous worksheet, start from 1
            return res.status(200).json({
                recommendedWorksheetNumber: 1,
                isRepeated: false,
                lastWorksheetNumber: null,
                lastGrade: null,
                progressionThreshold: PROGRESSION_THRESHOLD
            });
        }

        const lastGrade = lastWorksheet.grade || 0;
        const lastWorksheetNumber = lastWorksheet.worksheetNumber;

        let recommendedWorksheetNumber: number;
        let isRepeated: boolean;

        if (lastGrade >= PROGRESSION_THRESHOLD) {
            // Progress to next worksheet
            recommendedWorksheetNumber = lastWorksheetNumber + 1;

            // Check if they've already done the next worksheet
            const existingNext = await prisma.worksheet.findFirst({
                where: {
                    classId,
                    studentId,
                    worksheetNumber: recommendedWorksheetNumber,
                    status: ProcessingStatus.COMPLETED,
                    isAbsent: false,
                    ...(beforeDate ? { submittedOn: dateFilter } : {})
                }
            });
            isRepeated = !!existingNext;
        } else {
            // Repeat same worksheet
            recommendedWorksheetNumber = lastWorksheetNumber;
            isRepeated = true;
        }

        return res.status(200).json({
            recommendedWorksheetNumber,
            isRepeated,
            lastWorksheetNumber,
            lastGrade,
            progressionThreshold: PROGRESSION_THRESHOLD
        });
    } catch (error) {
        console.error('Get recommended worksheet error:', error);
        return res.status(500).json({ message: 'Server error while getting recommendation' });
    }
};

/**
 * Batch save worksheets for multiple students
 * Reduces N API calls to 1
 * @route POST /api/worksheets/batch-save
 */
export const batchSaveWorksheets = async (req: Request, res: Response) => {
    const { classId, submittedOn, worksheets } = req.body;
    const submittedById = req.user?.userId;

    if (!classId || !submittedOn || !worksheets || !Array.isArray(worksheets)) {
        return res.status(400).json({ message: 'Missing required fields: classId, submittedOn, worksheets array' });
    }

    if (!submittedById) {
        return res.status(401).json({ message: 'Unauthorized' });
    }

    // Normalize submittedOn to midnight UTC
    const submittedOnDate = new Date(submittedOn);
    submittedOnDate.setUTCHours(0, 0, 0, 0);

    const results: {
        saved: number;
        updated: number;
        deleted: number;
        failed: number;
        errors: { studentId: string; error: string }[];
    } = {
        saved: 0,
        updated: 0,
        deleted: 0,
        failed: 0,
        errors: []
    };

    try {
        // Process each worksheet in a transaction
        for (const ws of worksheets) {
            const { studentId, worksheetNumber, grade, isAbsent, isRepeated, isIncorrectGrade, gradingDetails, wrongQuestionNumbers, action } = ws;

            if (!studentId) {
                results.failed++;
                results.errors.push({ studentId: 'unknown', error: 'Missing studentId' });
                continue;
            }

            try {
                // Handle delete action
                if (action === 'delete') {
                    const deleted = await prisma.worksheet.deleteMany({
                        where: {
                            classId,
                            studentId,
                            submittedOn: submittedOnDate
                        }
                    });
                    if (deleted.count > 0) {
                        results.deleted += deleted.count;
                    }
                    continue;
                }

                // Handle absent students
                if (isAbsent) {
                    try {
                        await prisma.worksheet.upsert({
                            where: {
                                unique_worksheet_per_student_day: {
                                    studentId,
                                    classId,
                                    worksheetNumber: 0,
                                    submittedOn: submittedOnDate
                                }
                            },
                            update: {
                                grade: 0,
                                isAbsent: true,
                                status: ProcessingStatus.COMPLETED,
                                worksheetNumber: 0
                            },
                            create: {
                                classId,
                                studentId,
                                submittedById,
                                worksheetNumber: 0,
                                grade: 0,
                                isAbsent: true,
                                isRepeated: false,
                                status: ProcessingStatus.COMPLETED,
                                outOf: 40,
                                submittedOn: submittedOnDate
                            }
                        });
                    } catch (upsertError: any) {
                        if (upsertError?.code === 'P2002') {
                            const existing = await prisma.worksheet.findFirst({
                                where: { studentId, classId, worksheetNumber: 0, submittedOn: submittedOnDate }
                            });
                            if (existing) {
                                await prisma.worksheet.update({
                                    where: { id: existing.id },
                                    data: {
                                        grade: 0,
                                        isAbsent: true,
                                        status: ProcessingStatus.COMPLETED,
                                        worksheetNumber: 0
                                    }
                                });
                            } else {
                                throw upsertError;
                            }
                        } else {
                            throw upsertError;
                        }
                    }
                    results.saved++;
                    continue;
                }

                // Handle graded worksheets
                if (!worksheetNumber || worksheetNumber <= 0) {
                    results.failed++;
                    results.errors.push({ studentId, error: 'Invalid worksheet number' });
                    continue;
                }

                const gradeValue = parseFloat(grade);
                if (isNaN(gradeValue) || gradeValue < 0 || gradeValue > 40) {
                    results.failed++;
                    results.errors.push({ studentId, error: 'Invalid grade (must be 0-40)' });
                    continue;
                }

                // Find template (optional - may not exist for all worksheet numbers)
                const worksheetNum = parseInt(worksheetNumber);
                const template = await prisma.worksheetTemplate.findFirst({
                    where: { worksheetNumber: worksheetNum }
                });

                // Check if worksheet exists
                const existing = await prisma.worksheet.findFirst({
                    where: {
                        studentId,
                        classId,
                        worksheetNumber: worksheetNum,
                        submittedOn: submittedOnDate
                    }
                });

                try {
                    await prisma.worksheet.upsert({
                        where: {
                            unique_worksheet_per_student_day: {
                                studentId,
                                classId,
                                worksheetNumber: worksheetNum,
                                submittedOn: submittedOnDate
                            }
                        },
                        update: {
                            grade: gradeValue,
                            status: ProcessingStatus.COMPLETED,
                            isRepeated: isRepeated || false,
                            isIncorrectGrade: isIncorrectGrade || false,
                            gradingDetails: gradingDetails || undefined,
                            wrongQuestionNumbers: wrongQuestionNumbers || undefined,
                            worksheetNumber: worksheetNum
                        },
                        create: {
                            classId,
                            studentId,
                            submittedById,
                            templateId: template?.id,
                            worksheetNumber: worksheetNum,
                            grade: gradeValue,
                            status: ProcessingStatus.COMPLETED,
                            outOf: 40,
                            submittedOn: submittedOnDate,
                            isAbsent: false,
                            isRepeated: isRepeated || false,
                            isIncorrectGrade: isIncorrectGrade || false,
                            gradingDetails: gradingDetails || undefined,
                            wrongQuestionNumbers: wrongQuestionNumbers || undefined
                        }
                    });
                } catch (upsertError: any) {
                    if (upsertError?.code === 'P2002') {
                        const found = await prisma.worksheet.findFirst({
                            where: { studentId, classId, worksheetNumber: worksheetNum, submittedOn: submittedOnDate }
                        });
                        if (found) {
                            await prisma.worksheet.update({
                                where: { id: found.id },
                                data: {
                                    grade: gradeValue,
                                    status: ProcessingStatus.COMPLETED,
                                    isRepeated: isRepeated || false,
                                    isIncorrectGrade: isIncorrectGrade || false,
                                    gradingDetails: gradingDetails || undefined,
                                    wrongQuestionNumbers: wrongQuestionNumbers || undefined,
                                    worksheetNumber: worksheetNum
                                }
                            });
                        } else {
                            throw upsertError;
                        }
                    } else {
                        throw upsertError;
                    }
                }

                if (existing) {
                    results.updated++;
                } else {
                    results.saved++;
                }
            } catch (wsError: any) {
                results.failed++;
                results.errors.push({
                    studentId,
                    error: wsError.message || 'Unknown error'
                });
            }
        }

        return res.status(200).json({
            success: true,
            ...results
        });
    } catch (error) {
        console.error('Batch save worksheets error:', error);
        return res.status(500).json({ message: 'Server error while saving worksheets' });
    }
};