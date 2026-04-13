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

