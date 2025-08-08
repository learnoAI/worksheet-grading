'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { worksheetAPI } from '@/lib/api';
import { Worksheet } from '@/lib/api';

export default function WorksheetDetailPage({ params }: { params: { id?: string } }) {
    const { user } = useAuth();
    const router = useRouter();
    const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        console.debug('[WorksheetDetail] Received params:', params);
    }, [params]);

    useEffect(() => {
        const fetchWorksheet = async () => {
            if (!params?.id) return;
            setIsLoading(true);
            setError(null);
            try {
                const data = await worksheetAPI.getWorksheetById(params.id);
                setWorksheet(data);
            } catch (err: any) {
                console.error('Error fetching worksheet:', err);
                setError(err?.message || 'Failed to load worksheet');
            } finally {
                setIsLoading(false);
            }
        };

        fetchWorksheet();
    }, [params?.id]);

    if (!params?.id) {
        return <div className="text-sm text-red-600">Invalid or missing worksheet id in route. Ensure you navigated to /dashboard/teacher/worksheets/&lt;id&gt;.</div>;
    }

    if (isLoading) {
        return <div>Loading worksheet details...</div>;
    }

    if (error) {
        return <div className="text-sm text-red-600">{error}</div>;
    }

    if (!worksheet) {
        return <div>Worksheet not found</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Worksheet Details</h1>
                <Button
                    variant="outline"
                    onClick={() => {
                        const basePath = user?.role === 'TEACHER' ? '/dashboard/teacher' : '/dashboard/superadmin';
                        router.push(`${basePath}/worksheets`);
                    }}
                >
                    Back to Worksheets
                </Button>
            </div>

            {/* Worksheet Info */}
            <Card>
                <CardHeader>
                    <CardTitle>Worksheet Information</CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div>
                        <h3 className="font-medium">Class</h3>
                        <p>{worksheet.class?.name || 'Unknown Class'}</p>
                    </div>
                    <div>
                        <h3 className="font-medium">Status</h3>
                        <span
                            className={`px-2 py-1 text-xs rounded-full ${worksheet.status === 'COMPLETED'
                                ? 'bg-green-100 text-green-800'
                                : worksheet.status === 'PENDING'
                                    ? 'bg-yellow-100 text-yellow-800'
                                    : worksheet.status === 'PROCESSING'
                                        ? 'bg-blue-100 text-blue-800'
                                        : 'bg-red-100 text-red-800'
                                }`}
                        >
                            {worksheet.status}
                        </span>
                    </div>
                    {worksheet.grade && (
                        <div>
                            <h3 className="font-medium">Grade</h3>
                            <p>{worksheet.grade}</p>
                        </div>
                    )}
                    <div>
                        <h3 className="font-medium">Submitted By</h3>
                        <p>{worksheet.submittedBy?.username || 'Unknown'}</p>
                    </div>
                    <div>
                        <h3 className="font-medium">Date</h3>
                        <p>{new Date(worksheet.createdAt).toLocaleDateString()}</p>
                    </div>
                    {worksheet.notes && (
                        <div>
                            <h3 className="font-medium">Notes</h3>
                            <p>{worksheet.notes}</p>
                        </div>
                    )}
                    <div>
                        <h3 className="font-medium">Pages</h3>
                        <p>{worksheet.images?.length || 0}</p>
                    </div>
                </CardContent>
            </Card>

            {/* Worksheet Images */}
            {worksheet.images && worksheet.images.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>Worksheet Images</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {worksheet.images.map((image, index) => (
                                <div key={image.id} className="relative">
                                    <img
                                        src={image.imageUrl}
                                        alt={`Page ${index + 1}`}
                                        className="w-full h-auto rounded-lg shadow-sm"
                                    />
                                    <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
                                        Page {index + 1}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
} 