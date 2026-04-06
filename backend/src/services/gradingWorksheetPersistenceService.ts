import { GradingJob, Prisma, ProcessingStatus } from '@prisma/client';
import config from '../config/env';
import prisma from '../utils/prisma';
import { withRetry } from '../utils/retry';
import { summarizeError, summarizeGradingJobContext, summarizeGradingResponse } from './gradingDiagnostics';
import { GradingApiResponse } from './gradingTypes';
import { aiGradingLogger } from './logger';
import { captureGradingPipelineEvent } from './posthogService';

export interface PersistWorksheetResult {
    worksheetId: string;
    action: 'CREATED' | 'UPDATED';
    grade: number | null;
}

type DbClient = Prisma.TransactionClient | typeof prisma;

interface PersistWorksheetDiagnosticsOptions {
    jobId?: string;
}

function normalizeSubmittedOnDate(submittedOn: Date | null): Date {
    const date = submittedOn ? new Date(submittedOn) : new Date();
    date.setUTCHours(0, 0, 0, 0);
    return date;
}

function buildGradingDetails(gradingResponse: GradingApiResponse): Prisma.InputJsonValue {
    return {
        total_possible: gradingResponse.total_possible,
        grade_percentage: gradingResponse.grade_percentage,
        total_questions: gradingResponse.total_questions,
        correct_answers: gradingResponse.correct_answers,
        wrong_answers: gradingResponse.wrong_answers,
        unanswered: gradingResponse.unanswered,
        question_scores: gradingResponse.question_scores,
        wrong_questions: gradingResponse.wrong_questions,
        correct_questions: gradingResponse.correct_questions,
        unanswered_questions: gradingResponse.unanswered_questions,
        overall_feedback: gradingResponse.overall_feedback
    } as Prisma.InputJsonValue;
}

function buildWrongQuestionNumbers(gradingResponse: GradingApiResponse): string | null {
    const wrong = [
        ...(gradingResponse.wrong_questions || []).map((q) => q.question_number),
        ...(gradingResponse.unanswered_questions || []).map((q) => q.question_number)
    ];

    if (!wrong.length) {
        return null;
    }

    return wrong.sort((a, b) => a - b).join(', ');
}

