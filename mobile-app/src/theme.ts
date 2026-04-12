export const colors = {
  // Primary — warm indigo
  primary: '#6366F1',
  primaryLight: '#EEF2FF',
  primaryDark: '#4F46E5',

  // Accent — soft coral
  accent: '#F97066',
  accentLight: '#FEF2F2',

  // Semantic
  amber: '#E8A317',
  amberLight: '#FEF9C3',
  green: '#22C55E',
  greenLight: '#DCFCE7',
  blue: '#818CF8',
  blueLight: '#E0E7FF',
  red: '#EF4444',
  redLight: '#FEF2F2',
  orange: '#F59E0B',
  orangeLight: '#FEF3C7',

  // Neutrals — warm grays
  white: '#FFFFFF',
  gray50: '#FAFAF9',
  gray100: '#F5F5F4',
  gray200: '#E7E5E4',
  gray300: '#D6D3D1',
  gray400: '#A8A29E',
  gray500: '#78716C',
  gray600: '#57534E',
  gray700: '#44403C',
  gray800: '#292524',
  gray900: '#1C1917',
  black: '#000000',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
} as const;

export const fontSize = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 17,
  xl: 20,
  xxl: 24,
  title: 28,
} as const;

export const borderRadius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;
