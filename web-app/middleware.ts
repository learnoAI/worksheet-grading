import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { UserRole } from '@/lib/api/types';

const publicPaths = ['/login', '/'];

const rolePathMap: Record<UserRole, string> = {
    [UserRole.SUPERADMIN]: '/dashboard/superadmin',
    [UserRole.TEACHER]: '/dashboard/teacher/worksheets/upload',
    [UserRole.STUDENT]: '/dashboard/student',
    [UserRole.ADMIN]: '/dashboard/admin'
};

export function middleware(request: NextRequest) {
    const token = request.cookies.get('token')?.value;
    const { pathname } = request.nextUrl;

    if (publicPaths.includes(pathname)) {
        if (token) {
            try {
                const payload = JSON.parse(atob(token.split('.')[1]));
                const userRole = payload.role as UserRole;
                const rolePath = rolePathMap[userRole];
                if (rolePath) {
                    return NextResponse.redirect(new URL(rolePath, request.url));
                }
            } catch (error) {
                const response = NextResponse.next();
                response.cookies.delete('token');
                return response;
            }
            return NextResponse.redirect(new URL('/dashboard', request.url));
        }
        return NextResponse.next();
    }

    if (!token) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    if (pathname.startsWith('/dashboard')) {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const userRole = payload.role as UserRole;

            if (pathname === '/dashboard') {
                const rolePath = rolePathMap[userRole];
                if (rolePath) {
                    return NextResponse.redirect(new URL(rolePath, request.url));
                }
            }

            const userRolePath = rolePathMap[userRole];
            
            if (userRole === UserRole.TEACHER) {
                if (pathname === '/dashboard/teacher') {
                    return NextResponse.redirect(new URL(userRolePath, request.url));
                }
                if (pathname.startsWith('/dashboard/teacher/')) {
                    return NextResponse.next();
                }
            }
            
            if (userRolePath && !pathname.startsWith(userRolePath)) {
                const isAccessingOtherRole = Object.values(rolePathMap).some(path => 
                    path !== userRolePath && pathname.startsWith(path)
                );
                
                if (isAccessingOtherRole) {
                    return NextResponse.redirect(new URL(userRolePath, request.url));
                }
            }
        } catch (error) {
            const response = NextResponse.redirect(new URL('/login', request.url));
            response.cookies.delete('token');
            return response;
        }
    }

    return NextResponse.next();
}

export const config = {
    matcher: [
        '/((?!api|_next/static|_next/image|favicon.ico).*)',
    ],
}