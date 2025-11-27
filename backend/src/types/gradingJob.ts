export type GradingJobStatus = 'pending' | 'processing' | 'completed' | 'failed';

export interface QuestionScore {
  question_number: number;
  question: string;
  student_answer: string;
  correct_answer: string;
  points_earned: number;
  max_points: number;
  is_correct: boolean;
  feedback: string;
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
  overall_feedback: string;
}

export interface FileData {
  filename: string;
  mimetype: string;
  buffer: string; // base64 encoded
}

export interface GradingJobPayload {
  tokenNo: string;
  worksheetName: string;
  studentId: string;
  studentName: string;
  classId: string;
  submittedOn: string;
  worksheetNumber: number;
  isRepeated: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
  submittedById: string;
  files?: FileData[]; // Files stored as base64 for Worker to process
}

export interface GradingJobResult {
  grade: number;
  mongoDbId: string;
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
  overall_feedback: string;
}

export interface GradingJob {
  jobId: string;
  batchId?: string;
  status: GradingJobStatus;
  createdAt: string;
  updatedAt: string;
  payload: GradingJobPayload;
  result?: GradingJobResult;
  postgresId?: string;
  error?: string;
  retryCount: number;
  needsManualReview?: boolean;
  postgresError?: string;
}

// Lightweight message for Cloudflare Queue (no files - stays under 128KB limit)
export interface QueueJobMessage {
  jobId: string;
  batchId?: string;
  filesKey: string;  // KV key where files are stored: "files:{jobId}"
  payload: {
    tokenNo: string;
    worksheetName: string;
    studentId: string;
    studentName: string;
    classId: string;
    submittedOn: string;
    worksheetNumber: number;
    isRepeated: boolean;
    isCorrectGrade?: boolean;
    isIncorrectGrade?: boolean;
    submittedById: string;
    // Note: files are stored separately in KV, not in queue message
  };
  createdAt: string;
}

export interface BatchJob {
  batchId: string;
  classId: string;
  submittedOn: string;
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  pendingJobs: number;
  processingJobs: number;
  jobIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateJobRequest {
  tokenNo: string;
  worksheetName: string;
  studentId: string;
  studentName: string;
  classId: string;
  submittedOn: string;
  worksheetNumber: number;
  isRepeated: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
}

export interface CreateBatchJobRequest {
  jobs: CreateJobRequest[];
  classId: string;
  submittedOn: string;
}

export interface StoreGradingResultRequest {
  jobId: string;
  classId: string;
  studentId: string;
  submittedById: string;
  worksheetNumber: number;
  grade: number;
  submittedOn: string;
  isRepeated: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
  mongoDbId: string;
  gradingDetails: GradingDetails;
}
