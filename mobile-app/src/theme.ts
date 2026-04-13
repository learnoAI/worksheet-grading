import { Platform } from 'react-native';

export const colors = {
  // Primary — deep teal
  primary: '#0D9488',
  primaryLight: '#CCFBF1',
  primaryDark: '#115E59',

  // Accent — deep rose (destructive actions)
  accent: '#E11D48',
  accentLight: '#FFF1F2',

  // Semantic (desaturated)
  amber: '#CA8A04',
  amberLight: '#FEF9C3',
  green: '#16A34A',
  greenLight: '#DCFCE7',
  blue: '#2563EB',
  blueLight: '#DBEAFE',
  red: '#DC2626',
  redLight: '#FEE2E2',
  orange: '#EA580C',
  orangeLight: '#FFEDD5',

  // Neutrals — cool slate
  white: '#FFFFFF',
  gray50: '#F8FAFC',
  gray100: '#F1F5F9',
  gray200: '#E2E8F0',
  gray300: '#CBD5E1',
  gray400: '#94A3B8',
  gray500: '#64748B',
  gray600: '#475569',
  gray700: '#334155',
  gray800: '#1E293B',
  gray900: '#0F172A',
  black: '#020617',

  // Special
  loginBg: '#F0FDFA',
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
  caption: 10,
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
  xxl: 20,
  full: 9999,
} as const;

/** Subtle card shadow — tinted to slate, barely there */
export const cardShadow = Platform.select({
  ios: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
  },
  android: {
    elevation: 1,
  },
}) as object;

/** Even lighter shadow for small elements */
export const softShadow = Platform.select({
  ios: {
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.03,
    shadowRadius: 2,
  },
  android: {
    elevation: 1,
  },
}) as object;

/** Ripple config for Android Pressable buttons */
export const androidRipple = { color: 'rgba(0,0,0,0.06)' };
