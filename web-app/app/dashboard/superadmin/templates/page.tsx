'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { worksheetTemplateAPI } from '@/lib/api/worksheetTemplate';
import { WorksheetTemplate, UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import Link from 'next/link';
import { HeadingActionSkeleton, TableSkeleton, FormSkeleton, PageSectionSkeleton, FullPageSkeleton } from '@/components/superadmin/skeletons';
import { SkeletonStyles } from '@/components/ui/skeleton';

export default function TemplatesPage() {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    const [templates, setTemplates] = useState<WorksheetTemplate[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        // Redirect if not logged in or not a superadmin
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('You do not have permission to access this page');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            // Load all templates
            loadTemplates();
        }
    }, [user, isLoading, router]);

    const loadTemplates = async () => {
        try {
            setLoading(true);
            const data = await worksheetTemplateAPI.getAllTemplates();
            setTemplates(data);
        } catch (error) {
            console.error('Error loading templates:', error);
            toast.error('Failed to load worksheet templates');
        } finally {
            setLoading(false);
        }
    };

    const handleDeleteTemplate = async (id: string) => {
        if (confirm('Are you sure you want to delete this template? This action cannot be undone.')) {
            try {
                await worksheetTemplateAPI.deleteTemplate(id);
                toast.success('Worksheet template deleted successfully');
                // Reload templates
                loadTemplates();
            } catch (error) {
                console.error('Error deleting template:', error);
                toast.error('Failed to delete worksheet template');
            }
        }
    };

    const skeleton = useMemo(() => (
        <div className="space-y-6">
            <SkeletonStyles />
            <HeadingActionSkeleton />
            <TableSkeleton rows={6} columns={5} />
        </div>
    ), []);

    if (isLoading || loading) {
        return skeleton;
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null; // This shouldn't be visible due to redirect in useEffect
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Worksheet Templates</h1>
                <Button asChild>
                    <Link href="/dashboard/superadmin/templates/create">Create New Template</Link>
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>All Templates</CardTitle>
                    <CardDescription>Manage worksheet templates for the system</CardDescription>
                </CardHeader>
                <CardContent>
                    {templates.length === 0 ? (
                        <p>No worksheet templates found. Create your first template to get started.</p>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full border-collapse">
                                <thead>
                                    <tr className="border-b">
                                        <th className="py-2 px-4 text-left">Worksheet #</th>
                                        <th className="py-2 px-4 text-left">Questions</th>
                                        <th className="py-2 px-4 text-left">Images</th>
                                        <th className="py-2 px-4 text-left">Created At</th>
                                        <th className="py-2 px-4 text-left">Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {templates.map((template) => (
                                        <tr key={template.id} className="border-b hover:bg-gray-50">
                                            <td className="py-2 px-4">{template.worksheetNumber || 'N/A'}</td>
                                            <td className="py-2 px-4">{template.questions?.length || 0}</td>
                                            <td className="py-2 px-4">{template.worksheetImages?.length || 0}</td>
                                            <td className="py-2 px-4">{new Date(template.createdAt).toLocaleDateString()}</td>
                                            <td className="py-2 px-4">
                                                <div className="flex space-x-2">
                                                    <Button size="sm" variant="outline" asChild>
                                                        <Link href={`/dashboard/superadmin/templates/${template.id}`}>
                                                            Edit
                                                        </Link>
                                                    </Button>
                                                    <Button
                                                        size="sm"
                                                        variant="default"
                                                        onClick={() => handleDeleteTemplate(template.id)}
                                                    >
                                                        Delete
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