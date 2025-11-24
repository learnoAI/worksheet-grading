export interface Env {
  SAARTHI_JOBS: KVNamespace;
  PYTHON_API_URL: string;
  NODE_BACKEND_URL: string;
  INTERNAL_TOKEN: string;
  MAX_CONCURRENT_JOBS: string;
  MAX_RETRY_ATTEMPTS: string;
}

export interface GradingJob {
  jobId: string;
  batchId?: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: string;
  updatedAt: string;
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
    files?: Array<{
      filename: string;
      mimetype: string;
      buffer: string;
    }>;
  };
  result?: {
    grade: number;
    mongoDbId: string;
    total_possible: number;
    grade_percentage: number;
    total_questions: number;
    correct_answers: number;
    wrong_answers: number;
    unanswered: number;
    question_scores: any[];
    wrong_questions: any[];
    correct_questions: any[];
    unanswered_questions: any[];
    overall_feedback: string;
  };
  postgresId?: string;
  error?: string;
  retryCount: number;
  needsManualReview?: boolean;
  postgresError?: string;
}

export interface PythonApiResponse {
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
}
