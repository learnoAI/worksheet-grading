'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userAPI } from '@/lib/api/user';
import { UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import Link from 'next/link';
import { useEffect } from 'react';

export default function CreateUserPage() {
    const router = useRouter();
    const { user, isLoading } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [selectedRole, setSelectedRole] = useState<string>(UserRole.TEACHER);
    const [submitting, setSubmitting] = useState(false);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('You do not have permission to access this page');
            router.push('/dashboard');
        }
    }, [user, isLoading, router]);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!username || !password) {
            toast.error('Username and password are required');
            return;
        }

        if (password.length < 6) {
            toast.error('Password must be at least 6 characters');
            return;
        }

        try {
            setSubmitting(true);

            await userAPI.createUser({
                username,
                password,
                role: selectedRole
            });

            toast.success(`${selectedRole} user created successfully`);
            router.push('/dashboard/superadmin');
        } catch (error) {
            console.error('Error creating user:', error);
            toast.error('Failed to create user');
        } finally {
            setSubmitting(false);
        }
    };

    if (isLoading) {
        return <div className="flex justify-center items-center h-full">Loading...</div>;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null; // This shouldn't be visible due to redirect in useEffect
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Create New User</h1>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/superadmin">Back to Users</Link>
                </Button>
            </div>

            <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle>User Details</CardTitle>
                        <CardDescription>Create a new user account</CardDescription>
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
                            <Label htmlFor="password">Password</Label>
                            <Input
                                id="password"
                                type="password"
                                value={password}
                                onChange={(e) => setPassword(e.target.value)}
                                placeholder="Enter password (min 6 characters)"
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
                    <CardFooter>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Creating...' : 'Create User'}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
} 