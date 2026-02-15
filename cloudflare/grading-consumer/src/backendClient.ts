import { BackendAcquireResponse, GradingApiResponse } from './types';

export interface BackendClientEnv {
  BACKEND_BASE_URL: string;
  BACKEND_WORKER_TOKEN: string;
}

export class BackendHttpError extends Error {
  readonly status: number;
  readonly responseText: string;

  constructor(status: number, responseText: string) {
    super(`Backend request failed (${status}): ${responseText}`);
    this.name = 'BackendHttpError';
    this.status = status;
    this.responseText = responseText;
  }
}

export class BackendClient {
  private readonly baseUrl: string;
  private readonly token: string;

  constructor(env: BackendClientEnv) {
    if (!env.BACKEND_BASE_URL) {
      throw new Error('BACKEND_BASE_URL is required');
    }
    if (!env.BACKEND_WORKER_TOKEN) {
      throw new Error('BACKEND_WORKER_TOKEN is required');
    }

    this.baseUrl = env.BACKEND_BASE_URL.replace(/\/$/, '');
    this.token = env.BACKEND_WORKER_TOKEN;
  }

  async acquire(jobId: string): Promise<BackendAcquireResponse> {
    return this.requestJson<BackendAcquireResponse>(`/internal/grading-worker/jobs/${encodeURIComponent(jobId)}/acquire`, {
      method: 'POST',
    });
  }

  async heartbeat(jobId: string, leaseId: string): Promise<void> {
    await this.requestJson(`/internal/grading-worker/jobs/${encodeURIComponent(jobId)}/heartbeat`, {
      method: 'POST',
      body: JSON.stringify({ leaseId }),
    });
  }

  async complete(jobId: string, leaseId: string, gradingResponse: GradingApiResponse): Promise<void> {
    await this.requestJson(`/internal/grading-worker/jobs/${encodeURIComponent(jobId)}/complete`, {
      method: 'POST',
      body: JSON.stringify({ leaseId, gradingResponse }),
    });
  }

  async fail(jobId: string, leaseId: string, errorMessage: string): Promise<void> {
    await this.requestJson(`/internal/grading-worker/jobs/${encodeURIComponent(jobId)}/fail`, {
      method: 'POST',
      body: JSON.stringify({ leaseId, errorMessage }),
    });
  }

  async requeue(jobId: string, leaseId: string, reason: string): Promise<void> {
    await this.requestJson(`/internal/grading-worker/jobs/${encodeURIComponent(jobId)}/requeue`, {
      method: 'POST',
      body: JSON.stringify({ leaseId, reason }),
    });
  }

  private async requestJson<T = unknown>(path: string, init: RequestInit): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        'X-Grading-Worker-Token': this.token,
        'Content-Type': 'application/json',
        ...(init.headers || {}),
      },
    });

    const text = await res.text();
    if (!res.ok) {
      throw new BackendHttpError(res.status, text);
    }

    if (!text) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Backend response was not valid JSON');
    }
  }
}
