import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Define public paths that don't require authentication
const publicPaths = ['/login', '/'];

type UserRole = 'SUPERADMIN' | 'TEACHER' | 'STUDENT' | 'ADMIN';

// Define role-based path mappings
const rolePathMap: Record<UserRole, string> = {
    'SUPERADMIN': '/dashboard/superadmin',
    'TEACHER': '/dashboard/teacher',
    'STUDENT': '/dashboard/student',
    'ADMIN': '/dashboard/admin'
};

export function middleware(request: NextRequest) {
    const token = request.cookies.get('token')?.value;
    const { pathname } = request.nextUrl;

    // Allow access to public paths
    if (publicPaths.includes(pathname)) {
        // If user has token and tries to access public paths, redirect to dashboard
        if (token) {
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }
        return NextResponse.next();
    }

    // Check if user is authenticated
    if (!token) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    // For dashboard routes, ensure users can only access their role-specific paths
    if (pathname.startsWith('/dashboard')) {
        try {
            // Get user role from token
            const payload = JSON.parse(atob(token.split('.')[1]));
            const userRole = payload.role as UserRole;

            // If user is on the main dashboard page, redirect to their role-specific dashboard
            if (pathname === '/dashboard') {
                const rolePath = rolePathMap[userRole];
                if (rolePath) {
                    return NextResponse.redirect(new URL(rolePath, request.url));
                }
            }

            // Check if user is trying to access a role-specific path they shouldn't
            const roleSpecificPaths = Object.values(rolePathMap);
            for (const path of roleSpecificPaths) {
                if (pathname.startsWith(path) && !pathname.startsWith(rolePathMap[userRole])) {
                    // Redirect to their proper dashboard if they try to access another role's path
                    return NextResponse.redirect(new URL(rolePathMap[userRole], request.url));
                }
            }
        } catch (error) {
            // If there's any error parsing the token or getting the role, redirect to login
            return NextResponse.redirect(new URL('/login', request.url));
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - api (API routes)
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         */
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
} 