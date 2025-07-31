import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { GRADE_THRESHOLDS } from '../constants';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatDate(date: string | Date): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(date: string | Date): string {
  if (!date) return '';
  const d = new Date(date);
  return d.toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function getGradeColor(grade: number): string {
  if (grade >= GRADE_THRESHOLDS.EXCELLENT) return 'text-green-600';
  if (grade >= GRADE_THRESHOLDS.GOOD) return 'text-blue-600';
  if (grade >= GRADE_THRESHOLDS.AVERAGE) return 'text-yellow-600';
  if (grade >= GRADE_THRESHOLDS.BELOW_AVERAGE) return 'text-orange-600';
  return 'text-red-600';
}

export function getGradeLabel(grade: number): string {
  if (grade >= GRADE_THRESHOLDS.EXCELLENT) return 'Excellent';
  if (grade >= GRADE_THRESHOLDS.GOOD) return 'Good';
  if (grade >= GRADE_THRESHOLDS.AVERAGE) return 'Average';
  if (grade >= GRADE_THRESHOLDS.BELOW_AVERAGE) return 'Below Average';
  return 'Needs Improvement';
}

export function getInitials(name: string): string {
  return name
    .split(' ')
    .slice(0, 2)
    .map(n => n.charAt(0))
    .join('')
    .toUpperCase();
}

export function generateAvatarColor(name: string): string {
  const colors = [
    'bg-red-500',
    'bg-blue-500',
    'bg-green-500',
    'bg-yellow-500',
    'bg-purple-500',
    'bg-pink-500',
    'bg-indigo-500',
    'bg-teal-500',
  ];
  
  const hash = name.split('').reduce((acc, char) => {
    return acc + char.charCodeAt(0);
  }, 0);
  
  return colors[hash % colors.length];
}

export function sortByTokenNumber<T extends { tokenNumber: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => {
    const aNum = parseInt(a.tokenNumber) || 0;
    const bNum = parseInt(b.tokenNumber) || 0;
    return aNum - bNum;
  });
}

export function debounce<T extends (...args: any[]) => any>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: NodeJS.Timeout;
  return (...args: Parameters<T>) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function isValidEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export function capitalizeFirstLetter(string: string): string {
  return string.charAt(0).toUpperCase() + string.slice(1).toLowerCase();
}

export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...';
}
