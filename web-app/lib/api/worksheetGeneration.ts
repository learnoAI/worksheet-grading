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

export interface WorksheetBatch {
    id: string;
    classId: string;
    days: number;
    startDate: string;
    status: 'PENDING' | 'GENERATING_QUESTIONS' | 'RENDERING_PDFS' | 'COMPLETED' | 'FAILED';
    totalWorksheets: number;
    completedWorksheets: number;
    failedWorksheets: number;
    pendingSkills: number;
    completedSkills: number;
    createdAt: string;
    updatedAt: string;
}

export const worksheetGenerationAPI = {
    generate: async (studentId: string, days: number, startDate: string) => {
        return fetchAPI<{ success: boolean; data: { worksheetIds: string[]; status: string; errors: string[] } }>(
            '/worksheet-generation/generate',
            { method: 'POST', body: JSON.stringify({ studentId, days, startDate }) }
        );
    },

    generateClass: async (classId: string, days: number, startDate: string) => {
        return fetchAPI<{ success: boolean; data: { batchId: string; totalWorksheets: number; skillsToGenerate: number; errors: string[] } }>(
            '/worksheet-generation/generate-class',
            { method: 'POST', body: JSON.stringify({ classId, days, startDate }) }
        );
    },

    getBatchStatus: async (batchId: string) => {
        return fetchAPI<{ success: boolean; data: WorksheetBatch }>(
            `/worksheet-generation/batch/${batchId}`
        );
    },

    listForStudent: async (studentId: string) => {
        return fetchAPI<{ success: boolean; data: GeneratedWorksheet[] }>(
            `/worksheet-generation/student/${studentId}`
        );
    }
};
