import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import config from '../config/env';
import { UserRole } from '@prisma/client';

interface JwtPayload {
    userId: string;
    role: UserRole;
}

// Extend Express Request interface to include user information
declare global {
    namespace Express {
        interface Request {
            user?: {
                userId: string;
                role: UserRole;
            };
        }
    }
}

// Authenticate user using JWT
export const authenticate = (req: Request, res: Response, next: NextFunction) => {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
        return res.status(401).json({ message: 'Authentication required' });
    }

    try {
        const decoded = jwt.verify(token, config.jwtSecret) as JwtPayload;
        req.user = {
            userId: decoded.userId,
            role: decoded.role
        };
        next();
    } catch (error) {
        return res.status(401).json({ message: 'Invalid token' });
    }
};

// Check if user has required role
export const authorize = (roles: UserRole[]) => {
    return (req: Request, res: Response, next: NextFunction) => {
        if (!req.user) {
            return res.status(401).json({ message: 'Authentication required' });
        }

        if (!roles.includes(req.user.role)) {
            return res.status(403).json({ message: 'Access denied' });
        }

        next();
    };
}; 