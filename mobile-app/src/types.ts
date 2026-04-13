export type UserRole = 'TEACHER' | 'STUDENT' | 'ADMIN' | 'SUPERADMIN';

export type QueueStatus =
  | 'queued'
  | 'uploading'
  | 'uploaded'
  | 'grading_queued'
  | 'processing'
  | 'completed'
  | 'failed';

export type PageUploadStatus = 'local' | 'uploading' | 'uploaded' | 'failed';

export interface User {
  id: string;
  username: string;
  name?: string;
  role: UserRole;
  tokenNumber?: string;
}

export interface TeacherClass {
  id: string;
  name: string;
  academicYear?: string;
  schoolId?: string;
}

export interface QuestionScore {
  question_number: number;
  question: string;
  student_answer: string;
  correct_answer: string;
  points_earned: number;
  max_points: number;
  is_correct: boolean;
  feedback?: string;
}

export interface GradingDetails {
  total_possible: number;
  grade_percentage: number;
  total_questions: number;
  correct_answers: number;
  wrong_answers: number;
  unanswered: number;
  question_scores: QuestionScore[];
  wrong_questions: QuestionScore[];
  correct_questions: QuestionScore[];
  unanswered_questions: QuestionScore[];
  overall_feedback?: string;
}

export interface WorksheetImageRecord {
  id?: string;
  imageUrl: string;
  pageNumber: number;
}

export interface WorksheetRecord {
  id?: string;
  status?: string;
  worksheetNumber?: number | null;
  grade?: number | null;
  submittedOn?: string;
  isAbsent?: boolean;
  isRepeated?: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
  wrongQuestionNumbers?: string | null;
  gradingDetails?: GradingDetails | null;
  images?: WorksheetImageRecord[];
  template?: {
    worksheetNumber?: number | null;
  } | null;
}

export interface StudentSummary {
  lastWorksheetNumber: number | null;
  lastGrade: number | null;
  completedWorksheetNumbers: number[];
  recommendedWorksheetNumber: number;
  isRecommendedRepeated: boolean;
}

export interface ClassDateResponse {
  students: {
    id: string;
    name: string;
    tokenNumber: string;
  }[];
  worksheetsByStudent: Record<string, WorksheetRecord[]>;
  studentSummaries: Record<string, StudentSummary | undefined>;
  stats: {
    totalStudents: number;
    studentsWithWorksheets: number;
    gradedCount: number;
    absentCount: number;
    pendingCount: number;
  };
}

export interface RosterStudent {
  studentId: string;
  studentName: string;
  tokenNumber: string;
  existingWorksheets: WorksheetRecord[];
  recommendedWorksheetNumber: number;
  isRecommendedRepeated: boolean;
}

export interface CapturePageDraft {
  pageNumber: number;
  uri: string;
  mimeType: string;
  fileName: string;
  fileSize?: number;
  width?: number;
  height?: number;
}

export interface QueuePage {
  id: string;
  worksheetLocalId: string;
  pageNumber: number;
  localUri: string;
  mimeType: string;
  fileName: string;
  fileSize?: number | null;
  width?: number | null;
  height?: number | null;
  imageId?: string | null;
  uploadUrl?: string | null;
  uploadUrlExpiresAt?: string | null;
  uploadStatus: PageUploadStatus;
  uploadedAt?: string | null;
  errorMessage?: string | null;
}

export interface QueueWorksheet {
  localId: string;
  classId: string;
  className?: string | null;
  studentId: string;
  studentName: string;
  tokenNumber: string;
  submittedOn: string;
  worksheetNumber: number;
  isRepeated: boolean;
  status: QueueStatus;
  backendBatchId?: string | null;
  backendItemId?: string | null;
  jobId?: string | null;
  errorMessage?: string | null;
  createdAt: string;
  updatedAt: string;
  pages: QueuePage[];
}

export interface QueueWorksheetInput {
  classId: string;
  className?: string | null;
  studentId: string;
  studentName: string;
  tokenNumber: string;
  submittedOn: string;
  worksheetNumber: number;
  isRepeated: boolean;
  pages: CapturePageDraft[];
}

export interface DirectUploadFileRequest {
  pageNumber: number;
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface DirectUploadWorksheetRequest {
  studentId: string;
  studentName: string;
  tokenNo?: string;
  worksheetNumber: number;
  worksheetName?: string;
  isRepeated?: boolean;
  files: DirectUploadFileRequest[];
}

export interface DirectUploadFileSlot {
  imageId: string;
  pageNumber: number;
  mimeType: string;
  fileSize?: number | null;
  originalName?: string | null;
  s3Key: string;
  imageUrl: string;
  uploadedAt?: string | null;
  uploadUrl?: string | null;
  expiresAt?: string | null;
}

export interface DirectUploadItem {
  itemId: string;
  studentId: string;
  studentName: string;
  tokenNo?: string | null;
  worksheetNumber: number;
  worksheetName?: string | null;
  isRepeated: boolean;
  status: 'PENDING' | 'QUEUED' | 'FAILED';
  jobId?: string | null;
  errorMessage?: string | null;
  files: DirectUploadFileSlot[];
}

export interface DirectUploadSession {
  success: boolean;
  batchId: string;
  classId: string;
  submittedOn: string;
  status: 'UPLOADING' | 'FINALIZED';
  finalizedAt?: string | null;
  items: DirectUploadItem[];
}

export interface FinalizedUploadItem {
  itemId: string;
  studentId: string;
  worksheetNumber: number;
  jobId?: string | null;
  dispatchState?: 'DISPATCHED' | 'PENDING_DISPATCH';
  queuedAt?: string;
  error?: string;
  missingImageIds?: string[];
}

export interface FinalizeDirectUploadSessionResponse {
  success: boolean;
  batchId: string;
  status: 'UPLOADING' | 'FINALIZED';
  queued: FinalizedUploadItem[];
  pending: FinalizedUploadItem[];
  failed: FinalizedUploadItem[];
}

export interface GradingJob {
  id: string;
  studentId?: string;
  studentName: string;
  worksheetNumber: number;
  classId?: string;
  status: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
  worksheetId?: string;
  errorMessage?: string;
  dispatchError?: string;
  createdAt: string;
  completedAt?: string;
}

export interface TeacherJobsResponse {
  success: boolean;
  summary?: GradingJobSummary;
  jobs: GradingJob[];
}

export interface GradingJobSummary {
  queued: number;
  processing: number;
  completed: number;
  failed: number;
  total: number;
}

export interface CreateGradedWorksheetData {
  classId: string;
  studentId: string;
  worksheetNumber: number;
  grade: number;
  submittedOn: string;
  isAbsent?: boolean;
  isRepeated?: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
  gradingDetails?: GradingDetails | null;
  wrongQuestionNumbers?: string | null;
}

export interface SavedWorksheet {
  id: string;
  classId: string;
  studentId: string;
  worksheetNumber: number;
  grade: number;
  submittedOn: string;
  isAbsent?: boolean;
  isRepeated?: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
  gradingDetails?: GradingDetails | null;
  wrongQuestionNumbers?: string | null;
  images?: WorksheetImageRecord[];
}

export interface BatchSaveResponse {
  success: boolean;
  saved: number;
  updated: number;
  deleted: number;
  failed: number;
  errors: { studentId: string; error: string }[];
}
