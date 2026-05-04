import type { GradingJob } from '@prisma/client';

/**
 * Diagnostic helpers for the grading pipeline. Pure functions — no I/O,
 * no Prisma, no external calls. Ported verbatim from
 * `backend/src/services/gradingDiagnostics.ts` so the Hono worker and
 * Express stacks emit identically-shaped events. The grading pipeline
 * correlates alerts by these summary fields, so any drift between the
 * two implementations would split our dashboards.
 *
 * `GradingApiResponse` lives here too (copied from `gradingTypes.ts`) so
 * this adapter has zero imports from the Express side.
 */

export interface GradingApiResponse {
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

const MAX_KEYS = 12;
const MAX_MESSAGE_LENGTH = 240;

function valueType(value: unknown): string {
  if (Array.isArray(value)) return 'array';
  if (value === null) return 'null';
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function previewString(value: unknown, maxLength = MAX_MESSAGE_LENGTH): string | undefined {
  if (typeof value !== 'string') return undefined;
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function summarizeQuestionNumberTypes(
  questions: Array<{ question_number: number }> | undefined
): { count?: number; questionNumberTypes?: string[] } {
  if (!Array.isArray(questions)) return {};
  const types = Array.from(
    new Set(questions.slice(0, 25).map((q) => valueType(q?.question_number)))
  );
  return { count: questions.length, questionNumberTypes: types };
}

export function summarizeGradingResponse(
  response: Partial<GradingApiResponse> | null | undefined
): Record<string, unknown> {
  if (!response) return { responseType: valueType(response) };

  const wrongSummary = summarizeQuestionNumberTypes(response.wrong_questions);
  const unansweredSummary = summarizeQuestionNumberTypes(response.unanswered_questions);

  return {
    success: response.success,
    gradeType: valueType(response.grade),
    totalPossibleType: valueType(response.total_possible),
    gradePercentageType: valueType(response.grade_percentage),
    questionScoresType: valueType(response.question_scores),
    questionScoresCount: Array.isArray(response.question_scores)
      ? response.question_scores.length
      : undefined,
    wrongQuestionsCount: wrongSummary.count,
    wrongQuestionNumberTypes: wrongSummary.questionNumberTypes,
    unansweredQuestionsCount: unansweredSummary.count,
    unansweredQuestionNumberTypes: unansweredSummary.questionNumberTypes,
    mongodbIdType: valueType(response.mongodb_id),
    overallFeedbackType: valueType(response.overall_feedback),
    errorPreview: previewString(response.error),
  };
}

export function summarizeGradingJobContext(
  job: Pick<
    GradingJob,
    'studentId' | 'classId' | 'teacherId' | 'worksheetNumber' | 'submittedOn' | 'isRepeated'
  >
): Record<string, unknown> {
  return {
    studentId: job.studentId,
    classId: job.classId,
    teacherId: job.teacherId,
    worksheetNumber: job.worksheetNumber,
    submittedOn: job.submittedOn ? new Date(job.submittedOn).toISOString() : null,
    isRepeated: job.isRepeated,
  };
}

export function summarizeError(error: unknown): Record<string, unknown> {
  if (error instanceof Error) {
    const code = (error as Error & { code?: unknown }).code;
    return {
      errorName: error.name,
      errorMessage: previewString(error.message),
      errorCode: code === undefined ? undefined : String(code),
    };
  }
  return {
    errorType: valueType(error),
    errorMessage: previewString(String(error)),
  };
}

export function summarizeRequestBodyShape(body: unknown): Record<string, unknown> {
  if (Array.isArray(body)) {
    return { bodyType: 'array', bodyLength: body.length };
  }
  if (!isRecord(body)) {
    return { bodyType: valueType(body) };
  }

  const summary: Record<string, unknown> = {
    bodyType: 'object',
    bodyKeys: Object.keys(body).slice(0, MAX_KEYS),
  };

  if ('leaseId' in body) summary.leaseIdType = valueType(body.leaseId);
  if ('errorMessage' in body) summary.errorMessageType = valueType(body.errorMessage);
  if ('reason' in body) summary.reasonType = valueType(body.reason);

  if ('gradingResponse' in body) {
    summary.gradingResponseType = valueType(body.gradingResponse);
    if (isRecord(body.gradingResponse)) {
      summary.gradingResponseKeys = Object.keys(body.gradingResponse).slice(0, MAX_KEYS);
      summary.gradingResponseSuccessType = valueType(body.gradingResponse.success);
      if ('worksheetId' in body.gradingResponse) {
        summary.gradingResponseWorksheetIdType = valueType(body.gradingResponse.worksheetId);
      }
    }
  }

  return summary;
}
