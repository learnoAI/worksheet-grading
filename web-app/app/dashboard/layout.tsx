'use client';

import { useAuth } from '@/lib/auth-context';
import { PostHogProvider } from '@/components/providers';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { isLoading } = useAuth();

    if (isLoading) {
        return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }

    return (
        <PostHogProvider>
            {children}
        </PostHogProvider>
    );
} 