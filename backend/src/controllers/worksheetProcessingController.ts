import { Request, Response } from 'express';
import { ProcessingStatus, GradingJobStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { scheduleGrading } from '../services/gradingLimiter';
import { logError } from '../services/errorLogService';

interface PythonApiResponse {
    success: boolean;
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
}

// Retry with exponential backoff + jitter (prevents thundering herd)
async function withRetry<T>(
    fn: () => Promise<T>,
    maxRetries = 3,
    baseDelayMs = 500
): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            if (attempt < maxRetries) {
                // Exponential backoff with jitter (±30%)
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                const jitter = delay * (0.7 + Math.random() * 0.6);
                await new Promise(r => setTimeout(r, jitter));
            }
        }
    }

    throw lastError;
}

// Python API call with retry (network-aware)
async function callPythonApi(
    url: string,
    token_no: string,
    worksheet_name: string,
    formData: FormData
): Promise<PythonApiResponse> {
    const maxRetries = 3;
    const baseDelayMs = 1000;
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const response = await scheduleGrading(() =>
                fetch(`${url}/process-worksheets?token_no=${encodeURIComponent(token_no)}&worksheet_name=${encodeURIComponent(worksheet_name)}`, {
                    method: 'POST',
                    body: formData,
                    headers: formData.getHeaders()
                })
            );

            const data: PythonApiResponse = await response.json();

            // Retry on server errors or rate limits
            if (response.status >= 500 || response.status === 429) {
                throw new Error(`Server error: ${response.status}`);
            }

            if (!response.ok || !data.success) {
                throw new Error(data.error || `API error: ${response.status}`);
            }

            return data;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Don't retry client errors (4xx except 429)
            const msg = lastError.message;
            if (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) {
                throw lastError;
            }

            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                const jitter = delay * (0.7 + Math.random() * 0.6);
                await new Promise(r => setTimeout(r, jitter));
            }
        }
    }

    // Log final failure
    await logError('python-api', lastError!, { token_no, worksheet_name }).catch(() => { });

    throw lastError;
}

export const processWorksheets = async (req: Request, res: Response) => {
    const pythonApiUrl = process.env.PYTHON_API_URL;

    if (!pythonApiUrl) {
        return res.status(500).json({ success: false, error: 'PYTHON_API_URL not configured' });
    }

    const { token_no, worksheet_name, classId, studentId, studentName, worksheetNumber, submittedOn, isRepeated } = req.body;
    const submittedById = req.user?.userId;

    // Validation
    if (!token_no || !worksheet_name || !req.files || !Array.isArray(req.files) || req.files.length === 0) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (!classId || !studentId || !worksheetNumber || !submittedById) {
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    let gradingJob: { id: string } | null = null;

    try {
        // Resolve student name (from request or DB)
        const resolvedStudentName = studentName ||
            (await prisma.user.findUnique({ where: { id: studentId }, select: { name: true } }))?.name ||
            'Unknown';

        // Create job
        gradingJob = await withRetry(() =>
            prisma.gradingJob.create({
                data: {
                    studentId,
                    studentName: resolvedStudentName,
                    worksheetNumber: parseInt(worksheetNumber),
                    classId,
                    teacherId: submittedById,
                    status: GradingJobStatus.QUEUED,
                    submittedOn: submittedOn ? new Date(submittedOn) : new Date()
                }
            })
        );

        // Return immediately for polling
        res.status(202).json({
            success: true,
            jobId: gradingJob.id,
            status: 'queued',
            message: 'Job queued'
        });

        // === Background processing ===

        // Update status
        await withRetry(() =>
            prisma.gradingJob.update({
                where: { id: gradingJob!.id },
                data: { status: GradingJobStatus.PROCESSING }
            })
        );

        // Prepare files
        const formData = new FormData();
        for (const file of req.files as Express.Multer.File[]) {
            formData.append('files', file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype
            });
        }

        // Call Python API
        const pythonResponse = await callPythonApi(pythonApiUrl, token_no, worksheet_name, formData);

        // Find template
        const worksheetNum = parseInt(worksheetNumber);
        const template = await withRetry(() =>
            prisma.worksheetTemplate.findFirst({ where: { worksheetNumber: worksheetNum } })
        );

        // Atomic upsert to prevent race conditions
        const submittedOnDate = submittedOn ? new Date(submittedOn) : new Date();
        const dayStart = new Date(submittedOnDate);
        dayStart.setHours(0, 0, 0, 0);
        const dayEnd = new Date(submittedOnDate);
        dayEnd.setHours(23, 59, 59, 999);

        const gradingDetails = {
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
        };

        let worksheet;

        // Use a transaction to ensure atomicity: find + create/update in one go
        worksheet = await withRetry(() =>
            prisma.$transaction(async (tx) => {
                // Find existing worksheet within transaction
                const existing = await tx.worksheet.findFirst({
                    where: {
                        studentId,
                        classId,
                        templateId: template?.id,
                        submittedOn: { gte: dayStart, lte: dayEnd },
                        isRepeated: false
                    }
                });

                if (existing && !isRepeated) {
                    // Update existing worksheet
                    return tx.worksheet.update({
                        where: { id: existing.id },
                        data: {
                            grade: pythonResponse.grade,
                            status: ProcessingStatus.COMPLETED,
                            outOf: pythonResponse.total_possible || 40,
                            mongoDbId: pythonResponse.mongodb_id,
                            gradingDetails
                        }
                    });
                } else {
                    // Create new worksheet
                    return tx.worksheet.create({
                        data: {
                            classId,
                            studentId,
                            submittedById,
                            templateId: template?.id,
                            grade: pythonResponse.grade,
                            notes: `Auto-graded worksheet ${worksheetNumber}`,
                            status: ProcessingStatus.COMPLETED,
                            outOf: pythonResponse.total_possible || 40,
                            submittedOn: submittedOnDate,
                            isAbsent: false,
                            isRepeated: isRepeated || false,
                            isCorrectGrade: false,
                            isIncorrectGrade: false,
                            mongoDbId: pythonResponse.mongodb_id,
                            gradingDetails
                        }
                    });
                }
            })
        );

        // Update job to completed (non-critical)
        await withRetry(() =>
            prisma.gradingJob.update({
                where: { id: gradingJob!.id },
                data: {
                    status: GradingJobStatus.COMPLETED,
                    worksheetId: worksheet.id,
                    completedAt: new Date()
                }
            })
        ).catch(() => { /* Worksheet saved, job update non-critical */ });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error('Grading failed:', errorMessage);

        // Log to MongoDB error_logs collection
        await logError('grading', error instanceof Error ? error : new Error(errorMessage), {
            jobId: gradingJob?.id,
            studentId: req.body.studentId,
            classId: req.body.classId,
            worksheetNumber: req.body.worksheetNumber
        }).catch(() => { });

        if (gradingJob) {
            await prisma.gradingJob.update({
                where: { id: gradingJob.id },
                data: {
                    status: GradingJobStatus.FAILED,
                    errorMessage,
                    completedAt: new Date()
                }
            }).catch(() => { });
        }
    }
};
