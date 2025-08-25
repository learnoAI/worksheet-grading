import { fetchAPI, API_BASE_URL } from './utils';
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
    },    createGradedWorksheet: async (data: CreateGradedWorksheetData): Promise<Worksheet> => {
        try {
            // Deep clone the data to avoid modifying the original object
            const requestData = JSON.parse(JSON.stringify(data));
            
            // Ensure proper data formatting for absent students
            if (requestData.isAbsent) {
                // For absent students, ensure worksheetNumber is 0 and grade is 0
                requestData.worksheetNumber = 0;
                requestData.grade = 0;
                requestData.isRepeated = false;
                requestData.mongoDbId = null; // No MongoDB ID for absent students
            } else {
                // For present students, ensure values are proper numbers
                requestData.grade = parseFloat(requestData.grade.toString());
                requestData.worksheetNumber = parseInt(requestData.worksheetNumber.toString());
                // Keep the mongoDbId if it exists
            }
            
            // Add logging to help diagnose issues
            console.log(`Creating new worksheet with data:`, requestData);
            
            // Add timestamp to ensure fresh request
            const timestamp = new Date().getTime();
            
            // Use the new endpoint that handles MongoDB ID if it's provided, otherwise use the standard endpoint
            const endpoint = requestData.mongoDbId 
                ? `/worksheet-processing/grade-with-mongo-id?_t=${timestamp}`
                : `/worksheets/grade?_t=${timestamp}`;
                
            const result = await fetchAPI<Worksheet>(endpoint, {
                method: 'POST',
                body: JSON.stringify(requestData)
            });
            
            // Log the response
            console.log(`Creation response for new worksheet:`, result);
            
            return result;
        } catch (error) {
            console.error(`Error creating worksheet:`, error);
            throw error;
        }
    },

    getWorksheetByClassStudentDate: async (classId: string, studentId: string, submittedOn: string): Promise<GradedWorksheetData | null> => {
        try {
            // Create date objects for start and end of the selected date in UTC
            const date = new Date(submittedOn);
            const startDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
            const endDate = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate() + 1));
            
            // Add a unique timestamp to force a fresh request
            const timestamp = new Date().getTime();

            const response = await fetchAPI<GradedWorksheetData | null>(
                `/worksheets/find?classId=${encodeURIComponent(classId)}&studentId=${encodeURIComponent(studentId)}&startDate=${startDate.toISOString()}&endDate=${endDate.toISOString()}&_t=${timestamp}`
            );
            
            // Debug logging to check if gradingDetails is present in the response
            if (response) {
                console.log(`Received worksheet data for student:`, {
                    id: response.id,
                    grade: response.grade,
                    hasGradingDetails: !!response.gradingDetails,
                    gradingDetailsKeys: response.gradingDetails ? Object.keys(response.gradingDetails) : null
                });
            }
            
            // Explicitly handle the isAbsent property to ensure it's the correct boolean type
            if (response) {
                return {
                    ...response,
                    isAbsent: response.isAbsent === true
                };
            }
            
            return response;
        } catch (error) {
            console.error('Error fetching worksheet by date:', error);
            return null;
        }
    },

    updateGradedWorksheet: async (id: string, data: CreateGradedWorksheetData): Promise<GradedWorksheetData> => {
        try {
            const requestData = JSON.parse(JSON.stringify(data));
            
            if (requestData.isAbsent) {
                requestData.worksheetNumber = 0;
                requestData.grade = 0;
                requestData.isRepeated = false;
            } else {
                requestData.grade = parseFloat(requestData.grade.toString());
                requestData.worksheetNumber = parseInt(requestData.worksheetNumber.toString());
            }
            
            console.log(`Updating worksheet ${id} with data:`, requestData);
            
            const timestamp = new Date().getTime();
            
            const result = await fetchAPI<GradedWorksheetData>(`/worksheets/grade/${id}?_t=${timestamp}`, {
                method: 'PUT',
                body: JSON.stringify(requestData)
            });
            
            console.log(`Update response for worksheet ${id}:`, result);
            
            return result;
        } catch (error) {
            console.error(`Error updating worksheet ${id}:`, error);
            throw error;
        }
    },

    deleteGradedWorksheet: async (id: string): Promise<void> => {
        return fetchAPI<void>(`/worksheets/${id}`, {
            method: 'DELETE'
        });
    },

    getPreviousWorksheets: async (classId: string, studentId: string, currentDate: string): Promise<Worksheet[]> => {
        try {
            const date = new Date(currentDate);
            date.setHours(0, 0, 0, 0);

            const today = new Date();
            today.setHours(0, 0, 0, 0);
            
            const endDate = date > today ? today : date;
            const formattedEndDate = new Date(Date.UTC(
                endDate.getFullYear(), 
                endDate.getMonth(), 
                endDate.getDate()
            ));
            
            const timestamp = new Date().getTime();
            
            const url = `/worksheets/history?classId=${classId}&studentId=${studentId}&endDate=${formattedEndDate.toISOString()}&_t=${timestamp}`;
            
            const worksheets = await fetchAPI<Worksheet[]>(url);
            return worksheets;
        } catch (error) {
            console.error('Error fetching previous worksheets:', error);
            return [];
        }
    },

    getIncorrectGradingWorksheets: async (params?: { page?: number; pageSize?: number; startDate?: string; endDate?: string }): Promise<{ data: any[]; total: number; page: number; pageSize: number }> => {
        try {
            const query = new URLSearchParams();
            if (params?.page) query.set('page', String(params.page));
            if (params?.pageSize) query.set('pageSize', String(params.pageSize));
            if (params?.startDate) query.set('startDate', params.startDate);
            if (params?.endDate) query.set('endDate', params.endDate);
            const qs = query.toString();
            const endpoint = `/worksheets/incorrect-grading${qs ? `?${qs}` : ''}`;
            return fetchAPI<{ data: any[]; total: number; page: number; pageSize: number }>(endpoint);
        } catch (error) {
            console.error('Error fetching incorrect grading worksheets:', error);
            throw error;
        }
    },

    updateWorksheetAdminComments: async (worksheetId: string, data: { adminComments: string }): Promise<void> => {
        try {
            await fetchAPI<void>(`/worksheets/${worksheetId}/admin-comments`, {
                method: 'PATCH',
                body: JSON.stringify(data)
            });
        } catch (error) {
            console.error('Error updating worksheet admin comments:', error);
            throw error;
        }
    },

    getWorksheetImages: async (tokenNo: string, worksheetName: string): Promise<string[]> => {
        try {
            const response = await fetchAPI<string[]>(`/worksheets/images`, {
                method: 'POST',
                body: JSON.stringify({
                    token_no: tokenNo,
                    worksheet_name: worksheetName
                })
            });
            return response;
        } catch (error) {
            console.error('Error fetching worksheet images:', error);
            throw error;
        }
    },

    getTotalAiGraded: async (): Promise<{ total_ai_graded: number }> => {
        try {
            return fetchAPI<{ total_ai_graded: number }>('/worksheets/total-ai-graded');
        } catch (error) {
            console.error('Error fetching total AI graded count:', error);
            throw error;
        }
    }
};