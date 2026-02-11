import { Request, Response } from 'express';
import { ProcessingStatus, GradingJobStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import fetch from 'node-fetch';
import FormData from 'form-data';
import { scheduleGrading } from '../services/gradingLimiter';
import { logError } from '../services/errorLogService';
import { aiGradingLogger } from '../services/logger';

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
    formData: FormData,
    jobId?: string
): Promise<PythonApiResponse> {
    const maxRetries = 3;
    const baseDelayMs = 1000;
    let lastError: Error | null = null;
    const timer = aiGradingLogger.startTimer();

    aiGradingLogger.info('Python API call started', {
        jobId,
        token_no,
        worksheet_name,
        maxRetries
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            aiGradingLogger.debug(`Attempt ${attempt}/${maxRetries}`, { jobId, token_no });

            const abortController = new AbortController();
            const fetchTimeout = setTimeout(() => abortController.abort(), 5 * 60 * 1000); // 5 minute timeout

            let response;
            try {
                response = await scheduleGrading(() =>
                    fetch(`${url}/process-worksheets?token_no=${encodeURIComponent(token_no)}&worksheet_name=${encodeURIComponent(worksheet_name)}`, {
                        method: 'POST',
                        body: formData,
                        headers: formData.getHeaders(),
                        signal: abortController.signal as any
                    })
                );
            } finally {
                clearTimeout(fetchTimeout);
            }

            const data: PythonApiResponse = await response.json();

            // Retry on server errors or rate limits
            if (response.status >= 500 || response.status === 429) {
                aiGradingLogger.warn(`Server error, will retry`, {
                    jobId,
                    status: response.status,
                    attempt
                });
                throw new Error(`Server error: ${response.status}`);
            }

            if (!response.ok || !data.success) {
                aiGradingLogger.error('API returned error', {
                    jobId,
                    status: response.status,
                    error: data.error
                });
                throw new Error(data.error || `API error: ${response.status}`);
            }

            timer.end('Python API call completed', {
                jobId,
                token_no,
                worksheet_name,
                grade: data.grade,
                totalQuestions: data.total_questions,
                correctAnswers: data.correct_answers,
                wrongAnswers: data.wrong_answers,
                attempt
            });

            return data;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // Don't retry client errors (4xx except 429)
            const msg = lastError.message;
            if (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) {
                aiGradingLogger.error('Client error, not retrying', {
                    jobId,
                    error: msg
                });
                throw lastError;
            }

            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                const jitter = delay * (0.7 + Math.random() * 0.6);
                aiGradingLogger.warn(`Retry scheduled`, {
                    jobId,
                    attempt,
                    nextAttemptIn: Math.round(jitter)
                });
                await new Promise(r => setTimeout(r, jitter));
            }
        }
    }

    // Log final failure
    aiGradingLogger.error('Python API call failed after all retries', {
        jobId,
        token_no,
        worksheet_name,
        error: lastError?.message
    }, lastError!);
    await logError('python-api', lastError!, { token_no, worksheet_name, jobId }).catch(() => { });

    throw lastError;
}

