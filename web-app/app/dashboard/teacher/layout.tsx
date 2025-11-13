'use client';

import { TeacherLayout } from '@/src/components/layout/TeacherLayout';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';

const teacher_path_worksheet = '/dashboard/teacher/worksheets/upload';

export default function TeacherLayoutWrapper({
    children,
}: {
    children: React.ReactNode;
}) {
    const pathname = usePathname();
    const router = useRouter();

    useEffect(() => {
        if (pathname !== teacher_path_worksheet) {
            router.replace(teacher_path_worksheet);
        }
    }, [pathname, router]);

    return (
        <TeacherLayout title="AssessWise">
            {children}
        </TeacherLayout>
    );
} 