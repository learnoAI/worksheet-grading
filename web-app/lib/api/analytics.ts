import { fetchAPI } from './utils';

// Import API_BASE_URL to use for download
const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5100/api';

export interface OverallAnalytics {
    totalWorksheets: number; // Non-absent worksheets (total - absent)
    totalAbsent: number;
    absentPercentage: number;
    totalRepeated: number;
    repetitionRate: number;
    highScoreCount: number;
    highScorePercentage: number;
    totalGraded: number;
    needsRepetitionCount: number;
    needsRepetitionPercentage: number;
}

export interface StudentAnalytics {
    id: string;
    name: string;
    username: string;
    tokenNumber: string | null;
    isArchived: boolean;
    class: string;
    school: string;
    totalWorksheets: number; // Non-absent worksheets for this student
    absentCount: number;
    absentPercentage: number;
    repeatedCount: number;
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
    getOverallAnalytics: async (startDate: string, endDate: string, schoolIds?: string[]): Promise<OverallAnalytics> => {
        let url = `/analytics/overall?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`;
        
        if (schoolIds && schoolIds.length > 0) {
            // Add school filters to URL
            schoolIds.forEach(schoolId => {
                url += `&schoolIds=${encodeURIComponent(schoolId)}`;
            });
        }
        
        return fetchAPI<OverallAnalytics>(url);
    },
    
    getStudentAnalytics: async (filters?: { schoolId?: string; classId?: string; startDate?: string; endDate?: string }): Promise<StudentAnalytics[]> => {
        let url = '/analytics/students';
        const params = new URLSearchParams();
        if (filters?.schoolId) params.append('schoolId', filters.schoolId);
        if (filters?.classId) params.append('classId', filters.classId);
        if (filters?.startDate) params.append('startDate', filters.startDate);
        if (filters?.endDate) params.append('endDate', filters.endDate);
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
    },

    // Download student analytics as CSV
    downloadStudentAnalytics: async (filters?: { schoolId?: string; classId?: string; startDate?: string; endDate?: string }): Promise<void> => {
        let url = '/analytics/students/download?format=csv';
        if (filters) {
            const params = new URLSearchParams();
            if (filters.schoolId) params.append('schoolId', filters.schoolId);
            if (filters.classId) params.append('classId', filters.classId);
            if (filters.startDate) params.append('startDate', filters.startDate);
            if (filters.endDate) params.append('endDate', filters.endDate);
            if (params.toString()) {
                url += `&${params.toString()}`;
            }
        }
        
        // Get token from cookie (same way as fetchAPI utility)
        const token = typeof window !== 'undefined' ? 
            document.cookie
                .split('; ')
                .find(row => row.startsWith('token='))
                ?.split('=')[1] : null;
        
        try {
            const response = await fetch(`${API_BASE_URL}${url}`, {
                method: 'GET',
                headers: {
                    ...(token ? { Authorization: `Bearer ${token}` } : {})
                }
            });

            if (!response.ok) {
                const error = await response.json();
                throw new Error(error.message || 'Failed to download analytics data');
            }

            // Get the filename from response headers or create a default one
            const contentDisposition = response.headers.get('content-disposition');
            let filename = 'student_analytics.csv';
            if (contentDisposition) {
                const filenameMatch = contentDisposition.match(/filename="(.+)"/);
                if (filenameMatch) {
                    filename = filenameMatch[1];
                }
            }

            // Create blob and download
            const blob = await response.blob();
            const downloadUrl = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = downloadUrl;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            window.URL.revokeObjectURL(downloadUrl);
        } catch (error) {
            console.error('Error downloading analytics:', error);
            throw error;
        }
    }
};