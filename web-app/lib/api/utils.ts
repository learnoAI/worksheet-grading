// Utility functions for API client

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5100/api';

// Helper function for making API requests (JSON)
export async function fetchAPI<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
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

    const response = await fetch(url, { ...options, headers, cache: 'no-store' });

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