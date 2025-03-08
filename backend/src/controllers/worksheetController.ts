import { Request, Response } from 'express';
import { validationResult } from 'express-validator';
import prisma from '../utils/prisma';
import { uploadToS3 } from '../services/s3Service';
import { enqueueWorksheet } from '../services/queueService';
import { ProcessingStatus } from '@prisma/client';

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