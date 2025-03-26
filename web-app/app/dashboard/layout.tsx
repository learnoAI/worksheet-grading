'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export default function DashboardLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, isLoading } = useAuth();
    const router = useRouter();

    // Redirect based on user role
    useEffect(() => {
        if (!isLoading) {
            if (!user) {
                router.push('/login');
            } else {
                switch (user.role) {
                    case 'SUPERADMIN':
                        router.push('/dashboard/superadmin');
                        break;
                    case 'TEACHER':
                        router.push('/dashboard/teacher');
                        break;
                    case 'STUDENT':
                        router.push('/dashboard/student');
                        break;
                    case 'ADMIN':
                        router.push('/dashboard/admin');
                        break;
                    default:
                        router.push('/login');
                }
            }
        }
    }, [user, isLoading, router]);

    if (isLoading) {
        return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }

    return children;
} 