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
            try {
                // Get user role from token and redirect to appropriate dashboard
                const payload = JSON.parse(atob(token.split('.')[1]));
                const userRole = payload.role as UserRole;
                const rolePath = rolePathMap[userRole];
                if (rolePath) {
                    return NextResponse.redirect(new URL(rolePath, request.url));
                }
            } catch (error) {
                // If token is invalid, clear it and allow access to public paths
                const response = NextResponse.next();
                response.cookies.delete('token');
                return response;
            }
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
            const userRolePath = rolePathMap[userRole];
            if (userRolePath && !pathname.startsWith(userRolePath)) {
                // Check if they're trying to access another role's path
                const isAccessingOtherRole = Object.values(rolePathMap).some(path => 
                    path !== userRolePath && pathname.startsWith(path)
                );
                
                if (isAccessingOtherRole) {
                    // Redirect to their proper dashboard
                    return NextResponse.redirect(new URL(userRolePath, request.url));
                }
            }
        } catch (error) {
            // If there's any error parsing the token, redirect to login and clear cookie
            const response = NextResponse.redirect(new URL('/login', request.url));
            response.cookies.delete('token');
            return response;
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