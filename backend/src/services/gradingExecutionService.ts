import { GradingJob, Prisma, ProcessingStatus } from '@prisma/client';
import fetch from 'node-fetch';
import FormData from 'form-data';
import prisma from '../utils/prisma';
import { downloadFromS3 } from './s3Service';
import { scheduleGrading } from './gradingLimiter';
import { aiGradingLogger } from './logger';

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
    question_scores?: unknown[];
    wrong_questions?: Array<{ question_number: number }>;
    correct_questions?: unknown[];
    unanswered_questions?: Array<{ question_number: number }>;
    overall_feedback?: string;
    error?: string;
}

interface ExecuteGradingJobResult {
    worksheetId: string;
    action: 'CREATED' | 'UPDATED';
    grade: number | null;
}

interface ExecuteGradingJobOptions {
    onHeartbeat?: () => Promise<void>;
}

interface PythonApiFile {
    filename: string;
    contentType: string;
    buffer: Buffer;
}

interface GradingJobWithImages extends GradingJob {
    images: {
        id: string;
        s3Key: string;
        storageProvider: 'S3' | 'R2';
        pageNumber: number;
        mimeType: string;
    }[];
}

export async function withRetry<T>(
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
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                const jitter = delay * (0.7 + Math.random() * 0.6);
                await new Promise((resolve) => setTimeout(resolve, jitter));
            }
        }
    }

    throw lastError;
}

async function callPythonApi(
    url: string,
    tokenNo: string,
    worksheetName: string,
    files: PythonApiFile[],
    jobId: string,
    onHeartbeat?: () => Promise<void>
): Promise<PythonApiResponse> {
    const maxRetries = 3;
    const baseDelayMs = 1000;
    let lastError: Error | null = null;

    aiGradingLogger.info('Python API call started', {
        jobId,
        token_no: tokenNo,
        worksheet_name: worksheetName,
        maxRetries
    });

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            if (onHeartbeat) {
                await onHeartbeat();
            }

            const formData = new FormData();
            for (const file of files) {
                formData.append('files', file.buffer, {
                    filename: file.filename,
                    contentType: file.contentType
                });
            }

            const response = await scheduleGrading(() =>
                fetch(`${url}/process-worksheets?token_no=${encodeURIComponent(tokenNo)}&worksheet_name=${encodeURIComponent(worksheetName)}`, {
                    method: 'POST',
                    body: formData,
                    headers: formData.getHeaders()
                })
            );

            const data = (await response.json()) as PythonApiResponse;

            if (response.status >= 500 || response.status === 429) {
                throw new Error(`Server error: ${response.status}`);
            }

            if (!response.ok || !data.success) {
                throw new Error(data.error || `API error: ${response.status}`);
            }

            aiGradingLogger.info('Python API call completed', {
                jobId,
                token_no: tokenNo,
                worksheet_name: worksheetName,
                attempt,
                grade: data.grade
            });

            return data;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            const msg = lastError.message;
            if (msg.includes('400') || msg.includes('401') || msg.includes('403') || msg.includes('404')) {
                throw lastError;
            }

            if (attempt < maxRetries) {
                const delay = baseDelayMs * Math.pow(2, attempt - 1);
                const jitter = delay * (0.7 + Math.random() * 0.6);
                await new Promise((resolve) => setTimeout(resolve, jitter));
            }
        }
    }

    throw lastError;
}

async function loadJobWithImages(jobId: string): Promise<GradingJobWithImages> {
    const job = await prisma.gradingJob.findUnique({
        where: { id: jobId },
        include: {
            images: {
                orderBy: { pageNumber: 'asc' },
                select: {
                    id: true,
                    s3Key: true,
                    storageProvider: true,
                    pageNumber: true,
                    mimeType: true
                }
            }
        }
    });

    if (!job) {
        throw new Error(`Grading job not found: ${jobId}`);
    }

    if (!job.tokenNo || !job.worksheetName) {
        throw new Error(`Grading job ${jobId} is missing token or worksheet name`);
    }

    if (!job.images.length) {
        throw new Error(`Grading job ${jobId} has no images`);
    }

    return job as GradingJobWithImages;
}

