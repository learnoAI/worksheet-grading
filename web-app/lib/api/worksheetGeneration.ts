import { fetchAPI } from './utils';

export interface GeneratedWorksheet {
    id: string;
    scheduledDate: string;
    status: 'PENDING' | 'QUESTIONS_READY' | 'RENDERING' | 'COMPLETED' | 'FAILED';
    pdfUrl: string | null;
    newSkillId: string;
    newSkillName: string | null;
    reviewSkill1Id: string;
    reviewSkill1Name: string | null;
    reviewSkill2Id: string;
    reviewSkill2Name: string | null;
    createdAt: string;
}

export const worksheetGenerationAPI = {
    generate: async (studentId: string, days: number, startDate: string) => {
        return fetchAPI<{ success: boolean; data: { worksheetIds: string[]; status: string; errors: string[] } }>(
            '/worksheet-generation/generate',
            { method: 'POST', body: JSON.stringify({ studentId, days, startDate }) }
        );
    },

    listForStudent: async (studentId: string) => {
        return fetchAPI<{ success: boolean; data: GeneratedWorksheet[] }>(
            `/worksheet-generation/student/${studentId}`
        );
    }
};
