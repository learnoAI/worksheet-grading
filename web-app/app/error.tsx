'use client';

import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function Error({
    error,
    reset,
}: {
    error: Error & { digest?: string };
    reset: () => void;
}) {
    useEffect(() => {
        // Log the error to an error reporting service
        console.error('App Error:', error);
    }, [error]);

    return (
        <div className="flex min-h-screen items-center justify-center bg-gray-50 px-4 py-12">
            <div className="text-center">
                <h2 className="text-2xl font-bold mb-4">Something went wrong!</h2>
                <p className="text-gray-600 mb-6">
                    We're sorry, but something unexpected happened. Please try again.
                </p>
                <Button
                    onClick={() => {
                        // Clear any potentially corrupted state
                        if (typeof window !== 'undefined') {
                            localStorage.clear();
                            sessionStorage.clear();
                        }
                        reset();
                    }}
                >
                    Try again
                </Button>
                <Button
                    variant="outline"
                    className="ml-2"
                    onClick={() => {
                        if (typeof window !== 'undefined') {
                            window.location.href = '/login';
                        }
                    }}
                >
                    Go to Login
                </Button>
            </div>
        </div>
    );
}
