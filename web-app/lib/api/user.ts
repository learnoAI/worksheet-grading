import { fetchAPI } from './utils';
import { User } from './types';

export const userAPI = {
    getUsers: async (role?: string): Promise<User[]> => {
        const query = role ? `?role=${role}` : '';
        return fetchAPI<User[]>(`/users${query}`);
    },

    getUserById: async (id: string): Promise<User> => {
        return fetchAPI<User>(`/users/${id}`);
    },

    createUser: async (userData: { 
        name: string; 
        username: string; 
        password: string; 
        role: string;
        tokenNumber?: string;
        classId?: string;
        schoolId?: string;
    }): Promise<User> => {
        return fetchAPI<User>('/users', {
            method: 'POST',
            body: JSON.stringify(userData)
        });
    },

    updateUser: async (id: string, userData: { username?: string; password?: string; role?: string }): Promise<User> => {
        return fetchAPI<User>(`/users/${id}`, {
            method: 'PUT',
            body: JSON.stringify(userData)
        });
    },

    resetPassword: async (id: string, newPassword: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/users/${id}/reset-password`, {
            method: 'POST',
            body: JSON.stringify({ newPassword })
        });
    },

    // CSV upload for students
    uploadStudentsCsv: async (students: Array<{
        name: string;
        tokenNumber: string;
        className: string;
        schoolName: string;
    }>): Promise<{ message: string; results: any }> => {
        return fetchAPI<{ message: string; results: any }>('/users/upload-csv', {
            method: 'POST',
            body: JSON.stringify({ students })
        });
    },

    // Archive student
    archiveStudent: async (id: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/users/${id}/archive`, {
            method: 'POST'
        });
    },

    // Unarchive student
    unarchiveStudent: async (id: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/users/${id}/unarchive`, {
            method: 'POST'
        });
    }
};