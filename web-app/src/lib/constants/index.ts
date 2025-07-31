export const PROGRESSION_THRESHOLD = 32;
export const ITEMS_PER_PAGE = 30;
export const MAX_GRADE = 40;

export const DEBOUNCE_DELAY = 300;
export const DEFAULT_CACHE_DURATION = 180000; // 3 mins

export const ROUTES = {
  HOME: '/',
  LOGIN: '/login',
  DASHBOARD: '/dashboard',
  TEACHER: {
    DASHBOARD: '/dashboard/teacher',
    WORKSHEETS: '/dashboard/teacher/worksheets',
    UPLOAD: '/dashboard/teacher/worksheets/upload',
    GRADE: '/dashboard/teacher/worksheets/grade',
  },
  SUPERADMIN: {
    DASHBOARD: '/dashboard/superadmin',
    USERS: '/dashboard/superadmin/users',
    SCHOOLS: '/dashboard/superadmin/schools',
    CLASSES: '/dashboard/superadmin/classes',
    TEMPLATES: '/dashboard/superadmin/templates',
    SKILLS: '/dashboard/superadmin/templates/skills',
  },
} as const;

export const GRADE_OPTIONS = Array.from({ length: MAX_GRADE + 1 }, (_, i) => 
  (MAX_GRADE - i).toString()
);

export const USER_ROLES = {
  TEACHER: 'TEACHER',
  STUDENT: 'STUDENT',
  ADMIN: 'ADMIN',
  SUPERADMIN: 'SUPERADMIN',
} as const;

export const MODAL_TYPES = {
  CREATE_USER: 'CREATE_USER',
  EDIT_USER: 'EDIT_USER',
  DELETE_USER: 'DELETE_USER',
  MANAGE_STUDENTS: 'MANAGE_STUDENTS',
  MANAGE_TEACHERS: 'MANAGE_TEACHERS',
} as const;

export const PAGINATION = {
  DEFAULT_PAGE_SIZE: 10,
  PAGE_SIZE_OPTIONS: [10, 20, 50, 100],
} as const;
