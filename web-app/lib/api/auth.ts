import { fetchAPI } from './utils';
import { AuthResponse, User } from './types';

export const authAPI = {
    login: async (username: string, password: string): Promise<AuthResponse> => {
        return fetchAPI<AuthResponse>('/auth/login', {
            method: 'POST',
            body: JSON.stringify({ username, password })
        });
    },

    getCurrentUser: async (): Promise<User> => {
        return fetchAPI<User>('/auth/me');
    }
}; 