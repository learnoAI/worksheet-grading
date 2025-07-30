'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button } from '@/components/ui/button';

export default function TeacherLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, isLoading, logout } = useAuth();
    const router = useRouter();

    // Redirect if not authenticated or not a teacher
    useEffect(() => {
        if (!isLoading && (!user || user.role !== 'TEACHER')) {
            router.push('/login');
        }
    }, [user, isLoading, router]);

    // Handle logout
    const handleLogout = () => {
        logout();
        router.push('/login');
    };

    if (isLoading || !user) {
        return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }    return (
        <div className="min-h-screen bg-gray-100">
            {/* Header */}
            <header className="bg-white shadow">
                <div className="max-w-7xl mx-auto px-3 md:px-4 lg:px-8 py-3 md:py-4 flex justify-between items-center">
                    <h1 className="text-lg md:text-xl font-bold">Worksheet Grading App</h1>
                    <div className="flex items-center gap-2 md:gap-4">
                        <div className="text-xs md:text-sm text-gray-600 hidden sm:block">
                            Logged in as <span className="font-medium">{user.username}</span> (Teacher)
                        </div>
                        <Button variant="outline" size="sm" onClick={handleLogout}>
                            Logout
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <div className="max-w-7xl mx-auto px-2 md:px-4 lg:px-8 py-3 md:py-6">
                <main className="bg-white p-3 md:p-6 rounded-lg shadow">
                    {children}
                </main>
            </div>
        </div>
    );
} 