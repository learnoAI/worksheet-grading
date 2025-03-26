'use client';

import { useAuth } from '@/lib/auth-context';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { notificationAPI } from '@/lib/api';

export default function SuperAdminLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const { user, isLoading, logout } = useAuth();
    const router = useRouter();
    const [unreadCount, setUnreadCount] = useState(0);

    // Redirect if not authenticated or not a superadmin
    useEffect(() => {
        if (!isLoading && (!user || user.role !== 'SUPERADMIN')) {
            router.push('/login');
        }
    }, [user, isLoading, router]);

    // Fetch unread notifications count
    useEffect(() => {
        if (user) {
            const fetchNotifications = async () => {
                try {
                    const notifications = await notificationAPI.getNotifications();
                    const unread = notifications.filter(n => n.status === 'UNREAD').length;
                    setUnreadCount(unread);
                } catch (error) {
                    console.error('Error fetching notifications:', error);
                }
            };

            fetchNotifications();

            // Set up polling for notifications every 30 seconds
            const interval = setInterval(fetchNotifications, 30000);
            return () => clearInterval(interval);
        }
    }, [user]);

    // Handle logout
    const handleLogout = () => {
        logout();
        router.push('/login');
    };

    if (isLoading || !user) {
        return <div className="flex items-center justify-center min-h-screen">Loading...</div>;
    }

    return (
        <div className="min-h-screen bg-gray-100">
            {/* Header */}
            <header className="bg-white shadow">
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex justify-between items-center">
                    <h1 className="text-xl font-bold">Worksheet Grading App</h1>
                    <div className="flex items-center gap-4">
                        <div className="text-sm text-gray-600">
                            Logged in as <span className="font-medium">{user.username}</span> (Superadmin)
                        </div>
                        <Button variant="outline" onClick={handleLogout}>
                            Logout
                        </Button>
                    </div>
                </div>
            </header>

            {/* Main content */}
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
                <div className="flex flex-col md:flex-row gap-6">
                    {/* Sidebar */}
                    <aside className="w-full md:w-64 bg-white p-4 rounded-lg shadow">
                        <nav className="space-y-2">
                            <Link href="/dashboard/superadmin" className="block p-2 rounded hover:bg-gray-100">
                                Dashboard
                            </Link>

                            <Link href="/dashboard/superadmin/users" className="block p-2 rounded hover:bg-gray-100">
                                Users
                            </Link>

                            <Link href="/dashboard/superadmin/schools" className="block p-2 rounded hover:bg-gray-100">
                                Schools
                            </Link>

                            <Link href="/dashboard/superadmin/classes" className="block p-2 rounded hover:bg-gray-100">
                                Classes
                            </Link>

                            <Link href="/dashboard/superadmin/templates" className="block p-2 rounded hover:bg-gray-100">
                                Worksheet Templates
                            </Link>

                            <Link href="/dashboard/superadmin/templates/skills" className="block p-2 rounded hover:bg-gray-100">
                                Math Skills
                            </Link>

                            <Link href="/dashboard/superadmin/notifications" className="flex items-center justify-between p-2 rounded hover:bg-gray-100">
                                <span>Notifications</span>
                                {unreadCount > 0 && (
                                    <span className="bg-blue-500 text-white text-xs rounded-full px-2 py-1">
                                        {unreadCount}
                                    </span>
                                )}
                            </Link>
                        </nav>
                    </aside>

                    {/* Main content */}
                    <main className="flex-1 bg-white p-6 rounded-lg shadow">
                        {children}
                    </main>
                </div>
            </div>
        </div>
    );
} 