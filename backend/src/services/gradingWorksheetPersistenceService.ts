import { GradingJob, Prisma, ProcessingStatus } from '@prisma/client';
import prisma from '../utils/prisma';
import { withRetry } from '../utils/retry';
import { GradingApiResponse } from './gradingTypes';

export interface PersistWorksheetResult {
    worksheetId: string;
    action: 'CREATED' | 'UPDATED';
    grade: number | null;
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
    gradingResponse: GradingApiResponse
): Promise<PersistWorksheetResult> {
    if (!gradingResponse.success) {
        throw new Error(gradingResponse.error || 'Grading response was not successful');
    }

    const template = await withRetry(() =>
        prisma.worksheetTemplate.findFirst({
            where: { worksheetNumber: job.worksheetNumber },
            select: { id: true }
        })
    );

    const submittedOnDate = normalizeSubmittedOnDate(job.submittedOn);
    const gradingDetails = buildGradingDetails(gradingResponse);
    const wrongQuestionNumbers = buildWrongQuestionNumbers(gradingResponse);

    const existing = await prisma.worksheet.findFirst({
        where: {
            studentId: job.studentId,
            classId: job.classId,
            worksheetNumber: job.worksheetNumber,
            submittedOn: submittedOnDate
        },
        select: { id: true }
    });

    const wasCreated = !existing;

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

        // If the DB is missing the unique index that Prisma uses for upsert ON CONFLICT,
        // fall back to a non-upsert path so grading can still complete.
        if (
            message.includes('no unique or exclusion constraint matching the ON CONFLICT specification') ||
            message.includes('code: \"42P10\"') ||
            message.includes('code: 42P10')
        ) {
            if (existing) {
                worksheet = await prisma.worksheet.update({
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
                worksheet = await prisma.worksheet.create({
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
            throw error;
        }
    }

    return {
        worksheetId: worksheet.id,
        action: wasCreated ? 'CREATED' : 'UPDATED',
        grade: gradingResponse.grade ?? null
    };
}

export async function persistWorksheetForGradingJobId(
    jobId: string,
    gradingResponse: GradingApiResponse
): Promise<PersistWorksheetResult> {
    const job = await prisma.gradingJob.findUnique({
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

    return persistWorksheetForGradingJob(job, gradingResponse);
}
