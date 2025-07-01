'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userAPI } from '@/lib/api/user';
import { User, UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import Link from 'next/link';

export default function SuperAdminPage() {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('Access denied');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            // Load all users
            loadUsers();
        }
    }, [user, isLoading, router]);

    const loadUsers = async () => {
        try {
            setLoading(true);
            const data = await userAPI.getUsers();
            setUsers(data);
        } catch (error) {
            console.error('Error loading users:', error);
            toast.error('Failed to load users');
        } finally {
            setLoading(false);
        }
    };

    if (isLoading || loading) {
        return <div className="flex justify-center items-center h-full">Loading...</div>;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null; // This shouldn't be visible due to redirect in useEffect
    }

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>

            {/* Admin Sections */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* User Management Section */}
                <Card>
                    <CardHeader>
                        <CardTitle>User Management</CardTitle>
                        <CardDescription>Create and manage users in the system</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col space-y-4">
                        <p>Manage all users including teachers, students, and administrators.</p>
                        <div className="mt-2">
                            <Button className="w-full" asChild>
                                <Link href="/dashboard/superadmin/create-user">Create New User</Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                {/* Worksheet Templates Section */}
                <Card>
                    <CardHeader>
                        <CardTitle>Worksheet Templates</CardTitle>
                        <CardDescription>Manage worksheet templates in the system</CardDescription>
                    </CardHeader>
                    <CardContent className="flex flex-col space-y-4">
                        <p>Create and edit worksheet templates, questions, and associated math skills.</p>
                        <div className="mt-2 flex gap-2">
                            <Button className="flex-1" asChild>
                                <Link href="/dashboard/superadmin/templates">Manage Templates</Link>
                            </Button>
                            <Button className="flex-1" variant="outline" asChild>
                                <Link href="/dashboard/superadmin/templates/skills">Math Skills</Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

            {/* User List */}
            <Card>
                <CardHeader>
                    <CardTitle>All Users</CardTitle>
                    <CardDescription>Manage all users in the system</CardDescription>
                </CardHeader>
                <CardContent>
                    {users.length === 0 ? (
                        <p>No users found.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b">
                                        <th className="py-2 px-4 text-left">Username</th>
                                        <th className="py-2 px-4 text-left">Role</th>
                                        <th className="py-2 px-4 text-left">Created At</th>
                                        <th className="py-2 px-4 text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {users.map((u) => (
                                        <tr key={u.id} className="border-b hover:bg-gray-50">
                                            <td className="py-2 px-4">{u.username}</td>
                                            <td className="py-2 px-4">{u.role}</td>
                                            <td className="py-2 px-4">{new Date(u.createdAt).toLocaleDateString()}</td>
                                            <td className="py-2 px-4">
                                                <div className="flex space-x-2">
                                                    <Button size="sm" variant="outline" asChild>
                                                        <Link href={`/dashboard/superadmin/edit-user/${u.id}`}>Edit</Link>
                                                    </Button>
                                                    <Button size="sm" variant="outline" asChild>
                                                        <Link href={`/dashboard/superadmin/reset-password/${u.id}`}>Reset Password</Link>
                                                    </Button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
} 