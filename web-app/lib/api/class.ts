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
    }
}; 