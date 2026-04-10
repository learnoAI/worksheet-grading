import { fetchAPI } from './utils';

export interface DirectUploadFileRequest {
    pageNumber: number;
    fileName: string;
    mimeType: string;
    fileSize: number;
}

export interface DirectUploadWorksheetRequest {
    studentId: string;
    studentName: string;
    tokenNo?: string;
    worksheetNumber: number;
    worksheetName?: string;
    isRepeated?: boolean;
    files: DirectUploadFileRequest[];
}

export interface DirectUploadFileSlot {
    imageId: string;
    pageNumber: number;
    mimeType: string;
    fileSize?: number | null;
    originalName?: string | null;
    s3Key: string;
    imageUrl: string;
    uploadedAt?: string | null;
    uploadUrl?: string | null;
    expiresAt?: string | null;
}

export interface DirectUploadItem {
    itemId: string;
    studentId: string;
    studentName: string;
    tokenNo?: string | null;
    worksheetNumber: number;
    worksheetName?: string | null;
    isRepeated: boolean;
    status: 'PENDING' | 'QUEUED' | 'FAILED';
    jobId?: string | null;
    errorMessage?: string | null;
    files: DirectUploadFileSlot[];
}

export interface DirectUploadSession {
    success: boolean;
    batchId: string;
    classId: string;
    submittedOn: string;
    status: 'UPLOADING' | 'FINALIZED';
    finalizedAt?: string | null;
    items: DirectUploadItem[];
}

export interface FinalizedUploadItem {
    itemId: string;
    studentId: string;
    worksheetNumber: number;
    jobId?: string | null;
    dispatchState?: 'DISPATCHED' | 'PENDING_DISPATCH';
    queuedAt?: string;
    error?: string;
    missingImageIds?: string[];
}

export interface FinalizeDirectUploadSessionResponse {
    success: boolean;
    batchId: string;
    status: 'UPLOADING' | 'FINALIZED';
    queued: FinalizedUploadItem[];
    pending: FinalizedUploadItem[];
    failed: FinalizedUploadItem[];
}

export const worksheetProcessingAPI = {
    createDirectUploadSession: async (
        classId: string,
        submittedOn: string,
        worksheets: DirectUploadWorksheetRequest[]
    ): Promise<DirectUploadSession> => {
        return fetchAPI<DirectUploadSession>('/worksheet-processing/upload-session', {
            method: 'POST',
            body: JSON.stringify({ classId, submittedOn, worksheets })
        });
    },

    getDirectUploadSession: async (batchId: string): Promise<DirectUploadSession> => {
        return fetchAPI<DirectUploadSession>(`/worksheet-processing/upload-session/${batchId}`);
    },

    finalizeDirectUploadSession: async (
        batchId: string,
        uploadedImageIds: string[]
    ): Promise<FinalizeDirectUploadSessionResponse> => {
        return fetchAPI<FinalizeDirectUploadSessionResponse>(`/worksheet-processing/upload-session/${batchId}/finalize`, {
            method: 'POST',
            body: JSON.stringify({ uploadedImageIds })
        });
    }
};
