// Utility functions for API client with retry logic

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5100/api';

// Retry configuration types
export interface RetryConfig {
    retries?: number;          // number of retry attempts (excluding first attempt)
    baseDelayMs?: number;      // base delay for first retry
    backoffFactor?: number;    // multiplier for subsequent retries
    maxDelayMs?: number;       // cap for delay between retries
    retryOnStatus?: number[];  // additional HTTP status codes to retry besides 5xx + 429
}

const DEFAULT_RETRY: Required<RetryConfig> = {
    retries: 3,
    baseDelayMs: 400,
    backoffFactor: 2,
    maxDelayMs: 4000,
    retryOnStatus: [429]
};

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)); }

function computeDelay(attempt: number, cfg: Required<RetryConfig>): number {
    const base = Math.min(cfg.baseDelayMs * Math.pow(cfg.backoffFactor, attempt), cfg.maxDelayMs);
    const jitter = base * (Math.random() * 0.6 - 0.3); // +/-30%
    return Math.max(50, Math.round(base + jitter));
}

function shouldRetry(response: Response | null, error: unknown, attempt: number, cfg: Required<RetryConfig>): { retry: boolean; waitMs?: number } {
    if (attempt >= cfg.retries) return { retry: false };
    if (error) return { retry: true };
    if (!response) return { retry: true };

    const status = response.status;
    if (cfg.retryOnStatus.includes(status)) {
        const retryAfter = response.headers.get('Retry-After');
        if (retryAfter) {
            const seconds = parseInt(retryAfter, 10);
            if (!isNaN(seconds)) {
                return { retry: true, waitMs: Math.min(seconds * 1000, cfg.maxDelayMs) };
            }
        }
        return { retry: true };
    }
    if (status >= 500 && status <= 599) return { retry: true };
    return { retry: false };
}

export async function fetchWithRetry(url: string, init: RequestInit, retry?: RetryConfig | false): Promise<Response> {
    const cfg: Required<RetryConfig> = { ...DEFAULT_RETRY, ...(retry || {}) } as Required<RetryConfig>;
    if (retry === false) cfg.retries = 0;

    let attempt = 0;
    while (true) {
        let response: Response | null = null;
        let error: unknown = null;
        try {
            response = await fetch(url, init);
        } catch (e) {
            error = e;
        }
        if (response && response.ok) return response;
        const { retry: doRetry, waitMs } = shouldRetry(response, error, attempt, cfg);
        if (!doRetry) {
            if (error) throw error;
            if (response) return response; // allow caller to parse error body
            throw new Error('Request failed with unknown error');
        }
        await sleep(waitMs ?? computeDelay(attempt, cfg));
        attempt += 1;
    }
}

export interface FetchAPIOptions extends RequestInit { retry?: RetryConfig | false; }

// Helper function for making API requests (JSON) with retry
export async function fetchAPI<T>(endpoint: string, options: FetchAPIOptions = {}): Promise<T> {
    const token = typeof document !== 'undefined'
        ? document.cookie
            .split('; ')
            .find(row => row.startsWith('token='))
            ?.split('=')[1]
        : undefined;

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers as Record<string, string> | undefined)
    };

    const timeStamp = Date.now();
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${API_BASE_URL}${endpoint}${separator}_t=${timeStamp}`;

    const response = await fetchWithRetry(url, { ...options, headers, cache: 'no-store' }, options.retry);

    if (!response.ok) {
        let message = `Request failed (${response.status})`;
        try {
            const body = await response.json();
            if (body?.message) message = body.message;
        } catch {/* ignore */}
        throw new Error(message);
    }

    if (response.status === 204) return undefined as T;
    return response.json() as Promise<T>;
}