import { fetchAPI } from './utils';
import { School } from './types';

export const schoolAPI = {
    getSchools: async (): Promise<School[]> => {
        return fetchAPI<School[]>('/schools');
    },

    getSchoolById: async (id: string): Promise<School> => {
        return fetchAPI<School>(`/schools/${id}`);
    }
}; 