import { API_BASE_URL } from '../config';
import {
  BatchSaveResponse,
  ClassDateResponse,
  CreateGradedWorksheetData,
  DirectUploadSession,
  DirectUploadWorksheetRequest,
  FinalizeDirectUploadSessionResponse,
  GradingJob,
  SavedWorksheet,
  TeacherClass,
  TeacherJobsResponse,
  User,
} from '../types';

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

type RequestOptions = RequestInit & {
  token?: string | null;
};

async function parseErrorMessage(response: Response): Promise<string> {
  try {
    const body = await response.json();
    return body?.message || body?.error || `Request failed (${response.status})`;
  } catch {
    return `Request failed (${response.status})`;
  }
}

export class ApiClient {
  private token: string | null = null;

  setToken(token: string | null) {
    this.token = token;
  }

  getToken() {
    return this.token;
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const token = Object.prototype.hasOwnProperty.call(options, 'token') ? options.token : this.token;
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${API_BASE_URL}${endpoint}${separator}_t=${Date.now()}`;
    const headers = new Headers(options.headers);

    if (!headers.has('Content-Type') && options.body) {
      headers.set('Content-Type', 'application/json');
    }

    headers.set('Accept', 'application/json');

    if (token) {
      headers.set('Authorization', `Bearer ${token}`);
    }

    const response = await fetch(url, {
      ...options,
      headers,
    });

    if (!response.ok) {
      throw new ApiError(await parseErrorMessage(response), response.status);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    return response.json() as Promise<T>;
  }

  async login(username: string, password: string): Promise<{ user: User; token: string }> {
    return this.request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
      token: null,
    });
  }

  async getCurrentUser(): Promise<User> {
    return this.request('/auth/me');
  }

  async getTeacherClasses(user: User): Promise<TeacherClass[]> {
    if (user.role === 'TEACHER') {
      return this.request(`/worksheets/teacher/${encodeURIComponent(user.id)}/classes`);
    }

    return this.request('/classes');
  }

  async getClassWorksheetsForDate(
    classId: string,
    submittedOn: string,
  ): Promise<ClassDateResponse> {
    return this.request(
      `/worksheets/class-date?classId=${encodeURIComponent(classId)}&submittedOn=${encodeURIComponent(
        submittedOn,
      )}`,
    );
  }

  async checkIsRepeated(
    classId: string,
    studentId: string,
    worksheetNumber: number,
    beforeDate?: string,
  ): Promise<{
    isRepeated: boolean;
    previousWorksheet?: { id: string; grade: number; submittedOn: string } | null;
  }> {
    return this.request('/worksheets/check-repeated', {
      method: 'POST',
      body: JSON.stringify({ classId, studentId, worksheetNumber, beforeDate }),
    });
  }

  async createDirectUploadSession(
    classId: string,
    submittedOn: string,
    worksheets: DirectUploadWorksheetRequest[],
  ): Promise<DirectUploadSession> {
    return this.request('/worksheet-processing/upload-session', {
      method: 'POST',
      body: JSON.stringify({ classId, submittedOn, worksheets }),
    });
  }

  async getDirectUploadSession(batchId: string): Promise<DirectUploadSession> {
    return this.request(`/worksheet-processing/upload-session/${encodeURIComponent(batchId)}`);
  }

  async finalizeDirectUploadSession(
    batchId: string,
    uploadedImageIds: string[],
  ): Promise<FinalizeDirectUploadSessionResponse> {
    return this.request(
      `/worksheet-processing/upload-session/${encodeURIComponent(batchId)}/finalize`,
      {
        method: 'POST',
        body: JSON.stringify({ uploadedImageIds }),
      },
    );
  }

  async getBatchJobStatus(jobIds: string[]): Promise<{ success: boolean; jobs: GradingJob[] }> {
    return this.request('/grading-jobs/batch-status', {
      method: 'POST',
      body: JSON.stringify({ jobIds }),
    });
  }

  async getJobsByClassAndDate(classId: string, date: string): Promise<TeacherJobsResponse> {
    return this.request(`/grading-jobs/class/${encodeURIComponent(classId)}?date=${encodeURIComponent(date)}`);
  }

  async createGradedWorksheet(data: CreateGradedWorksheetData): Promise<SavedWorksheet> {
    const body = data.isAbsent
      ? { ...data, worksheetNumber: 0, grade: 0 }
      : data;
    return this.request('/worksheets/grade', {
      method: 'POST',
      body: JSON.stringify(body),
    });
  }

  async updateGradedWorksheet(id: string, data: CreateGradedWorksheetData): Promise<SavedWorksheet> {
    const body = data.isAbsent
      ? { ...data, worksheetNumber: 0, grade: 0 }
      : data;
    return this.request(`/worksheets/grade/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }

  async deleteGradedWorksheet(id: string): Promise<void> {
    return this.request(`/worksheets/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }

  async getWorksheetById(id: string): Promise<SavedWorksheet> {
    return this.request(`/worksheets/${encodeURIComponent(id)}`);
  }

  async getTeacherJobsToday(): Promise<TeacherJobsResponse> {
    return this.request('/grading-jobs/teacher/today');
  }

  async batchSaveWorksheets(
    classId: string,
    submittedOn: string,
    worksheets: Array<{
      studentId: string;
      worksheetNumber?: number;
      grade?: string | number;
      isAbsent?: boolean;
      isRepeated?: boolean;
      isIncorrectGrade?: boolean;
      gradingDetails?: unknown;
      wrongQuestionNumbers?: string;
      action?: 'save' | 'delete';
    }>,
  ): Promise<BatchSaveResponse> {
    return this.request('/worksheets/batch-save', {
      method: 'POST',
      body: JSON.stringify({ classId, submittedOn, worksheets }),
    });
  }
}

export const apiClient = new ApiClient();
