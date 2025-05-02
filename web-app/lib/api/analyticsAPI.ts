import { fetchAPI } from './utils';

// Types for analytics data
export interface OverallAnalytics {
    totalWorksheets: number;
    totalAbsent: number;
    absentPercentage: number;
    totalRepeated: number;
    repetitionRate: number;
    highScoreCount: number;
    highScorePercentage: number;
    totalGraded: number;
}

export interface StudentAnalytics {
    id: string;
    name: string;
    username: string;
    tokenNumber: string | null;
    schools: string[];
    classes: string[];
    firstWorksheetDate: string | null;
    lastWorksheetDate: string | null;
    totalWorksheets: number;
    absentCount: number;
    absentPercentage: number;
    repeatedCount: number;
    repetitionRate: number;
}

export interface School {
    id: string;
    name: string;
}

export interface Class {
    id: string;
    name: string;
    schoolId: string;
}

// Analytics API methods
export const analyticsAPI = {
    // Get overall analytics data for a date range
    getOverallAnalytics: async (startDate: string, endDate: string): Promise<OverallAnalytics> => {
        return fetchAPI(`/analytics/overall?startDate=${startDate}&endDate=${endDate}`, {
            method: 'GET'
        });
    },

    // Get student analytics data
    getStudentAnalytics: async (filters?: { schoolId?: string; classId?: string }): Promise<StudentAnalytics[]> => {
        let url = '/analytics/students';
        if (filters) {
            const params = new URLSearchParams();
            if (filters.schoolId) params.append('schoolId', filters.schoolId);
            if (filters.classId) params.append('classId', filters.classId);
            
            if (params.toString()) {
                url += `?${params.toString()}`;
            }
        }
        
        return fetchAPI(url, {
            method: 'GET'
        });
    },

    // Get all schools for filtering
    getAllSchools: async (): Promise<School[]> => {
        return fetchAPI('/analytics/schools', {
            method: 'GET'
        });
    },

    // Get classes for a school
    getClassesBySchool: async (schoolId: string): Promise<Class[]> => {
        return fetchAPI(`/analytics/schools/${schoolId}/classes`, {
            method: 'GET'
        });
    },

    // Remove a student from a class
    removeStudentFromClass: async (studentId: string, classId: string): Promise<{ message: string }> => {
        return fetchAPI(`/analytics/students/${studentId}/classes/${classId}`, {
            method: 'DELETE'
        });
    },

    // Add a student to a class
    addStudentToClass: async (studentId: string, classId: string): Promise<any> => {
        return fetchAPI(`/analytics/students/${studentId}/classes/${classId}`, {
            method: 'POST'
        });
    }
};