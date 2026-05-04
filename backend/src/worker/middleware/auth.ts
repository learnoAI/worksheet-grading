import type { MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';
import type { UserRole } from '@prisma/client';
import type { AppBindings } from '../types';

interface JwtPayload {
  userId: string;
  role: UserRole;
}

function isJwtPayload(value: unknown): value is JwtPayload {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return typeof v.userId === 'string' && typeof v.role === 'string';
}

/**
 * JWT authentication middleware.
 *
 * Matches the existing Express `authenticate` behavior:
 *   - Reads `Authorization: Bearer <token>` header
 *   - Verifies with `env.JWT_SECRET` using HS256 (same algorithm `jsonwebtoken`
 *     uses by default for string secrets — tokens minted by Express verify here)
 *   - On success: sets `c.var.user = { userId, role }` for downstream handlers
 *   - On failure: responds 401 (same message strings as Express version)
 */
export const authenticate: MiddlewareHandler<AppBindings> = async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice('Bearer '.length) : undefined;

  if (!token) {
    return c.json({ message: 'Authentication required' }, 401);
  }

  const secret = c.env?.JWT_SECRET;
  if (!secret) {
    return c.json({ message: 'JWT_SECRET is not configured' }, 500);
  }

  let payload: unknown;
  try {
    payload = await verify(token, secret, 'HS256');
  } catch {
    return c.json({ message: 'Invalid token' }, 401);
  }

  if (!isJwtPayload(payload)) {
    return c.json({ message: 'Invalid token' }, 401);
  }

  c.set('user', { userId: payload.userId, role: payload.role });
  await next();
};

/**
 * Role-based authorization. Must be chained after `authenticate`.
 *
 * Matches the existing Express `authorize(roles[])`:
 *   - 401 if no authenticated user on context
 *   - 403 if role is not in the allowed list
 */
export const authorize = (roles: UserRole[]): MiddlewareHandler<AppBindings> => {
  return async (c, next) => {
    const user = c.get('user');
    if (!user) {
      return c.json({ message: 'Authentication required' }, 401);
    }
    if (!roles.includes(user.role)) {
      return c.json({ message: 'Access denied' }, 403);
    }
    await next();
  };
};
