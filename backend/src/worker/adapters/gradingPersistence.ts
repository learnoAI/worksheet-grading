/**
 * Persistence layer for the grading pipeline.
 *
 * Prisma-injected port of
 * `backend/src/services/gradingWorksheetPersistenceService.ts`. Takes a
 * grading API response, shapes it into `Worksheet` rows, and upserts
 * them — with two fallback paths for production quirks:
 *
 *   1. **Missing unique index** — some older environments are missing
 *      the `unique_worksheet_per_student_day` composite unique index that
 *      Postgres needs for `ON CONFLICT`. When we see the pg "42P10"
 *      error, fall back to find-then-update-or-create.
 *   2. **Race condition (P2002)** — Prisma's unique violation can fire
 *      when two calls interleave. Recover by finding the row and
 *      updating it.
 *
 * PostHog events: `worksheet_persist_rejected_response`,
 * `worksheet_persist_fallback_missing_unique_index`,
 * `worksheet_persist_failed`, `worksheet_persist_slow`. Dashboards key off
 * these names, so don't rename without coordinating.
 */

import { Prisma, ProcessingStatus, type GradingJob, type PrismaClient } from '@prisma/client';
import type { GradingApiResponse } from './gradingDiagnostics';
import {
  summarizeError,
  summarizeGradingJobContext,
  summarizeGradingResponse,
} from './gradingDiagnostics';
import { capturePosthogEvent, capturePosthogException } from './posthog';
import type { WorkerEnv } from '../types';

export interface PersistWorksheetResult {
  worksheetId: string;
  action: 'CREATED' | 'UPDATED';
  grade: number | null;
}

// Threshold for the "slow persistence" PostHog event. Matches the default
// from the Express `config.diagnostics.gradingPersistenceSlowMs`.
const DEFAULT_SLOW_MS = 2_000;

type TxLike = PrismaClient | Prisma.TransactionClient;

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
    overall_feedback: gradingResponse.overall_feedback,
  } as Prisma.InputJsonValue;
}

function buildWrongQuestionNumbers(gradingResponse: GradingApiResponse): string | null {
  const wrong = [
    ...(gradingResponse.wrong_questions || []).map((q) => q.question_number),
    ...(gradingResponse.unanswered_questions || []).map((q) => q.question_number),
  ];
  if (!wrong.length) return null;
  return wrong.sort((a, b) => a - b).join(', ');
}

function isMissingUniqueIndexError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes('no unique or exclusion constraint matching the ON CONFLICT specification') ||
    message.includes('code: "42P10"') ||
    message.includes('code: 42P10')
  );
}

