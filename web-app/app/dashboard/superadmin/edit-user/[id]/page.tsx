'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userAPI } from '@/lib/api/user';
import { User, UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import Link from 'next/link';

interface EditUserPageProps {
    params: {
        id: string;
    };
}

export default function EditUserPage({ params }: EditUserPageProps) {
    const { id } = params;
    const router = useRouter();
    const { user, isLoading } = useAuth();
    const [userData, setUserData] = useState<User | null>(null);
    const [username, setUsername] = useState('');
    const [selectedRole, setSelectedRole] = useState<string>('');
    const [submitting, setSubmitting] = useState(false);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('You do not have permission to access this page');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            loadUser();
        }
    }, [user, isLoading, router, id]);

    const loadUser = async () => {
        try {
            setLoading(true);
            const data = await userAPI.getUserById(id);
            setUserData(data);
            setUsername(data.username);
            setSelectedRole(data.role);
        } catch (error) {
            console.error('Error loading user:', error);
            toast.error('Failed to load user data');
            router.push('/dashboard/superadmin');
        } finally {
            setLoading(false);
        }
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!username) {
            toast.error('Username is required');
            return;
        }

        try {
            setSubmitting(true);

            await userAPI.updateUser(id, {
                username,
                role: selectedRole
            });

            toast.success('User updated successfully');
            router.push('/dashboard/superadmin');
        } catch (error) {
            console.error('Error updating user:', error);
            toast.error('Failed to update user');
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading || loading) {
        return <div className="flex justify-center items-center h-full">Loading...</div>;
    }

    if (!user || user.role !== UserRole.SUPERADMIN || !userData) {
        return null; // This shouldn't be visible due to redirect in useEffect
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Edit User</h1>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/superadmin">Back to Users</Link>
                </Button>
            </div>

            <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle>Edit User Details</CardTitle>
                        <CardDescription>Update user information</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="username">Username</Label>
                            <Input
                                id="username"
                                value={username}
                                onChange={(e) => setUsername(e.target.value)}
                                placeholder="Enter username"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="role">User Role</Label>
                            <select
                                id="role"
                                value={selectedRole}
                                onChange={(e) => setSelectedRole(e.target.value)}
                                className="w-full p-2 border rounded"
                            >
                                <option value={UserRole.TEACHER}>Teacher</option>
                                <option value={UserRole.STUDENT}>Student</option>
                                <option value={UserRole.ADMIN}>Admin</option>
                                <option value={UserRole.SUPERADMIN}>Superadmin</option>
                            </select>
                        </div>
                    </CardContent>
                    <CardFooter className="flex justify-between">
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Updating...' : 'Update User'}
                        </Button>
                        <Button
                            type="button"
                            variant="outline"
                            asChild
                        >
                            <Link href={`/dashboard/superadmin/reset-password/${id}`}>
                                Reset Password
                            </Link>
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
} 