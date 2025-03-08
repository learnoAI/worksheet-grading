import { RequestHandler } from 'express';
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

// Type assertion helper for controller functions
export const asHandler = (controller: any): RequestHandler => {
    return controller as unknown as RequestHandler;
}; 