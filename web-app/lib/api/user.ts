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

    createUser: async (userData: { username: string; password: string; role: string }): Promise<User> => {
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
    }
}; 