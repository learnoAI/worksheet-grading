import { fetchAPI } from './utils';
import { Class, User } from './types';

export const classAPI = {
    getClasses: async (): Promise<Class[]> => {
        return fetchAPI<Class[]>('/classes');
    },

    createClass: async (data: { name: string; schoolId: string; academicYear: string }): Promise<Class> => {
        return fetchAPI<Class>('/classes', {
            method: 'POST',
            body: JSON.stringify(data)
        });
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
    },

    // Teacher management functions
    getClassTeachers: async (classId: string): Promise<User[]> => {
        return fetchAPI<User[]>(`/classes/${classId}/teachers`);
    },

    getAvailableTeachers: async (classId: string): Promise<User[]> => {
        return fetchAPI<User[]>(`/classes/teachers/available/${classId}`);
    },

    addTeacherToClass: async (classId: string, teacherId: string): Promise<any> => {
        return fetchAPI<any>(`/classes/${classId}/teachers/${teacherId}`, {
            method: 'POST'
        });
    },    removeTeacherFromClass: async (classId: string, teacherId: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/classes/${classId}/teachers/${teacherId}`, {
            method: 'DELETE'
        });
    },

    // Student management functions
    getClassStudentsWithDetails: async (classId: string): Promise<User[]> => {
        return fetchAPI<User[]>(`/classes/${classId}/students`);
    },

    addStudentToClass: async (classId: string, studentId: string): Promise<any> => {
        return fetchAPI<any>(`/classes/${classId}/students/${studentId}`, {
            method: 'POST'
        });
    },

    removeStudentFromClass: async (classId: string, studentId: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/classes/${classId}/students/${studentId}`, {
            method: 'DELETE'
        });    },

    // Alias methods for backwards compatibility
    getStudents: async (classId: string): Promise<User[]> => {
        return fetchAPI<User[]>(`/classes/${classId}/students`);
    },

    getTeachers: async (classId: string): Promise<User[]> => {
        return fetchAPI<User[]>(`/classes/${classId}/teachers`);
    },

    addStudent: async (classId: string, studentId: string): Promise<any> => {
        return fetchAPI<any>(`/classes/${classId}/students/${studentId}`, {
            method: 'POST'
        });
    },

    removeStudent: async (classId: string, studentId: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/classes/${classId}/students/${studentId}`, {
            method: 'DELETE'
        });
    },

    addTeacher: async (classId: string, teacherId: string): Promise<any> => {
        return fetchAPI<any>(`/classes/${classId}/teachers/${teacherId}`, {
            method: 'POST'
        });
    },

    removeTeacher: async (classId: string, teacherId: string): Promise<{ message: string }> => {
        return fetchAPI<{ message: string }>(`/classes/${classId}/teachers/${teacherId}`, {
            method: 'DELETE'
        });
    },

    getAvailableStudents: async (classId: string): Promise<User[]> => {
        return fetchAPI<User[]>(`/classes/students/available/${classId}`);
    }
};
