import Constants from 'expo-constants';

const fallbackApiBaseUrl =
  'https://king-prawn-app-k2urh.ondigitalocean.app/worksheet-grading-backend/api';

function trimTrailingSlash(value: string): string {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function nonEmpty(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * Resolve the API base URL in priority order:
 *
 *   1. `Constants.expoConfig.extra.apiBaseUrl` — runtime-readable config
 *      from `app.json` `extra` (or its override pushed via EAS Update).
 *      Allows post-cutover URL swap WITHOUT a new build + store push.
 *      Today this is unset, so step (2) wins — keeping behaviour identical
 *      to the previous build. When the team wires `expo-updates`, an OTA
 *      manifest can populate this and the runtime picks it up immediately.
 *
 *   2. `process.env.EXPO_PUBLIC_API_BASE_URL` — baked into the JS bundle
 *      at build time from `eas.json`'s per-channel `env` block. This is
 *      the current source of truth; flipping it requires a rebuild.
 *
 *   3. `fallbackApiBaseUrl` — hardcoded last resort if both are unset
 *      (e.g. local `expo start` with no env file).
 */
function resolveApiBaseUrl(): string {
  const fromExtra = nonEmpty(Constants.expoConfig?.extra?.apiBaseUrl);
  if (fromExtra) return fromExtra;
  const fromEnv = nonEmpty(process.env.EXPO_PUBLIC_API_BASE_URL);
  if (fromEnv) return fromEnv;
  return fallbackApiBaseUrl;
}

export const API_BASE_URL = trimTrailingSlash(resolveApiBaseUrl());

export const isSupportedTeacherRole = (role?: string | null): boolean =>
  role === 'TEACHER' || role === 'ADMIN' || role === 'SUPERADMIN';
