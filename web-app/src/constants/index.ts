export const APP_CONFIG = {
  PAGINATION: {
    DEFAULT_PAGE_SIZE: 10,
    PAGE_SIZE_OPTIONS: [10, 20, 30, 40, 50],
  },
  SEARCH: {
    DEBOUNCE_DELAY: 300,
  },
  GRADING: {
    PROGRESSION_THRESHOLD: 32,
  },
  FILE_UPLOAD: {
    MAX_FILE_SIZE: 10 * 1024 * 1024, // 10MB
    ACCEPTED_IMAGE_TYPES: ['image/jpeg', 'image/png', 'image/webp'],
  },
  VALIDATION: {
    MIN_PASSWORD_LENGTH: 6,
    MIN_USERNAME_LENGTH: 3,
    MAX_NAME_LENGTH: 100,
    MAX_SCHOOL_NAME_LENGTH: 200,
    MAX_DESCRIPTION_LENGTH: 500,
  },
} as const;

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
  TEACHER: {
    ROOT: '/dashboard/teacher',
    WORKSHEETS: '/dashboard/teacher/worksheets',
    UPLOAD: '/dashboard/teacher/worksheets/upload',
    GRADE: '/dashboard/teacher/worksheets/grade',
  },
  SUPERADMIN: {
    ROOT: '/dashboard/superadmin',
    SCHOOLS: '/dashboard/superadmin/schools',
    CLASSES: '/dashboard/superadmin/classes',
    USERS: '/dashboard/superadmin/users',
    TEMPLATES: '/dashboard/superadmin/templates',
    SKILLS: '/dashboard/superadmin/templates/skills',
  },
} as const;

export const USER_ROLE_LABELS = {
  TEACHER: 'Teacher',
  STUDENT: 'Student',
  ADMIN: 'Admin',
  SUPERADMIN: 'Super Admin',
} as const;

export const STATUS_COLORS = {
  SUCCESS: 'text-green-600 bg-green-100',
  ERROR: 'text-red-600 bg-red-100',
  WARNING: 'text-yellow-600 bg-yellow-100',
  INFO: 'text-blue-600 bg-blue-100',
} as const;

export const GRADE_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 80,
  AVERAGE: 70,
  BELOW_AVERAGE: 60,
} as const;
