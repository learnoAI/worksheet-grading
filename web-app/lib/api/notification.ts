import { fetchAPI } from './utils';
import { Notification } from './types';

export const notificationAPI = {
    getNotifications: async (): Promise<Notification[]> => {
        return fetchAPI<Notification[]>('/notifications');
    },

    markAsRead: async (id: string): Promise<Notification> => {
        return fetchAPI<Notification>(`/notifications/${id}/read`, {
            method: 'PUT'
        });
    },

    markAllAsRead: async (): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>('/notifications/read-all', {
            method: 'PUT'
        });
    }
}; 