function normalizeSubmittedOnDate(submittedOn: Date | null): Date {
    const date = submittedOn ? new Date(submittedOn) : new Date();
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

function buildGradingDetails(pythonResponse: PythonApiResponse): Prisma.InputJsonValue {
    return {
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
    } as Prisma.InputJsonValue;
}

function buildWrongQuestionNumbers(pythonResponse: PythonApiResponse): string | null {
    const wrong = [
        ...(pythonResponse.wrong_questions || []).map((q) => q.question_number),
        ...(pythonResponse.unanswered_questions || []).map((q) => q.question_number)
    ];

    if (!wrong.length) {
        return null;
    }

    return wrong.sort((a, b) => a - b).join(', ');
}

export async function executeGradingJob(
    jobId: string,
    pythonApiUrl: string,
    options: ExecuteGradingJobOptions = {}
): Promise<ExecuteGradingJobResult> {
    const job = await loadJobWithImages(jobId);

    const files: PythonApiFile[] = [];
    for (const image of job.images) {
        const buffer = await downloadFromS3(image.s3Key, image.storageProvider === 'R2' ? 'r2' : 's3');
        files.push({
            filename: `page-${image.pageNumber}.jpg`,
            contentType: image.mimeType,
            buffer
        });
    }

    const pythonResponse = await callPythonApi(
        pythonApiUrl,
        job.tokenNo as string,
        job.worksheetName as string,
        files,
        jobId,
        options.onHeartbeat
    );

    const template = await withRetry(() =>
        prisma.worksheetTemplate.findFirst({
            where: { worksheetNumber: job.worksheetNumber },
            select: { id: true }
        })
    );

    const submittedOnDate = normalizeSubmittedOnDate(job.submittedOn);
    const gradingDetails = buildGradingDetails(pythonResponse);
    const wrongQuestionNumbers = buildWrongQuestionNumbers(pythonResponse);

    let wasCreated = false;

    const existing = await prisma.worksheet.findFirst({
        where: {
            studentId: job.studentId,
            classId: job.classId,
            worksheetNumber: job.worksheetNumber,
            submittedOn: submittedOnDate
        },
        select: { id: true }
    });

    wasCreated = !existing;

    let worksheet;
    try {
        worksheet = await prisma.worksheet.upsert({
            where: {
                unique_worksheet_per_student_day: {
                    studentId: job.studentId,
                    classId: job.classId,
                    worksheetNumber: job.worksheetNumber,
                    submittedOn: submittedOnDate
                }
            },
            update: {
                grade: pythonResponse.grade,
                status: ProcessingStatus.COMPLETED,
                outOf: pythonResponse.total_possible || 40,
                mongoDbId: pythonResponse.mongodb_id,
                gradingDetails,
                wrongQuestionNumbers,
                isRepeated: job.isRepeated,
                worksheetNumber: job.worksheetNumber
            },
            create: {
                classId: job.classId,
                studentId: job.studentId,
                submittedById: job.teacherId,
                templateId: template?.id,
                worksheetNumber: job.worksheetNumber,
                grade: pythonResponse.grade,
                notes: `Auto-graded worksheet ${job.worksheetNumber}`,
                status: ProcessingStatus.COMPLETED,
                outOf: pythonResponse.total_possible || 40,
                submittedOn: submittedOnDate,
                isAbsent: false,
                isRepeated: job.isRepeated,
                isCorrectGrade: false,
                isIncorrectGrade: false,
                mongoDbId: pythonResponse.mongodb_id,
                gradingDetails,
                wrongQuestionNumbers
            }
        });
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);

        // If the DB is missing the unique index that Prisma uses for upsert ON CONFLICT,
        // fall back to a non-upsert path so grading can still complete.
        if (
            message.includes('no unique or exclusion constraint matching the ON CONFLICT specification') ||
            message.includes('code: "42P10"') ||
            message.includes('code: 42P10')
        ) {
            if (existing) {
                worksheet = await prisma.worksheet.update({
                    where: { id: existing.id },
                    data: {
                        grade: pythonResponse.grade,
                        status: ProcessingStatus.COMPLETED,
                        outOf: pythonResponse.total_possible || 40,
                        mongoDbId: pythonResponse.mongodb_id,
                        gradingDetails,
                        wrongQuestionNumbers,
                        isRepeated: job.isRepeated,
                        worksheetNumber: job.worksheetNumber
                    }
                });
            } else {
                worksheet = await prisma.worksheet.create({
                    data: {
                        classId: job.classId,
                        studentId: job.studentId,
                        submittedById: job.teacherId,
                        templateId: template?.id,
                        worksheetNumber: job.worksheetNumber,
                        grade: pythonResponse.grade,
                        notes: `Auto-graded worksheet ${job.worksheetNumber}`,
                        status: ProcessingStatus.COMPLETED,
                        outOf: pythonResponse.total_possible || 40,
                        submittedOn: submittedOnDate,
                        isAbsent: false,
                        isRepeated: job.isRepeated,
                        isCorrectGrade: false,
                        isIncorrectGrade: false,
                        mongoDbId: pythonResponse.mongodb_id,
                        gradingDetails,
                        wrongQuestionNumbers
                    }
                });
            }
        } else if (error?.code === 'P2002') {
            // Handle race conditions where the row was created between findFirst and create.

            const alreadyCreated = await prisma.worksheet.findFirst({
                where: {
                    studentId: job.studentId,
                    classId: job.classId,
                    worksheetNumber: job.worksheetNumber,
                    submittedOn: submittedOnDate
                },
                select: { id: true }
            });

            if (!alreadyCreated) {
                throw error;
            }

            worksheet = await prisma.worksheet.update({
                where: { id: alreadyCreated.id },
                data: {
                    grade: pythonResponse.grade,
                    status: ProcessingStatus.COMPLETED,
                    outOf: pythonResponse.total_possible || 40,
                    mongoDbId: pythonResponse.mongodb_id,
                    gradingDetails,
                    wrongQuestionNumbers,
                    isRepeated: job.isRepeated
                }
            });
        } else {
            throw error;
        }
    }

    return {
        worksheetId: worksheet.id,
        action: wasCreated ? 'CREATED' : 'UPDATED',
        grade: pythonResponse.grade ?? null
    };
}
