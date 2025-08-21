'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userAPI } from '@/lib/api/user';
import { User, UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { Skeleton, SkeletonStyles } from '@/components/ui/skeleton';
import Link from 'next/link';

export default function SuperAdminPage() {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('Access denied');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
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

    const skeletonContent = useMemo(() => (
        <div className="space-y-6">
            <SkeletonStyles />
            <Skeleton className="h-8 w-64" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {[0,1].map(i => (
                    <div key={i} className="border rounded-lg p-6 space-y-4">
                        <Skeleton className="h-5 w-40" />
                        <Skeleton className="h-4 w-72" />
                        <Skeleton className="h-4 w-full" />
                        <div className="flex gap-3 pt-2">
                            <Skeleton className="h-9 w-full" />
                            <Skeleton className="h-9 w-full hidden md:block" />
                        </div>
                    </div>
                ))}
            </div>
            <div className="border rounded-lg overflow-hidden">
                <div className="border-b p-6 space-y-2">
                    <Skeleton className="h-5 w-32" />
                    <Skeleton className="h-4 w-64" />
                </div>
                <div className="p-4">
                    <div className="space-y-3">
                        {[...Array(6)].map((_, idx) => (
                            <div key={idx} className="grid grid-cols-4 gap-4 items-center">
                                <Skeleton className="h-4 w-32" />
                                <Skeleton className="h-4 w-20" />
                                <Skeleton className="h-4 w-24" />
                                <div className="flex gap-2">
                                    <Skeleton className="h-8 w-16" />
                                    <Skeleton className="h-8 w-28" />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    ), []);

    if (isLoading || loading) {
        return skeletonContent;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null;
    }

    return (
        <div className="space-y-6">
            <h1 className="text-2xl font-bold">Admin Dashboard</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 items-stretch">
                <Card className="h-full flex flex-col">
                    <CardHeader>
                        <CardTitle>User Management</CardTitle>
                        <CardDescription>Create and manage users in the system</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col space-y-4">
                        <p>Manage all users including teachers, students, and administrators.</p>
                        <div className="mt-auto">
                            <Button className="w-full" asChild>
                                <Link href="/dashboard/superadmin/create-user">Create New User</Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>

                <Card className="h-full flex flex-col">
                    <CardHeader>
                        <CardTitle>Worksheet Templates</CardTitle>
                        <CardDescription>Manage worksheet templates in the system</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col space-y-4">
                        <p>Create and edit worksheet templates, questions, and associated math skills.</p>
                        <div className="mt-auto flex gap-2">
                            <Button className="flex-1" asChild>
                                <Link href="/dashboard/superadmin/templates">Manage Templates</Link>
                            </Button>
                            {/* <Button className="flex-1" variant="outline" asChild>
                                <Link href="/dashboard/superadmin/templates/skills">Math Skills</Link>
                            </Button> */}
                        </div>
                    </CardContent>
                </Card>

                <Card className="h-full flex flex-col">
                    <CardHeader>
                        <CardTitle>Incorrect AI Grading</CardTitle>
                        <CardDescription>Review worksheets flagged as incorrectly graded by AI</CardDescription>
                    </CardHeader>
                    <CardContent className="flex-1 flex flex-col space-y-4">
                        <p>View and manage worksheets that teachers have marked as having incorrect AI grades.</p>
                        <div className="mt-auto">
                            <Button className="w-full" asChild>
                                <Link href="/dashboard/superadmin/incorrect-grading">Review Incorrect Grades</Link>
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>

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