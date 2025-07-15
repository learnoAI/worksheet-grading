import { Request, Response } from 'express';
import { ProcessingStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import fetch from 'node-fetch';
import FormData from 'form-data';

interface PythonApiResponse {
    success: boolean;
    token_no?: string;
    worksheet_name?: string;
    mongodb_id?: string;
    grade?: number;
    total_possible?: number;
    grade_percentage?: number;
    total_questions?: number;
    correct_answers?: number;
    wrong_answers?: number;
    unanswered?: number;
    question_scores?: any[];
    wrong_questions?: any[];
    correct_questions?: any[];
    unanswered_questions?: any[];
    overall_feedback?: string;
    error?: string;
    // Fields we add in our backend
    worksheetId?: string;
    databaseWarning?: string;
}

export const processWorksheets = async (req: Request, res: Response) => {
    const formData = new FormData();
    const pythonApiUrl = process.env.PYTHON_API_URL;
    
    if (!pythonApiUrl) {
        console.error('PYTHON_API_URL environment variable not set');
        return res.status(500).json({ 
            success: false, 
            error: 'Server configuration error: PYTHON_API_URL not set'
        });
    }

    try {        // Extract data from the request
        const { token_no, worksheet_name } = req.body;
        
        if (!token_no || !worksheet_name) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: token_no and worksheet_name are required'
            });
        }
          // Add files to form data (don't add token_no and worksheet_name as they go in query params)
        if (req.files && Array.isArray(req.files)) {
            if (req.files.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'No files uploaded'
                });
            }
            
            console.log(`Processing ${req.files.length} files...`);
            
            for (const file of req.files as Express.Multer.File[]) {
                console.log(`File: ${file.originalname}, size: ${file.size}, type: ${file.mimetype}`);
                formData.append('files', file.buffer, { 
                    filename: file.originalname, 
                    contentType: file.mimetype 
                });
            }
        } else {
            return res.status(400).json({
                success: false,
                error: 'Files are required'
            });
        }
          console.log(`Calling Python API at ${pythonApiUrl}/process-worksheets with token_no: ${token_no}, worksheet_name: ${worksheet_name}`);
        
        // Make request to Python API with query parameters
        const response = await fetch(`${pythonApiUrl}/process-worksheets?token_no=${encodeURIComponent(token_no)}&worksheet_name=${encodeURIComponent(worksheet_name)}`, {
            method: 'POST',
            body: formData,
            headers: formData.getHeaders()
        });
        
        // Get response from Python API
        const pythonResponse: PythonApiResponse = await response.json();
          if (!response.ok || !pythonResponse.success) {
            console.error('Error from Python API:', pythonResponse);
            return res.status(400).json(pythonResponse);
        }

        console.log('Python API response:', pythonResponse);

        // Validate required fields from Python API
        if (!pythonResponse.mongodb_id || pythonResponse.grade === undefined) {
            console.error('Python API response missing required fields (mongodb_id or grade):', pythonResponse);
            return res.status(400).json({
                success: false,
                error: 'Invalid response from processing service: missing required fields'
            });
        }
        
        // If Python API was successful, create the worksheet record in our database
        if (pythonResponse.success) {
            try {
                // Extract database fields from request
                const { classId, studentId, worksheetNumber, submittedOn } = req.body;
                const submittedById = req.user?.userId;
                
                if (!classId || !studentId || !worksheetNumber || !submittedById) {
                    console.warn('Missing database fields, worksheet processed but not saved to database');
                    pythonResponse.databaseWarning = 'Worksheet processed successfully but missing required fields to save to database';
                } else {
                    // Verify that the class and student exist before creating worksheet
                    const classExists = await prisma.class.findUnique({
                        where: { id: classId }
                    });
                    
                    const studentExists = await prisma.user.findFirst({
                        where: {
                            id: studentId,
                            role: 'STUDENT'
                        }
                    });
                    
                    if (!classExists) {
                        console.warn(`Class ${classId} not found, cannot save worksheet to database`);
                        pythonResponse.databaseWarning = 'Worksheet processed successfully but class not found in database';
                    } else if (!studentExists) {
                        console.warn(`Student ${studentId} not found, cannot save worksheet to database`);
                        pythonResponse.databaseWarning = 'Worksheet processed successfully but student not found in database';
                    } else {
                        // Find the template by worksheet number
                        const template = await prisma.worksheetTemplate.findFirst({
                            where: {
                                worksheetNumber: parseInt(worksheetNumber)
                            }
                        });
                        
                        if (!template) {
                            console.warn(`No template found for worksheet number ${worksheetNumber}, creating without template`);
                        }
                          // Create worksheet record with MongoDB ID and grade from Python API
                        const worksheet = await prisma.worksheet.create({
                            data: {
                                class: {
                                    connect: { id: classId }
                                },
                                student: {
                                    connect: { id: studentId }
                                },
                                submittedBy: {
                                    connect: { id: submittedById }
                                },
                                ...(template ? {
                                    template: {
                                        connect: { id: template.id }
                                    }
                                } : {}),
                                grade: pythonResponse.grade || 0,
                                notes: `Auto-graded worksheet ${worksheetNumber}`,
                                status: ProcessingStatus.COMPLETED,
                                outOf: pythonResponse.total_possible || 40,
                                submittedOn: submittedOn ? new Date(submittedOn) : new Date(),
                                isAbsent: false,
                                isRepeated: false,
                                isCorrectGrade: false,
                                ...(pythonResponse.mongodb_id ? { 
                                    mongoDbId: pythonResponse.mongodb_id 
                                } : {}),
                                // Store the complete grading details
                                gradingDetails: {
                                    total_possible: pythonResponse.total_possible,
                                    grade_percentage: pythonResponse.grade_percentage,
                                    total_questions: pythonResponse.total_questions,
                                    correct_answers: pythonResponse.correct_answers,
                                    wrong_answers: pythonResponse.wrong_answers,
                                    unanswered: pythonResponse.unanswered,
                                    question_scores: pythonResponse.question_scores,
                                    wrong_questions: pythonResponse.wrong_questions,
                                    correct_questions: pythonResponse.correct_questions,
                                    unanswered_questions: pythonResponse.unanswered_questions,
                                    overall_feedback: pythonResponse.overall_feedback
                                }
                            }
                        });
                    
                        console.log(`Successfully created worksheet record: ${worksheet.id} with MongoDB ID: ${worksheet.mongoDbId || 'none'}`);
                        
                        // Add worksheet ID to response
                        pythonResponse.worksheetId = worksheet.id;
                    }
                }
            } catch (dbError) {
                console.error('Error creating worksheet record:', dbError);
                // Don't fail the entire request if database save fails
                pythonResponse.databaseWarning = 'Worksheet processed successfully but failed to save to database';
            }
        }
        
        // Return the response from Python API (with any additional fields we added)
        return res.status(200).json(pythonResponse);
    } catch (error) {
        console.error('Error processing worksheets:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Error processing worksheets' 
        });
    }
};

