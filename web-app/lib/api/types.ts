// Types for API client

export enum UserRole {
    TEACHER = 'TEACHER',
    STUDENT = 'STUDENT',
    ADMIN = 'ADMIN',
    SUPERADMIN = 'SUPERADMIN'
}

export enum ProcessingStatus {
    PENDING = 'PENDING',
    PROCESSING = 'PROCESSING',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED'
}

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
    status: GradingJobStatus;
    result?: GradingJobResult;
    postgresId?: string;
    error?: string;
    createdAt: string;
    updatedAt: string;
}

export interface BatchJobStatus {
    batchId: string;
    totalJobs: number;
    completed: number;
    failed: number;
    processing: number;
    pending: number;
    jobs: Array<{
        jobId: string;
        studentName: string;
        status: GradingJobStatus;
        result?: GradingJobResult;
        postgresId?: string;
        error?: string;
    }>;
}

export interface ClassJobsStatus {
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    jobs: Array<{
        jobId: string;
        studentName: string;
        tokenNo: string;
        status: GradingJobStatus;
        result?: GradingJobResult;
        postgresId?: string;
        error?: string;
    }>;
}

export enum NotificationStatus {
    READ = 'READ',
    UNREAD = 'UNREAD'
}

export interface User {
    id: string;
    name: string;
    username: string;
    role: UserRole;
    createdAt: string;
    tokenNumber: string;
    updatedAt: string;
    isArchived?: boolean;
    adminSchools?: AdminSchool[];
    notifications?: Notification[];
    studentClasses?: StudentClass[];
    teacherClasses?: TeacherClass[];
    worksheets?: Worksheet[];
    studentWorksheets?: Worksheet[];
}

export interface School {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    isArchived?: boolean;
    clusterId?: string;
    adminSchools?: AdminSchool[];
    classes?: Class[];
    cluster?: Cluster;
}

export interface Cluster {
    id: string;
    name: string;
    createdAt: string;
    updatedAt: string;
    schools?: School[];
}

export interface Class {
    id: string;
    name: string;
    schoolId: string;
    createdAt: string;
    updatedAt: string;
    isArchived?: boolean;
    school?: School;
    studentClasses?: StudentClass[];
    teacherClasses?: TeacherClass[];
    worksheets?: Worksheet[];
}

export interface TeacherClass {
    teacherId: string;
    classId: string;
    createdAt: string;
    class?: Class;
    teacher?: User;
}

export interface StudentClass {
    studentId: string;
    classId: string;
    createdAt: string;
    class?: Class;
    student?: User;
}

export interface AdminSchool {
    adminId: string;
    schoolId: string;
    createdAt: string;
    admin?: User;
    school?: School;
}

export interface MathSkill {
    id: string;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
    worksheets?: WorksheetTemplateQuestion[];
}

export interface WorksheetTemplate {
    id: string;
    worksheetNumber?: number;
    createdAt: string;
    updatedAt: string;
    worksheetImages?: WorksheetTemplateImage[];
    questions?: WorksheetTemplateQuestion[];
    worksheets?: Worksheet[];
}

export interface WorksheetTemplateImage {
    id: string;
    imageUrl: string;
    pageNumber: number;
    worksheetTemplateId: string;
    worksheetTemplate?: WorksheetTemplate;
}

export interface WorksheetTemplateQuestion {
    id: string;
    question: string;
    worksheetTemplateId: string;
    worksheetTemplates?: WorksheetTemplate[];
    answer?: string;
    skills?: MathSkill[];
    outOf?: number;
    worksheetQuestions?: WorksheetQuestion[];
}

export interface WorksheetQuestion {
    id: string;
    question: string;
    worksheetId: string;
    worksheet?: Worksheet;
    questionId: string;
    templateQuestion?: WorksheetTemplateQuestion;
}

export interface Worksheet {
    id: string;
    notes?: string;
    status: ProcessingStatus;
    grade?: number;
    outOf?: number;
    submittedById: string;
    classId: string;
    studentId?: string;
    createdAt: string;
    updatedAt: string;
    submittedBy?: User;
    class?: Class;
    student?: User;
    images?: WorksheetImage[];
    templateId?: string;
    template?: WorksheetTemplate;
    worksheetQuestions?: WorksheetQuestion[];
    submittedOn?: string;
    isAbsent?: boolean;
    isRepeated?: boolean;
    isCorrectGrade?: boolean;
    isIncorrectGrade?: boolean;
    mongoDbId?: string;
    gradingDetails?: any; // JSON field for detailed grading information
}

export interface WorksheetImage {
    id: string;
    imageUrl: string;
    pageNumber: number;
    worksheetId: string;
    createdAt: string;
    updatedAt: string;
    worksheet?: Worksheet;
}

export interface Notification {
    id: string;
    message: string;
    userId: string;
    status: NotificationStatus;
    createdAt: string;
    updatedAt: string;
    user?: User;
}

export interface AuthResponse {
    user: User;
    token: string;
}