import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import bcrypt from 'bcryptjs';
import { authenticate } from '../middleware/auth';
import { validateJson } from '../validation';
import { loginSchema } from '../schemas/auth';
import type { AppBindings } from '../types';

/**
 * Auth routes — mirrors behavior of the existing Express `authRoutes` so the
 * frontend/mobile clients do not need to change when we swap backends.
 *
 * Routes (mounted under `/api/auth`):
 *   POST /login — username+password, returns `{ user, token }`
 *   GET  /me    — returns the authenticated user profile
 */
const auth = new Hono<AppBindings>();

auth.post('/login', validateJson(loginSchema), async (c) => {
  const { username, password } = c.req.valid('json');

  const prisma = c.get('prisma');
  if (!prisma) {
    return c.json({ message: 'Database is not available' }, 500);
  }

  const secret = c.env?.JWT_SECRET;
  if (!secret) {
    return c.json({ message: 'JWT_SECRET is not configured' }, 500);
  }

  try {
    const user = await prisma.user.findUnique({ where: { username } });
    if (!user) {
      return c.json({ message: 'User not found' }, 404);
    }

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) {
      return c.json({ message: 'Invalid credentials' }, 401);
    }

    // 24h expiry to match existing Express behavior
    const expiresIn = Math.floor(Date.now() / 1000) + 60 * 60 * 24;
    const token = await sign(
      { userId: user.id, role: user.role, exp: expiresIn },
      secret,
      'HS256'
    );

    return c.json(
      {
        user: { id: user.id, username: user.username, role: user.role },
        token,
      },
      200
    );
  } catch (error) {
    console.error('Login error:', error);
    const name = (error as { name?: string } | null)?.name;
    if (name === 'PrismaClientInitializationError') {
      return c.json(
        {
          message:
            'Database connection error. Please ensure the database server is running and the connection string is correct.',
        },
        500
      );
    }
    return c.json({ message: 'Server error during login' }, 500);
  }
});

auth.get('/me', authenticate, async (c) => {
  const user = c.get('user');
  if (!user) {
    // `authenticate` would have returned 401 already; this keeps the type check happy.
    return c.json({ message: 'Not authenticated' }, 401);
  }

  const prisma = c.get('prisma');
  if (!prisma) {
    return c.json({ message: 'Database is not available' }, 500);
  }

  try {
    const row = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        id: true,
        username: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!row) {
      return c.json({ message: 'User not found' }, 404);
    }

    return c.json(row, 200);
  } catch (error) {
    console.error('Get current user error:', error);
    return c.json({ message: 'Server error' }, 500);
  }
});

export default auth;
