import { fetchAPI } from './utils';
import { Class, User } from './types';

export const classAPI = {
    getClasses: async (): Promise<Class[]> => {
        return fetchAPI<Class[]>('/classes');
    },

    getClassById: async (id: string): Promise<Class> => {
        return fetchAPI<Class>(`/classes/${id}`);
    },

    getTeacherClasses: async (teacherId: string): Promise<Class[]> => {
        return fetchAPI<Class[]>(`/worksheets/teacher/${teacherId}/classes`);
    },

    getClassStudents: async (classId: string): Promise<User[]> => {
        return fetchAPI<User[]>(`/worksheets/class/${classId}/students`);
    },

    // SuperAdmin-only functions for archive management
    getAllClasses: async (includeArchived: boolean = false): Promise<Class[]> => {
        const query = includeArchived ? '?includeArchived=true' : '';
        return fetchAPI<Class[]>(`/classes${query}`);
    },

    getArchivedClasses: async (): Promise<Class[]> => {
        return fetchAPI<Class[]>('/classes/archived');
    },

    archiveClass: async (id: string): Promise<{ message: string; class: Class }> => {
        return fetchAPI<{ message: string; class: Class }>(`/classes/${id}/archive`, {
            method: 'POST'
        });
    },

    unarchiveClass: async (id: string): Promise<{ message: string; class: Class }> => {
        return fetchAPI<{ message: string; class: Class }>(`/classes/${id}/unarchive`, {
            method: 'POST'
        });
    }
};