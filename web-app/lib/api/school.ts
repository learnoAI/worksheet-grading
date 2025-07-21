import { fetchAPI } from './utils';
import { School } from './types';

export const schoolAPI = {
    getSchools: async (): Promise<School[]> => {
        return fetchAPI<School[]>('/analytics/schools');
    },

    getAllSchools: async (includeArchived: boolean = false): Promise<School[]> => {
        const query = includeArchived ? '?includeArchived=true' : '';
        return fetchAPI<School[]>(`/schools${query}`);
    },

    getArchivedSchools: async (): Promise<School[]> => {
        return fetchAPI<School[]>('/schools/archived');
    },

    getSchoolById: async (id: string): Promise<School> => {
        return fetchAPI<School>(`/analytics/schools/${id}`);
    },

    createSchool: async (schoolData: { name: string }): Promise<School> => {
        return fetchAPI<School>('/schools', {
            method: 'POST',
            body: JSON.stringify(schoolData)
        });
    },

    updateSchool: async (id: string, schoolData: { name?: string }): Promise<School> => {
        return fetchAPI<School>(`/schools/${id}`, {
            method: 'PUT',
            body: JSON.stringify(schoolData)
        });
    },

    archiveSchool: async (id: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/schools/${id}/archive`, {
            method: 'POST'
        });
    },

    unarchiveSchool: async (id: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/schools/${id}/unarchive`, {
            method: 'POST'
        });
    },

    deleteSchool: async (id: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/schools/${id}`, {
            method: 'DELETE'
        });
    }
}; 