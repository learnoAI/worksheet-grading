// API client for communicating with the backend

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5100/api';

// Types
export interface User {
    id: string;
    username: string;
    role: 'TEACHER' | 'STUDENT' | 'ADMIN' | 'SUPERADMIN';
    createdAt: string;
    updatedAt: string;
}

export interface AuthResponse {
    user: User;
    token: string;
}

export interface WorksheetImage {
    id: string;
    imageUrl: string;
    pageNumber: number;
    worksheetId: string;
    createdAt: string;
    updatedAt: string;
}

export interface Worksheet {
    id: string;
    notes?: string;
    status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    grade?: number;
    submittedById: string;
    classId: string;
    studentId?: string;
    createdAt: string;
    updatedAt: string;
    submittedBy?: User;
    class?: {
        id: string;
        name: string;
    };
    images?: WorksheetImage[];
}

export interface Notification {
    id: string;
    message: string;
    userId: string;
    status: 'READ' | 'UNREAD';
    createdAt: string;
    updatedAt: string;
}

export interface Class {
    id: string;
    name: string;
    schoolId: string;
    createdAt: string;
    updatedAt: string;
    school?: {
        id: string;
        name: string;
    };
}

export interface School {
    id: string;
    name: string;
    clusterId?: string;
    createdAt: string;
    updatedAt: string;
    cluster?: {
        id: string;
        name: string;
    };
}

// Helper function for making API requests
async function fetchAPI<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    const token = typeof window !== 'undefined' ? localStorage.getItem('token') : null;

    const headers = {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
    };

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
        ...options,
        headers
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'An error occurred');
    }

    return response.json();
}

// Auth API
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

// User API
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

// Worksheet API
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
    }
};

// Notification API
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

// Class API
export const classAPI = {
    getClasses: async (): Promise<Class[]> => {
        return fetchAPI<Class[]>('/classes');
    },

    getClassById: async (id: string): Promise<Class> => {
        return fetchAPI<Class>(`/classes/${id}`);
    }
};

// School API
export const schoolAPI = {
    getSchools: async (): Promise<School[]> => {
        return fetchAPI<School[]>('/schools');
    },

    getSchoolById: async (id: string): Promise<School> => {
        return fetchAPI<School>(`/schools/${id}`);
    }
}; 