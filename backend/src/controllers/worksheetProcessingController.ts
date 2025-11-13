import { Request, Response } from 'express';
import { ProcessingStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { scheduleGrading } from '../services/gradingLimiter';

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
    worksheetId?: string;
    databaseWarning?: string;
}

export const processWorksheets = async (req: Request, res: Response) => {
    const pythonApiUrl = process.env.PYTHON_API_URL;
    
    if (!pythonApiUrl) {
        return res.status(500).json({ 
            success: false, 
            error: 'PYTHON_API_URL not configured'
        });
    }

    try {
        const { token_no, worksheet_name, classId, studentId, worksheetNumber, submittedOn } = req.body;
        const submittedById = req.user?.userId;
        
        if (!token_no || !worksheet_name || !req.files || !Array.isArray(req.files) || req.files.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: token_no, worksheet_name, and files are required'
            });
        }

        const formData = new FormData();
        for (const file of req.files as Express.Multer.File[]) {
            formData.append('files', file.buffer, { 
                filename: file.originalname, 
                contentType: file.mimetype 
            });
        }

        // Call Python API
        const response = await scheduleGrading(() => 
            fetch(`${pythonApiUrl}/process-worksheets?token_no=${encodeURIComponent(token_no)}&worksheet_name=${encodeURIComponent(worksheet_name)}`, {
                method: 'POST',
                body: formData,
                headers: formData.getHeaders()
            })
        );
        
        const pythonResponse: PythonApiResponse = await response.json();
        
        if (!response.ok || !pythonResponse.success) {
            return res.status(400).json(pythonResponse);
        }

        // If all database fields are provided, save to database
        if (classId && studentId && worksheetNumber && submittedById) {
            const template = await prisma.worksheetTemplate.findFirst({
                where: { worksheetNumber: parseInt(worksheetNumber) }
            });

            const worksheet = await prisma.worksheet.create({
                data: {
                    classId,
                    studentId,
                    submittedById,
                    templateId: template?.id,
                    grade: pythonResponse.grade,
                    notes: `Auto-graded worksheet ${worksheetNumber}`,
                    status: ProcessingStatus.COMPLETED,
                    outOf: pythonResponse.total_possible || 40,
                    submittedOn: submittedOn ? new Date(submittedOn) : new Date(),
                    isAbsent: false,
                    isRepeated: false,
                    isCorrectGrade: false,
                    isIncorrectGrade: false,
                    mongoDbId: pythonResponse.mongodb_id,
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

            pythonResponse.worksheetId = worksheet.id;
        }
        
        return res.status(200).json(pythonResponse);
    } catch (error) {
        console.error('Error processing worksheets:', error);
        return res.status(500).json({ 
            success: false, 
            error: error instanceof Error ? error.message : 'Error processing worksheets' 
        });
    }
};
