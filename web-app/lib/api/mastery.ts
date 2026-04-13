import { fetchAPI } from './utils';

// ── Types ──────────────────────────────────────────────────────────────────

export type MasteryLevel = 'NOT_STARTED' | 'ATTEMPTED' | 'FAMILIAR' | 'PROFICIENT' | 'MASTERED';

export interface SkillMastery {
    mathSkillId: string;
    skillName: string;
    mainTopicName: string | null;
    masteryLevel: MasteryLevel;
    lastScore: number | null;
    lastPracticeAt: string | null;
    practiceCount: number;
    testCount: number;
    stability: number;
    difficulty: number;
}

export interface StudentMasteryResponse {
    success: boolean;
    data: {
        studentId: string;
        summary: Record<MasteryLevel, number>;
        totalSkills: number;
        skills: SkillMastery[];
    };
}

export interface TopicMastery {
    topicId: string;
    topicName: string;
    skillCount: number;
    averageMasteryScore: number;
    skills: {
        mathSkillId: string;
        skillName: string;
        masteryLevel: MasteryLevel;
        lastScore: number | null;
        practiceCount: number;
    }[];
}

export interface StudentMasteryByTopicResponse {
    success: boolean;
    data: {
        studentId: string;
        topics: TopicMastery[];
    };
}

export interface Recommendation {
    mathSkillId: string;
    skillName: string;
    mainTopicName: string | null;
    masteryLevel: MasteryLevel;
    retrievability: number;
    daysSinceLastPractice: number;
    priority: number;
    worksheetNumbers: number[];
}

export interface StudentRecommendationsResponse {
    success: boolean;
    data: {
        studentId: string;
        recommendations: Recommendation[];
    };
}

export interface ClassMasteryStudent {
    studentId: string;
    studentName: string;
    tokenNumber: string | null;
    skills: {
        mathSkillId: string;
        masteryLevel: MasteryLevel;
    }[];
}

export interface ClassMasterySkill {
    id: string;
    name: string;
    mainTopicName: string | null;
}

export interface ClassMasteryOverviewResponse {
    success: boolean;
    data: {
        classId: string;
        skills: ClassMasterySkill[];
        students: ClassMasteryStudent[];
        pagination: {
            page: number;
            pageSize: number;
            totalSkills: number;
            totalPages: number;
        };
    };
}

// ── API ────────────────────────────────────────────────────────────────────

export const masteryAPI = {
    getStudentMastery: async (studentId: string): Promise<StudentMasteryResponse> => {
        return fetchAPI(`/mastery/student/${studentId}`);
    },

    getStudentMasteryByTopic: async (studentId: string): Promise<StudentMasteryByTopicResponse> => {
        return fetchAPI(`/mastery/student/${studentId}/by-topic`);
    },

    getStudentRecommendations: async (studentId: string, limit?: number): Promise<StudentRecommendationsResponse> => {
        const params = limit ? `?limit=${limit}` : '';
        return fetchAPI(`/mastery/student/${studentId}/recommendations${params}`);
    },

    getClassMasteryOverview: async (classId: string, filters?: {
        mainTopicId?: string;
        page?: number;
        pageSize?: number;
    }): Promise<ClassMasteryOverviewResponse> => {
        const params = new URLSearchParams();
        if (filters?.mainTopicId) params.append('mainTopicId', filters.mainTopicId);
        if (filters?.page) params.append('page', filters.page.toString());
        if (filters?.pageSize) params.append('pageSize', filters.pageSize.toString());
        const qs = params.toString();
        return fetchAPI(`/mastery/class/${classId}${qs ? `?${qs}` : ''}`);
    }
};
