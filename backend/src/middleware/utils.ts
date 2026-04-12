import { NextFunction, Request, RequestHandler, Response } from 'express';
import { UserRole } from '@prisma/client';
import { authenticate, authorize } from './auth';

/**
 * Helper function to fix TypeScript type compatibility with Express middleware.
 * This allows us to use these middleware functions in Express routes without type errors.
 */

// Type assertion helper for authentication middleware
export const auth = authenticate as unknown as RequestHandler;

// Type assertion helper for authorization middleware
export const authorizeRoles = (roles: UserRole[]): RequestHandler => {
    return authorize(roles) as unknown as RequestHandler;
};

// Wraps an async controller so that any unhandled throw or rejected promise is
// forwarded to Express's global error handler via next(err). Without this,
// Express v4 silently swallows async errors and they become unhandled promise
// rejections — invisible to PostHog, invisible to alerting.
//
// The global error handler (index.ts) already calls capturePosthogException,
// so every controller wrapped by asHandler now gets automatic error tracking
// for free — no per-controller PostHog wiring needed.
export const asHandler = (
    controller: (req: Request, res: Response, next: NextFunction) => Promise<unknown> | unknown
): RequestHandler => {
    return async (req: Request, res: Response, next: NextFunction) => {
        try {
            await controller(req, res, next);
        } catch (err) {
            next(err);
        }
    };
};