export const processWorksheets = async (req: Request, res: Response) => {
    const pythonApiUrl = process.env.PYTHON_API_URL;
    const requestTimer = aiGradingLogger.startTimer();

    if (!pythonApiUrl) {
        aiGradingLogger.error('PYTHON_API_URL not configured');
        return res.status(500).json({ success: false, error: 'PYTHON_API_URL not configured' });
    }

    const { token_no, worksheet_name, classId, studentId, studentName, worksheetNumber, submittedOn, isRepeated } = req.body;
    const submittedById = req.user?.userId;
    const filesCount = Array.isArray(req.files) ? req.files.length : 0;

    aiGradingLogger.info('Grading request received', {
        token_no,
        worksheetNumber,
        studentId,
        classId,
        submittedOn,
        filesCount,
        teacherId: submittedById
    });

    // Validation
    if (!token_no || !worksheet_name || !req.files || !Array.isArray(req.files) || req.files.length === 0) {
        aiGradingLogger.warn('Validation failed: missing files or token', { token_no, filesCount });
        return res.status(400).json({ success: false, error: 'Missing required fields' });
    }

    if (!classId || !studentId || !worksheetNumber || !submittedById) {
        aiGradingLogger.warn('Validation failed: missing required fields', { classId, studentId, worksheetNumber, submittedById });
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

        aiGradingLogger.info('Grading job created', {
            jobId: gradingJob.id,
            studentName: resolvedStudentName,
            worksheetNumber,
            status: 'QUEUED'
        });

        // Return immediately for polling
        res.status(202).json({
            success: true,
            jobId: gradingJob.id,
            status: 'queued',
            message: 'Job queued'
        });

        // === Background processing ===
        aiGradingLogger.info('Starting background processing', { jobId: gradingJob.id });

        // Update status
        await withRetry(() =>
            prisma.gradingJob.update({
                where: { id: gradingJob!.id },
                data: { status: GradingJobStatus.PROCESSING }
            })
        );

        aiGradingLogger.debug('Job status updated to PROCESSING', { jobId: gradingJob.id });

        // Prepare files
        const formData = new FormData();
        const fileDetails: { name: string; size: number; type: string }[] = [];
        for (const file of req.files as Express.Multer.File[]) {
            formData.append('files', file.buffer, {
                filename: file.originalname,
                contentType: file.mimetype
            });
            fileDetails.push({
                name: file.originalname,
                size: file.size,
                type: file.mimetype
            });
        }

        aiGradingLogger.debug('Files prepared for API call', { jobId: gradingJob.id, files: fileDetails });

        // Call Python API
        const pythonResponse = await callPythonApi(pythonApiUrl, token_no, worksheet_name, formData, gradingJob.id);

        aiGradingLogger.info('AI grading completed', {
            jobId: gradingJob.id,
            grade: pythonResponse.grade,
            totalPossible: pythonResponse.total_possible,
            gradePercentage: pythonResponse.grade_percentage,
            totalQuestions: pythonResponse.total_questions,
            correctAnswers: pythonResponse.correct_answers,
            wrongAnswers: pythonResponse.wrong_answers,
            unanswered: pythonResponse.unanswered,
            mongoDbId: pythonResponse.mongodb_id
        });

        // Find template
        const worksheetNum = parseInt(worksheetNumber);
        const template = await withRetry(() =>
            prisma.worksheetTemplate.findFirst({ where: { worksheetNumber: worksheetNum } })
        );

        aiGradingLogger.debug('Template lookup', {
            jobId: gradingJob.id,
            worksheetNumber: worksheetNum,
            templateFound: !!template,
            templateId: template?.id
        });

        // Normalize submittedOn to midnight UTC for consistent unique constraint matching
        const submittedOnDate = submittedOn ? new Date(submittedOn) : new Date();
        submittedOnDate.setUTCHours(0, 0, 0, 0);

        // Compute wrongQuestionNumbers for storage
        const wrongQuestionNumbers = [
            ...(pythonResponse.wrong_questions || []).map((q: any) => q.question_number),
            ...(pythonResponse.unanswered_questions || []).map((q: any) => q.question_number)
        ].sort((a, b) => a - b).join(', ') || null;

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
        let wasCreated = false;

        const updateData = {
            grade: pythonResponse.grade,
            status: ProcessingStatus.COMPLETED,
            outOf: pythonResponse.total_possible || 40,
            mongoDbId: pythonResponse.mongodb_id,
            gradingDetails,
            wrongQuestionNumbers,
            isRepeated: isRepeated || false
        };

        const createData = {
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
            gradingDetails,
            wrongQuestionNumbers
        };

        try {
            if (template?.id) {
                // Template found → use Prisma upsert (works correctly with non-null templateId)
                const existing = await prisma.worksheet.findFirst({
                    where: { studentId, classId, templateId: template.id, submittedOn: submittedOnDate }
                });
                wasCreated = !existing;

                worksheet = await prisma.worksheet.upsert({
                    where: {
                        unique_worksheet_per_student_day: {
                            studentId,
                            classId,
                            templateId: template.id,
                            submittedOn: submittedOnDate
                        }
                    },
                    update: updateData,
                    create: createData
                });
            } else {
                // No template → can't use upsert (Prisma can't match composite unique with NULL templateId)
                // Just create directly — PostgreSQL allows multiple NULLs in unique indexes
                worksheet = await prisma.worksheet.create({ data: createData });
                wasCreated = true;
            }

            aiGradingLogger.info('Worksheet saved to database', {
                jobId: gradingJob.id,
                worksheetId: worksheet.id,
                action: wasCreated ? 'CREATED' : 'UPDATED',
                grade: pythonResponse.grade,
                wrongQuestionNumbers
            });
        } catch (saveError: any) {
            if (saveError?.code === 'P2002') {
                // Race condition: another concurrent save created the record between our check and insert
                // Find the existing worksheet and update it
                aiGradingLogger.warn('Unique constraint hit, falling back to update', {
                    jobId: gradingJob.id,
                    error: saveError.message
                });

                const existing = await prisma.worksheet.findFirst({
                    where: {
                        studentId,
                        classId,
                        templateId: template?.id ?? null,
                        submittedOn: submittedOnDate
                    }
                });

                if (existing) {
                    worksheet = await prisma.worksheet.update({
                        where: { id: existing.id },
                        data: updateData
                    });
                    wasCreated = false;

                    aiGradingLogger.info('Worksheet updated via fallback', {
                        jobId: gradingJob.id,
                        worksheetId: worksheet.id
                    });
                } else {
                    throw saveError;
                }
            } else {
                throw saveError;
            }
        }

        // Update job to completed
        await withRetry(() =>
            prisma.gradingJob.update({
                where: { id: gradingJob!.id },
                data: {
                    status: GradingJobStatus.COMPLETED,
                    worksheetId: worksheet.id,
                    completedAt: new Date()
                }
            })
        ).catch((err) => {
            aiGradingLogger.warn('Failed to update job status to COMPLETED', {
                jobId: gradingJob!.id,
                error: err.message
            });
        });

        requestTimer.end('Grading request completed successfully', {
            jobId: gradingJob.id,
            worksheetId: worksheet.id,
            grade: pythonResponse.grade,
            action: wasCreated ? 'CREATED' : 'UPDATED'
        });

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        aiGradingLogger.error('Grading failed', {
            jobId: gradingJob?.id,
            studentId,
            classId,
            worksheetNumber,
            error: errorMessage
        }, error instanceof Error ? error : undefined);

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

        requestTimer.end('Grading request failed', {
            jobId: gradingJob?.id,
            error: errorMessage
        });
    }
};
