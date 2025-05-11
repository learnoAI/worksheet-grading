// Utility functions for API client

export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5100/api';

// Helper function for making API requests
export async function fetchAPI<T>(
    endpoint: string,
    options: RequestInit = {}
): Promise<T> {
    // Get token from cookie
    const token = document.cookie
        .split('; ')
        .find(row => row.startsWith('token='))
        ?.split('=')[1];

    const headers = {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...options.headers
    };

    // Add a timestamp to the URL to bypass caching
    const timeStamp = new Date().getTime();
    const separator = endpoint.includes('?') ? '&' : '?';
    const url = `${API_BASE_URL}${endpoint}${separator}_t=${timeStamp}`;

    const response = await fetch(url, {
        ...options,
        headers,
        cache: 'no-store',
        next: { revalidate: 0 } // Tell Next.js to always revalidate this request
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(error.message || 'An error occurred');
    }

    return response.json();
} 