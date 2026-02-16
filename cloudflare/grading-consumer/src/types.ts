export type StorageProvider = 'S3' | 'R2';

export interface JobImagePayload {
  s3Key: string;
  storageProvider: StorageProvider;
  pageNumber: number;
  mimeType: string;
}

export interface JobPayload {
  id: string;
  status: string;
  tokenNo: string | null;
  worksheetName: string | null;
  worksheetNumber: number;
  submittedOn: string;
  isRepeated: boolean;
  studentId: string;
  classId: string;
  teacherId: string;
  images: JobImagePayload[];
}

export interface BackendAcquireResponse {
  success: boolean;
  acquired: boolean;
  leaseId?: string;
  job?: JobPayload;
  error?: string;
}

export interface ExtractedQuestion {
  question_number: number;
  question: string;
  student_answer: string;
}

export interface ExtractedQuestions {
  questions: ExtractedQuestion[];
}

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

export interface GradingResult {
  total_questions?: number;
  overall_score?: number;
  grade_percentage?: number;
  question_scores: QuestionScore[];
  correct_answers?: number;
  wrong_answers?: number;
  unanswered?: number;
  overall_feedback: string;
  reason_why?: string;
}

// Keep this shape compatible with backend/src/services/gradingTypes.ts
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
