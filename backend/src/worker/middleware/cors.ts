import { cors } from 'hono/cors';
import type { MiddlewareHandler } from 'hono';
import type { AppBindings } from '../types';

const DEFAULT_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://us.i.posthog.com',
  'https://app.posthog.com',
  'https://eu.i.posthog.com',
  'https://us.posthog.com',
];

function parseOriginList(value: string | undefined): string[] | '*' | undefined {
  if (!value) return undefined;
  if (value.trim() === '*') return '*';
  const parts = value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length > 0 ? parts : undefined;
}

/**
 * CORS middleware that mirrors the existing Express behavior:
 *   - `CORS_ORIGINS=*`               → reflect the request origin (credentials:true)
 *   - `CORS_ORIGINS=a.com,b.com`     → allowlist
 *   - `CORS_ORIGINS` unset           → the default dev + PostHog allowlist
 *
 * All methods allowed. Common headers (Content-Type, Authorization, etc.) plus
 * the internal worker-token headers are allowed. Credentials enabled to match
 * the existing Express `credentials: true`.
 */
export function corsMiddleware(): MiddlewareHandler<AppBindings> {
  return async (c, next) => {
    const configured = parseOriginList(c.env?.CORS_ORIGINS);
    const allowlist: string[] | '*' =
      configured === undefined ? DEFAULT_ORIGINS : configured;

    const handler = cors({
      origin: allowlist === '*' ? (origin) => origin ?? '*' : allowlist,
      credentials: true,
      allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
      allowHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-PostHog-Token',
        'X-Grading-Worker-Token',
        'X-Worksheet-Creation-Token',
        'Accept',
        'Accept-Language',
        'Content-Language',
      ],
    });

    return handler(c, next);
  };
}
