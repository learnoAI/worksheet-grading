const fallbackApiBaseUrl =
  'https://king-prawn-app-k2urh.ondigitalocean.app/worksheet-grading-backend/api';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

export const API_BASE_URL = trimTrailingSlash(
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || fallbackApiBaseUrl,
);

export const isSupportedTeacherRole = (role?: string | null): boolean =>
  role === 'TEACHER' || role === 'ADMIN' || role === 'SUPERADMIN';
