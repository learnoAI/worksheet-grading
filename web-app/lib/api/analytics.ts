import { fetchAPI } from './utils';

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
    class: string;
    school: string;
    totalWorksheets: number;
    absences: number;
    absentPercentage: number;
    repetitions: number;
    repetitionRate: number;
    firstWorksheetDate: string | null;
    lastWorksheetDate: string | null;
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

export const analyticsAPI = {
    getOverallAnalytics: async (startDate: string, endDate: string): Promise<OverallAnalytics> => {
        return fetchAPI<OverallAnalytics>(`/analytics/overall?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`);
    },
    
    getStudentAnalytics: async (schoolId?: string, classId?: string): Promise<StudentAnalytics[]> => {
        let url = '/analytics/students';
        const params = new URLSearchParams();
        if (schoolId) params.append('schoolId', schoolId);
        if (classId) params.append('classId', classId);
        const queryString = params.toString();
        
        return fetchAPI<StudentAnalytics[]>(`${url}${queryString ? `?${queryString}` : ''}`);
    },
    
    getAllSchools: async (): Promise<School[]> => {
        return fetchAPI<School[]>('/analytics/schools');
    },
    
    getClassesBySchool: async (schoolId: string): Promise<Class[]> => {
        return fetchAPI<Class[]>(`/analytics/schools/${schoolId}/classes`);
    },
    
    removeStudentFromClass: async (studentId: string, classId: string): Promise<void> => {
        return fetchAPI<void>(`/analytics/students/${studentId}/classes/${classId}`, {
            method: 'DELETE'
        });
    },
    
    addStudentToClass: async (studentId: string, classId: string): Promise<void> => {
        return fetchAPI<void>(`/analytics/students/${studentId}/classes/${classId}`, {
            method: 'POST'
        });
    }
};