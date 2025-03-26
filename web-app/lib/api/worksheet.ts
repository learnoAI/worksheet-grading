import { fetchAPI, API_BASE_URL } from './utils';
import { Worksheet } from './types';

interface GradedWorksheetData {
    classId: string;
    studentId: string;
    worksheetNumber: number;
    grade: number;
    notes?: string;
    submittedOn: string;
}

export const worksheetAPI = {
    uploadWorksheet: async (formData: FormData): Promise<Worksheet> => {
        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

        const response = await fetch(`${API_BASE_URL}/worksheets/upload`, {
            method: 'POST',
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {})
            },
            body: formData
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.message || 'An error occurred during upload');
        }

        return response.json();
    },

    getWorksheetsByClass: async (classId: string): Promise<Worksheet[]> => {
        return fetchAPI<Worksheet[]>(`/worksheets/class/${classId}`);
    },

    getWorksheetsByStudent: async (studentId: string): Promise<Worksheet[]> => {
        return fetchAPI<Worksheet[]>(`/worksheets/student/${studentId}`);
    },

    getWorksheetById: async (id: string): Promise<Worksheet> => {
        return fetchAPI<Worksheet>(`/worksheets/${id}`);
    },

    createGradedWorksheet: async (data: GradedWorksheetData): Promise<Worksheet> => {
        return fetchAPI<Worksheet>('/worksheets/grade', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    getWorksheetByClassStudentDate: async (classId: string, studentId: string, submittedOn: string): Promise<GradedWorksheetData | null> => {
        // Create date objects for start and end of the selected date in UTC
        const date = new Date(submittedOn);
        const startDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
        const endDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1));

        return fetchAPI<GradedWorksheetData | null>(`/worksheets/find?classId=${classId}&studentId=${studentId}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}`);
    },

    updateGradedWorksheet: async (worksheetNumber: number, data: GradedWorksheetData): Promise<GradedWorksheetData> => {
        return fetchAPI<GradedWorksheetData>(`/worksheets/grade/${worksheetNumber}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    }
}; 