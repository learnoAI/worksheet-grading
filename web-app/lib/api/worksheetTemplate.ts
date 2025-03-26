import { fetchAPI, API_BASE_URL } from './utils';
import { WorksheetTemplate, WorksheetTemplateImage, WorksheetTemplateQuestion, MathSkill } from './types';

export const worksheetTemplateAPI = {
    // Template CRUD operations
    getAllTemplates: async (): Promise<WorksheetTemplate[]> => {
        return fetchAPI<WorksheetTemplate[]>('/worksheet-templates');
    },

    getTemplateById: async (id: string): Promise<WorksheetTemplate> => {
        return fetchAPI<WorksheetTemplate>(`/worksheet-templates/${id}`);
    },

    createTemplate: async (data: { worksheetNumber?: number }): Promise<WorksheetTemplate> => {
        return fetchAPI<WorksheetTemplate>('/worksheet-templates', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    updateTemplate: async (id: string, data: { worksheetNumber?: number }): Promise<WorksheetTemplate> => {
        return fetchAPI<WorksheetTemplate>(`/worksheet-templates/${id}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    deleteTemplate: async (id: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/worksheet-templates/${id}`, {
            method: 'DELETE'
        });
    },

    // Template Image operations
    addTemplateImage: async (
        templateId: string,
        data: { imageUrl: string; pageNumber: number }
    ): Promise<WorksheetTemplateImage> => {
        return fetchAPI<WorksheetTemplateImage>(`/worksheet-templates/${templateId}/images`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    deleteTemplateImage: async (imageId: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/worksheet-templates/images/${imageId}`, {
            method: 'DELETE'
        });
    },

    // Template Question operations
    addTemplateQuestion: async (
        templateId: string,
        data: {
            question: string;
            answer?: string;
            outOf?: number;
            skillIds?: string[];
        }
    ): Promise<WorksheetTemplateQuestion> => {
        return fetchAPI<WorksheetTemplateQuestion>(`/worksheet-templates/${templateId}/questions`, {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    updateTemplateQuestion: async (
        questionId: string,
        data: {
            question?: string;
            answer?: string;
            outOf?: number;
            skillIds?: string[];
        }
    ): Promise<WorksheetTemplateQuestion> => {
        return fetchAPI<WorksheetTemplateQuestion>(`/worksheet-templates/questions/${questionId}`, {
            method: 'PUT',
            body: JSON.stringify(data)
        });
    },

    deleteTemplateQuestion: async (questionId: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/worksheet-templates/questions/${questionId}`, {
            method: 'DELETE'
        });
    },

    // Math Skill operations
    getAllMathSkills: async (): Promise<MathSkill[]> => {
        return fetchAPI<MathSkill[]>('/math-skills');
    },

    createMathSkill: async (data: { name: string; description?: string }): Promise<MathSkill> => {
        return fetchAPI<MathSkill>('/math-skills', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    // Image upload helper
    uploadTemplateImage: async (templateId: string, file: File, pageNumber: number): Promise<WorksheetTemplateImage> => {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('pageNumber', pageNumber.toString());

        const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

        const response = await fetch(`${API_BASE_URL}/worksheet-templates/${templateId}/upload-image`, {
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
    }
}; 