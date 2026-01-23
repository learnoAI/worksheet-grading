import { fetchAPI } from './utils';
import { Worksheet } from './types';

interface GradedWorksheetData {
    id?: string;
    classId: string;
    studentId: string;
    template: {
        worksheetNumber: number;
    };
    grade: number;
    notes?: string;
    submittedOn: string;
    isAbsent?: boolean;
    isRepeated?: boolean;
    isCorrectGrade?: boolean;
    isIncorrectGrade?: boolean;
    mongoDbId?: string;
    gradingDetails?: any;
}

interface CreateGradedWorksheetData {
    id?: string;
    classId: string;
    studentId: string;
    worksheetNumber: number;
    grade: number;
    notes?: string;
    submittedOn: string;
    isAbsent?: boolean;
    isRepeated?: boolean;
    isCorrectGrade?: boolean;
    isIncorrectGrade?: boolean;
    mongoDbId?: string; // Add MongoDB ID field
    gradingDetails?: any; // Add grading details field
}
export const worksheetAPI = {
    getWorksheetById: async (id: string): Promise<Worksheet> => {
        return fetchAPI<Worksheet>(`/worksheets/${id}`);
    },

    createGradedWorksheet: async (data: CreateGradedWorksheetData): Promise<Worksheet> => {
        const requestData = { ...data };

        if (requestData.isAbsent) {
            requestData.worksheetNumber = 0;
            requestData.grade = 0;
            requestData.isRepeated = false;
            requestData.mongoDbId = undefined;
        } else {
            requestData.grade = parseFloat(requestData.grade.toString());
            requestData.worksheetNumber = parseInt(requestData.worksheetNumber.toString());
        }

        return fetchAPI<Worksheet>('/worksheets/grade', {
            method: 'POST',
            body: JSON.stringify(requestData)
        });
    },

    getWorksheetByClassStudentDate: async (classId: string, studentId: string, submittedOn: string): Promise<GradedWorksheetData | null> => {
        const date = new Date(submittedOn);
        const startDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const endDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1));

        try {
            return await fetchAPI<GradedWorksheetData | null>(
                `/worksheets/find?classId=${encodeURIComponent(classId)}&studentId=${encodeURIComponent(studentId)}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
            );
        } catch (error) {
            return null;
        }
    },

    // Get ALL worksheets for a student on a specific date (for multiple worksheets per day)
    getAllWorksheetsByClassStudentDate: async (classId: string, studentId: string, submittedOn: string): Promise<GradedWorksheetData[]> => {
        const date = new Date(submittedOn);
        const startDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const endDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1));

        try {
            return await fetchAPI<GradedWorksheetData[]>(
                `/worksheets/find-all?classId=${encodeURIComponent(classId)}&studentId=${encodeURIComponent(studentId)}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`
            );
        } catch (error) {
            return [];
        }
    },

    updateGradedWorksheet: async (id: string, data: CreateGradedWorksheetData): Promise<GradedWorksheetData> => {
        const requestData = { ...data };

        if (requestData.isAbsent) {
            requestData.worksheetNumber = 0;
            requestData.grade = 0;
            requestData.isRepeated = false;
        } else {
            requestData.grade = parseFloat(requestData.grade.toString());
            requestData.worksheetNumber = parseInt(requestData.worksheetNumber.toString());
        }

        return fetchAPI<GradedWorksheetData>(`/worksheets/grade/${id}`, {
            method: 'PUT',
            body: JSON.stringify(requestData)
        });
    },

    deleteGradedWorksheet: async (id: string): Promise<void> => {
        return fetchAPI<void>(`/worksheets/${id}`, {
            method: 'DELETE'
        });
    },

    getPreviousWorksheets: async (classId: string, studentId: string, currentDate: string): Promise<Worksheet[]> => {
        const date = new Date(currentDate);
        const endDate = new Date(Date.UTC(
            date.getFullYear(),
            date.getMonth(),
            date.getDate(),
            23, 59, 59, 999
        ));

        try {
            return await fetchAPI<Worksheet[]>(
                `/worksheets/history?classId=${classId}&studentId=${studentId}&endDate=${endDate.toISOString()}`
            );
        } catch (error) {
            return [];
        }
    },

    // Batch endpoint: Get all worksheets for a class on a specific date
    getClassWorksheetsForDate: async (classId: string, submittedOn: string): Promise<{
        students: { id: string; name: string; tokenNumber: string }[];
        worksheetsByStudent: Record<string, GradedWorksheetData[]>;
        studentSummaries: Record<string, { lastWorksheetNumber: number | null; lastGrade: number | null; completedWorksheetNumbers: number[]; recommendedWorksheetNumber: number; isRecommendedRepeated: boolean }>;
        stats: {
            totalStudents: number;
            studentsWithWorksheets: number;
            gradedCount: number;
            absentCount: number;
            pendingCount: number;
        };
    }> => {
        return fetchAPI<{
            students: { id: string; name: string; tokenNumber: string }[];
            worksheetsByStudent: Record<string, GradedWorksheetData[]>;
            studentSummaries: Record<string, { lastWorksheetNumber: number | null; lastGrade: number | null; completedWorksheetNumbers: number[]; recommendedWorksheetNumber: number; isRecommendedRepeated: boolean }>;
            stats: {
                totalStudents: number;
                studentsWithWorksheets: number;
                gradedCount: number;
                absentCount: number;
                pendingCount: number;
            };
        }>(`/worksheets/class-date?classId=${encodeURIComponent(classId)}&submittedOn=${encodeURIComponent(submittedOn)}`);
    },

    // Check if a worksheet would be repeated for a student
    checkIsRepeated: async (classId: string, studentId: string, worksheetNumber: number, beforeDate?: string): Promise<{
        isRepeated: boolean;
        previousWorksheet?: { id: string; grade: number; submittedOn: string } | null;
    }> => {
        return fetchAPI<{
            isRepeated: boolean;
            previousWorksheet?: { id: string; grade: number; submittedOn: string } | null;
        }>('/worksheets/check-repeated', {
            method: 'POST',
            body: JSON.stringify({ classId, studentId, worksheetNumber, beforeDate })
        });
    },

    // Get recommended next worksheet for a student
    getRecommendedWorksheet: async (classId: string, studentId: string, beforeDate?: string): Promise<{
        recommendedWorksheetNumber: number;
        isRepeated: boolean;
        lastWorksheetNumber: number | null;
        lastGrade: number | null;
        progressionThreshold: number;
    }> => {
        return fetchAPI<{
            recommendedWorksheetNumber: number;
            isRepeated: boolean;
            lastWorksheetNumber: number | null;
            lastGrade: number | null;
            progressionThreshold: number;
        }>('/worksheets/recommend-next', {
            method: 'POST',
            body: JSON.stringify({ classId, studentId, beforeDate })
        });
    },

    // Batch save worksheets for multiple students
    batchSaveWorksheets: async (classId: string, submittedOn: string, worksheets: Array<{
        studentId: string;
        worksheetNumber?: number;
        grade?: string | number;
        isAbsent?: boolean;
        isRepeated?: boolean;
        isIncorrectGrade?: boolean;
        gradingDetails?: any;
        wrongQuestionNumbers?: string;
        action?: 'save' | 'delete';
    }>): Promise<{
        success: boolean;
        saved: number;
        updated: number;
        deleted: number;
        failed: number;
        errors: { studentId: string; error: string }[];
    }> => {
        return fetchAPI<{
            success: boolean;
            saved: number;
            updated: number;
            deleted: number;
            failed: number;
            errors: { studentId: string; error: string }[];
        }>('/worksheets/batch-save', {
            method: 'POST',
            body: JSON.stringify({ classId, submittedOn, worksheets })
        });
    },

    getIncorrectGradingWorksheets: async (params?: { page?: number; pageSize?: number; startDate?: string; endDate?: string }): Promise<{ data: any[]; total: number; page: number; pageSize: number }> => {
        const query = new URLSearchParams();
        if (params?.page) query.set('page', String(params.page));
        if (params?.pageSize) query.set('pageSize', String(params.pageSize));
        if (params?.startDate) query.set('startDate', params.startDate);
        if (params?.endDate) query.set('endDate', params.endDate);

        const queryString = query.toString();
        return fetchAPI<{ data: any[]; total: number; page: number; pageSize: number }>(
            `/worksheets/incorrect-grading${queryString ? `?${queryString}` : ''}`
        );
    },

    updateWorksheetAdminComments: async (worksheetId: string, data: { adminComments: string }): Promise<void> => {
        return fetchAPI<void>(`/worksheets/${worksheetId}/admin-comments`, {
            method: 'PATCH',
            body: JSON.stringify(data)
        });
    },

    markWorksheetAsCorrectlyGraded: async (worksheetId: string): Promise<void> => {
        return fetchAPI<void>(`/worksheets/${worksheetId}/mark-correct`, {
            method: 'PATCH'
        });
    },

    getWorksheetImages: async (tokenNo: string, worksheetName: string): Promise<string[]> => {
        return fetchAPI<string[]>('/worksheets/images', {
            method: 'POST',
            body: JSON.stringify({
                token_no: tokenNo,
                worksheet_name: worksheetName
            })
        });
    },

    getTotalAiGraded: async (params?: { startDate?: string; endDate?: string }): Promise<{ total_ai_graded: number }> => {
        const body: { full: boolean; startDate?: string; endDate?: string } = {
            full: !params?.startDate && !params?.endDate,
        };

        if (params?.startDate) body.startDate = params.startDate;
        if (params?.endDate) body.endDate = params.endDate;

        return fetchAPI<{ total_ai_graded: number }>('/worksheets/total-ai-graded', {
            method: 'POST',
            body: JSON.stringify(body),
        });
    },

    getStudentGradingDetails: async (tokenNo: string, worksheetNumber: number, overallScore?: number): Promise<any> => {
        const requestBody: any = {
            token_no: tokenNo,
            worksheet_name: worksheetNumber.toString()
        };

        if (overallScore !== undefined && overallScore !== null) {
            requestBody.overall_score = Number(overallScore);
        }

        return fetchAPI<any>('/worksheets/student-grading-details', {
            method: 'POST',
            body: JSON.stringify(requestBody)
        });
    }
};