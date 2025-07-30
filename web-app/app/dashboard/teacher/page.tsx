'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';

export default function TeacherDashboardPage() {
    const { user, isLoading } = useAuth();
    const router = useRouter();

    useEffect(() => {
        if (!isLoading && user && user.role === 'TEACHER') {
            router.push('/dashboard/teacher/worksheets/upload');
        }
    }, [user, isLoading, router]);

    return (
        <div className="flex items-center justify-center min-h-screen">
            <div>Loading...</div>
        </div>
    );
} 