/**
 * Create a graded worksheet with MongoDbId
 */
export const createGradedWorksheetWithMongoId = async (req: Request, res: Response) => {
    const { classId, studentId, worksheetNumber, grade, notes, submittedOn, isAbsent, isRepeated, isCorrectGrade, mongoDbId, gradingDetails } = req.body;
    const submittedById = req.user?.userId;

    // Add logging to track the incoming requests
    console.log('Create worksheet request:', { 
        classId, 
        studentId, 
        worksheetNumber, 
        grade, 
        isAbsent, 
        isRepeated, 
        isCorrectGrade,
        submittedOn,
        mongoDbId 
    });

    try {
        // If student is absent, create a record marking them as absent
        if (isAbsent) {
            console.log('Creating absent record for student');
            const worksheet = await prisma.worksheet.create({
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
                    grade: 0, // Default grade for absent student
                    notes: notes || 'Student absent',
                    status: ProcessingStatus.COMPLETED,
                    outOf: 40,
                    submittedOn: submittedOn ? new Date(submittedOn) : undefined,
                    isAbsent: true,
                    isRepeated: false,
                    isCorrectGrade: false,
                    // No MongoDB ID for absent students
                }
            });

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

        if (!template) {
            return res.status(404).json({ message: `No template found for worksheet number ${worksheetNum}` });
        }

        const worksheet = await prisma.worksheet.create({
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
                template: {
                    connect: { id: template.id }
                },
                grade: gradeValue,
                notes,
                status: ProcessingStatus.COMPLETED,
                outOf: 40,
                submittedOn: submittedOn ? new Date(submittedOn) : undefined,
                isAbsent: false,
                isRepeated: isRepeated || false,
                isCorrectGrade: isCorrectGrade || false,
                ...(mongoDbId ? { mongoDbId } : {}), // Store the MongoDB ID if provided
                ...(gradingDetails ? { gradingDetails } : {}) // Store grading details if provided
            }
        });

        console.log(`Successfully created worksheet for student ${studentId}, worksheet number ${worksheetNum}, MongoDB ID: ${mongoDbId || 'none'}`);
        res.status(201).json(worksheet);
    } catch (error) {
        console.error('Create graded worksheet error:', error);
        return res.status(500).json({ message: 'Server error while creating worksheet' });
    }
};
