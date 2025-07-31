export interface BaseEntity {
  id: string;
  createdAt: string;
  updatedAt: string;
  isArchived?: boolean;
}

export interface School extends BaseEntity {
  name: string;
}

export interface Class extends BaseEntity {
  name: string;
  schoolId: string;
  school?: School;
  studentCount?: number;
  teacherCount?: number;
}

export interface User extends BaseEntity {
  name: string;
  username: string;
  role: UserRole;
  tokenNumber?: string;
  schoolId?: string;
  school?: School;
  studentClasses?: Class[];
  teacherClasses?: Class[];
  adminSchools?: School[];
}

export interface Worksheet extends BaseEntity {
  studentId: string;
  classId: string;
  worksheetNumber: number;
  grade: string;
  submittedOn: string;
  isAbsent: boolean;
  isRepeated: boolean;
  isCorrectGrade?: boolean;
  isIncorrectGrade?: boolean;
  images?: string[];
  gradingDetails?: GradingDetails;
  wrongQuestionNumbers?: number[];
  correctGrade?: string;
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

export interface WorksheetTemplate extends BaseEntity {
  name: string;
  description?: string;
  skillIds: string[];
  skills?: MathSkill[];
}

export interface MathSkill extends BaseEntity {
  name: string;
  description?: string;
}

export enum UserRole {
  TEACHER = 'TEACHER',
  STUDENT = 'STUDENT',
  ADMIN = 'ADMIN',
  SUPERADMIN = 'SUPERADMIN'
}

export interface StudentWorksheet {
  studentId: string;
  name: string;
  tokenNumber: string;
  worksheetNumber: number;
  grade: string;
  isAbsent: boolean;
  isRepeated: boolean;
  page1File: File | null;
  page2File: File | null;
  isUploading: boolean;
  isCorrectGrade: boolean;
  isIncorrectGrade: boolean;
  gradingDetails?: GradingDetails;
}

export interface ApiResponse<T> {
  data: T;
  message?: string;
  success: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface LoadingStateProps {
  isLoading: boolean;
  error?: string;
}

export interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
}

export interface FormProps<T> {
  onSubmit: (data: T) => Promise<void>;
  onCancel: () => void;
  isSubmitting?: boolean;
  initialData?: Partial<T>;
}
