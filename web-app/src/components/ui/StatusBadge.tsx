import { cn } from '@/src/utils';
import { ReactNode } from 'react';

interface StatusBadgeProps {
  status: 'success' | 'error' | 'warning' | 'info' | 'neutral';
  children: ReactNode;
  size?: 'sm' | 'md';
  className?: string;
}

interface RoleBadgeProps {
  role: 'TEACHER' | 'STUDENT' | 'ADMIN' | 'SUPERADMIN';
  className?: string;
}

interface GradeBadgeProps {
  grade: number;
  className?: string;
}

const statusColors = {
  success: 'bg-green-100 text-green-800 border-green-200',
  error: 'bg-red-100 text-red-800 border-red-200',
  warning: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  info: 'bg-blue-100 text-blue-800 border-blue-200',
  neutral: 'bg-gray-100 text-gray-800 border-gray-200',
};

const roleColors = {
  TEACHER: 'bg-blue-100 text-blue-800 border-blue-200',
  STUDENT: 'bg-green-100 text-green-800 border-green-200',
  ADMIN: 'bg-purple-100 text-purple-800 border-purple-200',
  SUPERADMIN: 'bg-red-100 text-red-800 border-red-200',
};

export function StatusBadge({ status, children, size = 'sm', className }: StatusBadgeProps) {
  const sizeClasses = {
    sm: 'px-2 py-0.5 text-xs',
    md: 'px-2.5 py-1 text-sm',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border font-medium',
        statusColors[status],
        sizeClasses[size],
        className
      )}
    >
      {children}
    </span>
  );
}

export function RoleBadge({ role, className }: RoleBadgeProps) {
  const roleLabels = {
    TEACHER: 'Teacher',
    STUDENT: 'Student',
    ADMIN: 'Admin',
    SUPERADMIN: 'Super Admin',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        roleColors[role],
        className
      )}
    >
      {roleLabels[role]}
    </span>
  );
}

export function GradeBadge({ grade, className }: GradeBadgeProps) {
  const getGradeStatus = (grade: number) => {
    if (grade >= 90) return 'success';
    if (grade >= 80) return 'info';
    if (grade >= 70) return 'warning';
    return 'error';
  };

  return (
    <StatusBadge status={getGradeStatus(grade)} className={className}>
      {grade}%
    </StatusBadge>
  );
}
