'use client';

import { TeacherLayout } from '@/src/components/layout/TeacherLayout';

export default function TeacherLayoutWrapper({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <TeacherLayout title="AssessWise">
            {children}
        </TeacherLayout>
    );
} 