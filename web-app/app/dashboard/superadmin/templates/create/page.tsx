'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { worksheetTemplateAPI } from '@/lib/api/worksheetTemplate';
import { UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import Link from 'next/link';
import { useEffect } from 'react';

export default function CreateTemplatePage() {
    const router = useRouter();
    const { user, isLoading } = useAuth();
    const [worksheetNumber, setWorksheetNumber] = useState<string>('');
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

        try {
            setSubmitting(true);

            const data = worksheetNumber.trim() ? { worksheetNumber: parseInt(worksheetNumber) } : {};
            const newTemplate = await worksheetTemplateAPI.createTemplate(data);

            toast.success('Worksheet template created successfully');
            router.push(`/dashboard/superadmin/templates/${newTemplate.id}`);
        } catch (error) {
            console.error('Error creating template:', error);
            toast.error('Failed to create worksheet template');
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
                <h1 className="text-2xl font-bold">Create New Worksheet Template</h1>
                <Button variant="outline" asChild>
                    <Link href="/dashboard/superadmin/templates">Back to Templates</Link>
                </Button>
            </div>

            <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle>Template Details</CardTitle>
                        <CardDescription>Create a new worksheet template</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="worksheetNumber">Worksheet Number (Optional)</Label>
                            <Input
                                id="worksheetNumber"
                                type="number"
                                min="1"
                                value={worksheetNumber}
                                onChange={(e) => setWorksheetNumber(e.target.value)}
                                placeholder="Enter worksheet number"
                            />
                            <p className="text-sm text-gray-500">
                                You can leave this blank if you don't want to assign a number yet.
                            </p>
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button type="submit" disabled={submitting}>
                            {submitting ? 'Creating...' : 'Create Template'}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
} 