function slowThresholdMs(env: WorkerEnv | undefined): number {
  const raw = Number.parseInt((env as { GRADING_PERSISTENCE_SLOW_MS?: string } | undefined)?.GRADING_PERSISTENCE_SLOW_MS ?? '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_SLOW_MS;
}

/**
 * Persist a graded worksheet. Handles the three happy paths (upsert,
 * missing-index fallback, race fallback) plus the `success: false`
 * rejection. The caller (typically the grading-worker route) must have
 * already acquired the lease — this function does NOT mutate the
 * GradingJob row itself.
 */
export async function persistWorksheetForGradingJob(
  tx: TxLike,
  env: WorkerEnv | undefined,
  job: Pick<
    GradingJob,
    'studentId' | 'classId' | 'teacherId' | 'worksheetNumber' | 'submittedOn' | 'isRepeated'
  >,
  gradingResponse: GradingApiResponse,
  diagnostics: { jobId?: string } = {}
): Promise<PersistWorksheetResult> {
  const persistenceStartedAt = Date.now();
  const distinctId = diagnostics.jobId || job.studentId;
  const baseDiagnostics = {
    jobId: diagnostics.jobId,
    ...summarizeGradingJobContext(job),
    gradingResponseSummary: summarizeGradingResponse(gradingResponse),
  };

  if (!gradingResponse.success) {
    console.warn(
      '[worksheet-persist] rejected unsuccessful grading response',
      baseDiagnostics
    );
    await capturePosthogEvent(
      env ?? {},
      'worksheet_persist_rejected_response',
      distinctId,
      {
        ...baseDiagnostics,
        persistenceDurationMs: Date.now() - persistenceStartedAt,
      }
    );
    throw new Error(gradingResponse.error || 'Grading response was not successful');
  }

  const template = await tx.worksheetTemplate.findFirst({
    where: { worksheetNumber: job.worksheetNumber },
    select: { id: true },
  });

  const submittedOnDate = normalizeSubmittedOnDate(job.submittedOn);
  const gradingDetails = buildGradingDetails(gradingResponse);
  const wrongQuestionNumbers = buildWrongQuestionNumbers(gradingResponse);

  const existing = await tx.worksheet.findFirst({
    where: {
      studentId: job.studentId,
      classId: job.classId,
      worksheetNumber: job.worksheetNumber,
      submittedOn: submittedOnDate,
    },
    select: { id: true },
  });
  const wasCreated = !existing;
  const diagnosticsContext = {
    ...baseDiagnostics,
    submittedOnDate: submittedOnDate.toISOString(),
    templateId: template?.id || null,
    existingWorksheetId: existing?.id || null,
  };

  let worksheet;
  try {
    worksheet = await tx.worksheet.upsert({
      where: {
        unique_worksheet_per_student_day: {
          studentId: job.studentId,
          classId: job.classId,
          worksheetNumber: job.worksheetNumber,
          submittedOn: submittedOnDate,
        },
      },
      update: {
        grade: gradingResponse.grade,
        status: ProcessingStatus.COMPLETED,
        outOf: gradingResponse.total_possible || 40,
        mongoDbId: gradingResponse.mongodb_id,
        gradingDetails,
        wrongQuestionNumbers,
        isRepeated: job.isRepeated,
        worksheetNumber: job.worksheetNumber,
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
        wrongQuestionNumbers,
      },
    });
  } catch (error) {
    const prismaErrorFields =
      error instanceof Prisma.PrismaClientKnownRequestError
        ? { prismaErrorCode: error.code, prismaMeta: error.meta }
        : {};
    const errorDiagnostics = {
      ...diagnosticsContext,
      persistenceDurationMs: Date.now() - persistenceStartedAt,
      ...summarizeError(error),
      ...prismaErrorFields,
    };

    if (isMissingUniqueIndexError(error)) {
      console.warn(
        '[worksheet-persist] upsert fell back (missing unique index)',
        errorDiagnostics
      );
      await capturePosthogEvent(
        env ?? {},
        'worksheet_persist_fallback_missing_unique_index',
        distinctId,
        errorDiagnostics
      );

      if (existing) {
        worksheet = await tx.worksheet.update({
          where: { id: existing.id },
          data: {
            grade: gradingResponse.grade,
            status: ProcessingStatus.COMPLETED,
            outOf: gradingResponse.total_possible || 40,
            mongoDbId: gradingResponse.mongodb_id,
            gradingDetails,
            wrongQuestionNumbers,
            isRepeated: job.isRepeated,
            worksheetNumber: job.worksheetNumber,
          },
        });
      } else {
        worksheet = await tx.worksheet.create({
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
            wrongQuestionNumbers,
          },
        });
      }
    } else if ((error as { code?: string })?.code === 'P2002') {
      // Race: row appeared between our findFirst and the upsert resolution.
      const alreadyCreated = await tx.worksheet.findFirst({
        where: {
          studentId: job.studentId,
          classId: job.classId,
          worksheetNumber: job.worksheetNumber,
          submittedOn: submittedOnDate,
        },
        select: { id: true },
      });
      if (!alreadyCreated) throw error;

      worksheet = await tx.worksheet.update({
        where: { id: alreadyCreated.id },
        data: {
          grade: gradingResponse.grade,
          status: ProcessingStatus.COMPLETED,
          outOf: gradingResponse.total_possible || 40,
          mongoDbId: gradingResponse.mongodb_id,
          gradingDetails,
          wrongQuestionNumbers,
          isRepeated: job.isRepeated,
        },
      });
    } else {
      console.error(
        '[worksheet-persist] persistence failed',
        errorDiagnostics,
        error
      );
      await capturePosthogEvent(
        env ?? {},
        'worksheet_persist_failed',
        distinctId,
        errorDiagnostics
      );
      await capturePosthogException(env ?? {}, error, {
        distinctId,
        stage: 'worksheet_persist_failed',
        extra: { jobId: diagnostics.jobId },
      });
      throw error;
    }
  }

  const persistenceDurationMs = Date.now() - persistenceStartedAt;
  if (persistenceDurationMs >= slowThresholdMs(env)) {
    const slowDiagnostics = {
      ...diagnosticsContext,
      persistenceDurationMs,
      worksheetId: worksheet.id,
      action: wasCreated ? 'CREATED' : 'UPDATED',
    };
    console.warn('[worksheet-persist] slow', slowDiagnostics);
    await capturePosthogEvent(
      env ?? {},
      'worksheet_persist_slow',
      distinctId,
      slowDiagnostics
    );
  }

  return {
    worksheetId: worksheet.id,
    action: wasCreated ? 'CREATED' : 'UPDATED',
    grade: gradingResponse.grade ?? null,
  };
}

/**
 * Convenience wrapper: look up the grading job by id, then delegate to
 * `persistWorksheetForGradingJob`. Callers already inside a transaction
 * should pass their transaction client as `tx`; standalone callers can
 * pass the top-level Prisma client.
 */
export async function persistWorksheetForGradingJobId(
  tx: TxLike,
  env: WorkerEnv | undefined,
  jobId: string,
  gradingResponse: GradingApiResponse
): Promise<PersistWorksheetResult> {
  const job = await tx.gradingJob.findUnique({
    where: { id: jobId },
    select: {
      studentId: true,
      classId: true,
      teacherId: true,
      worksheetNumber: true,
      submittedOn: true,
      isRepeated: true,
    },
  });
  if (!job) throw new Error(`Grading job not found: ${jobId}`);
  return persistWorksheetForGradingJob(tx, env, job, gradingResponse, { jobId });
}
