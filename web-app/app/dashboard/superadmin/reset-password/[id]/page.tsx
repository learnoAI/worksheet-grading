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

interface ResetPasswordPageProps {
    params: {
        id: string;
    };
}

export default function ResetPasswordPage({ params }: ResetPasswordPageProps) {
    const { id } = params;
    const router = useRouter();
    const { user, isLoading } = useAuth();
    const [userData, setUserData] = useState<User | null>(null);
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
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

        if (!newPassword || !confirmPassword) {
            toast.error('Both password fields are required');
            return;
        }

        if (newPassword.length < 6) {
            toast.error('Password must be at least 6 characters');
            return;
        }

        if (newPassword !== confirmPassword) {
            toast.error('Passwords do not match');
            return;
        }

        try {
            setSubmitting(true);

            await userAPI.resetPassword(id, newPassword);

            toast.success('Password reset successfully');
            router.push('/dashboard/superadmin');
        } catch (error) {
            console.error('Error resetting password:', error);
            toast.error('Failed to reset password');
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
                <h1 className="text-2xl font-bold">Reset Password</h1>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/superadmin">Back to Users</Link>
                </Button>
            </div>

            <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle>Reset Password for {userData.username}</CardTitle>
                        <CardDescription>Set a new password for this user</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="newPassword">New Password</Label>
                            <Input
                                id="newPassword"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                placeholder="Enter new password (min 6 characters)"
                                required
                            />
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="confirmPassword">Confirm Password</Label>
                            <Input
                                id="confirmPassword"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                placeholder="Confirm new password"
                                required
                            />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Resetting...' : 'Reset Password'}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
} 