export async function persistWorksheetForGradingJob(
    job: Pick<
        GradingJob,
        | 'studentId'
        | 'classId'
        | 'teacherId'
        | 'worksheetNumber'
        | 'submittedOn'
        | 'isRepeated'
    >,
    gradingResponse: GradingApiResponse,
    db: DbClient = prisma,
    diagnostics: PersistWorksheetDiagnosticsOptions = {}
): Promise<PersistWorksheetResult> {
    const persistenceStartedAt = Date.now();
    const distinctId = diagnostics.jobId || job.studentId;
    const baseDiagnostics = {
        jobId: diagnostics.jobId,
        ...summarizeGradingJobContext(job),
        gradingResponseSummary: summarizeGradingResponse(gradingResponse)
    };

    if (!gradingResponse.success) {
        const error = new Error(gradingResponse.error || 'Grading response was not successful');
        aiGradingLogger.warn('Worksheet persistence rejected unsuccessful grading response', baseDiagnostics);
        captureGradingPipelineEvent('worksheet_persist_rejected_response', distinctId, {
            ...baseDiagnostics,
            persistenceDurationMs: Date.now() - persistenceStartedAt
        });
        throw error;
    }

    const template = await withRetry(() =>
        db.worksheetTemplate.findFirst({
            where: { worksheetNumber: job.worksheetNumber },
            select: { id: true }
        })
    );

    const submittedOnDate = normalizeSubmittedOnDate(job.submittedOn);
    const gradingDetails = buildGradingDetails(gradingResponse);
    const wrongQuestionNumbers = buildWrongQuestionNumbers(gradingResponse);

    const existing = await db.worksheet.findFirst({
        where: {
            studentId: job.studentId,
            classId: job.classId,
            worksheetNumber: job.worksheetNumber,
            submittedOn: submittedOnDate
        },
        select: { id: true }
    });

    const wasCreated = !existing;
    const diagnosticsContext = {
        ...baseDiagnostics,
        submittedOnDate: submittedOnDate.toISOString(),
        templateId: template?.id || null,
        existingWorksheetId: existing?.id || null
    };

    let worksheet;
    try {
        worksheet = await db.worksheet.upsert({
            where: {
                unique_worksheet_per_student_day: {
                    studentId: job.studentId,
                    classId: job.classId,
                    worksheetNumber: job.worksheetNumber,
                    submittedOn: submittedOnDate
                }
            },
            update: {
                grade: gradingResponse.grade,
                status: ProcessingStatus.COMPLETED,
                outOf: gradingResponse.total_possible || 40,
                mongoDbId: gradingResponse.mongodb_id,
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
                grade: gradingResponse.grade,
                notes: `Auto-graded worksheet ${job.worksheetNumber}`,
                status: ProcessingStatus.COMPLETED,
                outOf: gradingResponse.total_possible || 40,
                submittedOn: submittedOnDate,
                isAbsent: false,
                isRepeated: job.isRepeated,
                isCorrectGrade: false,
                isIncorrectGrade: false,
                mongoDbId: gradingResponse.mongodb_id,
                gradingDetails,
                wrongQuestionNumbers
            }
        });
    } catch (error: any) {
        const message = error instanceof Error ? error.message : String(error);
        const errorDiagnostics = {
            ...diagnosticsContext,
            persistenceDurationMs: Date.now() - persistenceStartedAt,
            ...summarizeError(error)
        };

        // If the DB is missing the unique index that Prisma uses for upsert ON CONFLICT,
        // fall back to a non-upsert path so grading can still complete.
        if (
            message.includes('no unique or exclusion constraint matching the ON CONFLICT specification') ||
            message.includes('code: \"42P10\"') ||
            message.includes('code: 42P10')
        ) {
            aiGradingLogger.warn('Worksheet upsert fell back because the unique index is missing', errorDiagnostics);
            captureGradingPipelineEvent('worksheet_persist_fallback_missing_unique_index', distinctId, errorDiagnostics);

            if (existing) {
                worksheet = await db.worksheet.update({
                    where: { id: existing.id },
                    data: {
                        grade: gradingResponse.grade,
                        status: ProcessingStatus.COMPLETED,
                        outOf: gradingResponse.total_possible || 40,
                        mongoDbId: gradingResponse.mongodb_id,
                        gradingDetails,
                        wrongQuestionNumbers,
                        isRepeated: job.isRepeated,
                        worksheetNumber: job.worksheetNumber
                    }
                });
            } else {
                worksheet = await db.worksheet.create({
                    data: {
                        classId: job.classId,
                        studentId: job.studentId,
                        submittedById: job.teacherId,
                        templateId: template?.id,
                        worksheetNumber: job.worksheetNumber,
                        grade: gradingResponse.grade,
                        notes: `Auto-graded worksheet ${job.worksheetNumber}`,
                        status: ProcessingStatus.COMPLETED,
                        outOf: gradingResponse.total_possible || 40,
                        submittedOn: submittedOnDate,
                        isAbsent: false,
                        isRepeated: job.isRepeated,
                        isCorrectGrade: false,
                        isIncorrectGrade: false,
                        mongoDbId: gradingResponse.mongodb_id,
                        gradingDetails,
                        wrongQuestionNumbers
                    }
                });
            }
        } else if (error?.code === 'P2002') {
            // Handle race conditions where the row was created between findFirst and create.

            const alreadyCreated = await db.worksheet.findFirst({
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

            worksheet = await db.worksheet.update({
                where: { id: alreadyCreated.id },
                data: {
                    grade: gradingResponse.grade,
                    status: ProcessingStatus.COMPLETED,
                    outOf: gradingResponse.total_possible || 40,
                    mongoDbId: gradingResponse.mongodb_id,
                    gradingDetails,
                    wrongQuestionNumbers,
                    isRepeated: job.isRepeated
                }
            });
        } else {
            aiGradingLogger.error(
                'Worksheet persistence failed',
                errorDiagnostics,
                error instanceof Error ? error : new Error(String(error))
            );
            captureGradingPipelineEvent('worksheet_persist_failed', distinctId, errorDiagnostics);
            throw error;
        }
    }

    const persistenceDurationMs = Date.now() - persistenceStartedAt;
    if (persistenceDurationMs >= config.diagnostics.gradingPersistenceSlowMs) {
        const slowDiagnostics = {
            ...diagnosticsContext,
            persistenceDurationMs,
            worksheetId: worksheet.id,
            action: wasCreated ? 'CREATED' : 'UPDATED'
        };
        aiGradingLogger.warn('Worksheet persistence slow', slowDiagnostics);
        captureGradingPipelineEvent('worksheet_persist_slow', distinctId, slowDiagnostics);
    }

    return {
        worksheetId: worksheet.id,
        action: wasCreated ? 'CREATED' : 'UPDATED',
        grade: gradingResponse.grade ?? null
    };
}

export async function persistWorksheetForGradingJobId(
    jobId: string,
    gradingResponse: GradingApiResponse,
    db: DbClient = prisma
): Promise<PersistWorksheetResult> {
    const job = await db.gradingJob.findUnique({
        where: { id: jobId },
        select: {
            studentId: true,
            classId: true,
            teacherId: true,
            worksheetNumber: true,
            submittedOn: true,
            isRepeated: true
        }
    });

    if (!job) {
        throw new Error(`Grading job not found: ${jobId}`);
    }

    return persistWorksheetForGradingJob(job, gradingResponse, db, { jobId });
}
