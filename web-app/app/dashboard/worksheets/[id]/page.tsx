'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { worksheetAPI } from '@/lib/api';
import { Worksheet, WorksheetImage } from '@/lib/api';

export default function WorksheetDetailPage({ params }: { params: { id: string } }) {
    const { user } = useAuth();
    const router = useRouter();
    const [worksheet, setWorksheet] = useState<Worksheet | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);

    useEffect(() => {
        const fetchWorksheet = async () => {
            setIsLoading(true);
            try {
                const data = await worksheetAPI.getWorksheetById(params.id);
                setWorksheet(data);

                // Sort images by page number if they exist
                if (data.images && data.images.length > 0) {
                    data.images.sort((a, b) => a.pageNumber - b.pageNumber);
                }
            } catch (error) {
                console.error('Error fetching worksheet:', error);
            } finally {
                setIsLoading(false);
            }
        };

        if (user) {
            fetchWorksheet();
        }
    }, [user, params.id]);

    const handlePreviousImage = () => {
        if (worksheet?.images && currentImageIndex > 0) {
            setCurrentImageIndex(currentImageIndex - 1);
        }
    };

    const handleNextImage = () => {
        if (worksheet?.images && currentImageIndex < worksheet.images.length - 1) {
            setCurrentImageIndex(currentImageIndex + 1);
        }
    };

    if (isLoading) {
        return <div>Loading worksheet...</div>;
    }

    if (!worksheet) {
        return <div>Worksheet not found</div>;
    }

    const currentImage = worksheet.images && worksheet.images.length > 0
        ? worksheet.images[currentImageIndex]
        : null;

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Worksheet Details</h1>
                <Button variant="outline" onClick={() => router.push('/dashboard/worksheets')}>
                    Back to Worksheets
                </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                {/* Worksheet Info */}
                <Card className="md:col-span-1">
                    <CardHeader>
                        <CardTitle>Information</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div>
                            <h3 className="font-medium">Class</h3>
                            <p>{worksheet.class?.name || 'Unknown'}</p>
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
                                <p>{worksheet.grade}/10</p>
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

                {/* Worksheet Image */}
                <Card className="md:col-span-2">
                    <CardHeader>
                        <CardTitle>
                            {currentImage ? `Page ${currentImage.pageNumber}` : 'No Images'}
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        {currentImage ? (
                            <div className="space-y-4">
                                <div className="relative">
                                    <img
                                        src={currentImage.imageUrl}
                                        alt={`Page ${currentImage.pageNumber}`}
                                        className="w-full h-auto rounded-lg shadow-sm"
                                    />
                                </div>
                                <div className="flex justify-between items-center">
                                    <Button
                                        variant="outline"
                                        onClick={handlePreviousImage}
                                        disabled={currentImageIndex === 0}
                                    >
                                        Previous
                                    </Button>
                                    <span>
                                        Page {currentImageIndex + 1} of {worksheet.images?.length || 0}
                                    </span>
                                    <Button
                                        variant="outline"
                                        onClick={handleNextImage}
                                        disabled={!worksheet.images || currentImageIndex === worksheet.images.length - 1}
                                    >
                                        Next
                                    </Button>
                                </div>
                            </div>
                        ) : (
                            <div className="text-center py-12 text-gray-500">
                                No images available for this worksheet
                            </div>
                        )}
                    </CardContent>
                </Card>
            </div>
        </div>
    );
} 