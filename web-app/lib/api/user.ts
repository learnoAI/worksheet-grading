import { fetchAPI } from './utils';
import { User } from './types';

export const userAPI = {
    getUsers: async (role?: string): Promise<User[]> => {
        const query = role ? `?role=${role}` : '';
        return fetchAPI<User[]>(`/users${query}`);
    },

    getUsersWithDetails: async (params: {
        page?: number;
        limit?: number;
        role?: string;
        isArchived?: boolean;
        search?: string;
    } = {}): Promise<{
        users: User[];
        pagination: {
            currentPage: number;
            totalPages: number;
            totalCount: number;
            hasNextPage: boolean;
            hasPrevPage: boolean;
        };
    }> => {
        const searchParams = new URLSearchParams();
        if (params.page) searchParams.set('page', params.page.toString());
        if (params.limit) searchParams.set('limit', params.limit.toString());
        if (params.role) searchParams.set('role', params.role);
        if (params.isArchived !== undefined) searchParams.set('isArchived', params.isArchived.toString());
        if (params.search) searchParams.set('search', params.search);
        
        const query = searchParams.toString();
        return fetchAPI<{
            users: User[];
            pagination: {
                currentPage: number;
                totalPages: number;
                totalCount: number;
                hasNextPage: boolean;
                hasPrevPage: boolean;
            };
        }>(`/users/with-details${query ? `?${query}` : ''}`);
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

    updateUser: async (id: string, userData: { 
        name?: string;
        username?: string; 
        password?: string; 
        role?: string;
        tokenNumber?: string;
        classId?: string;
        schoolId?: string;
    }): Promise<User> => {
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
    },

    // Delete user (hard delete)
    deleteUser: async (id: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/users/${id}`, {
            method: 'DELETE'
        });
    }
};