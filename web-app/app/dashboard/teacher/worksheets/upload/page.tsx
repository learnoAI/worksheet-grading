'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';

export default function UploadWorksheetPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [selectedFiles, setSelectedFiles] = useState<FileList | null>(null);
    const [classId, setClassId] = useState('');
    const [studentId, setStudentId] = useState('');
    const [notes, setNotes] = useState('');
    const [isUploading, setIsUploading] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedFiles || selectedFiles.length === 0) {
            toast.error('Please select at least one file to upload');
            return;
        }

        setIsUploading(true);
        try {
            // Here you would typically upload the files to your server
            // For now, we'll just simulate an upload
            await new Promise(resolve => setTimeout(resolve, 2000));

            toast.success('Worksheet uploaded successfully');
            const basePath = user?.role === 'TEACHER' ? '/dashboard/teacher' : '/dashboard/superadmin';
            router.push(`${basePath}/worksheets`);
        } catch (error) {
            console.error('Error uploading worksheet:', error);
            toast.error('Failed to upload worksheet');
        } finally {
            setIsUploading(false);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Upload Worksheet</h1>
                <Button
                    variant="outline"
                    onClick={() => {
                        const basePath = user?.role === 'TEACHER' ? '/dashboard/teacher' : '/dashboard/superadmin';
                        router.push(`${basePath}/worksheets`);
                    }}
                >
                    Cancel
                </Button>
            </div>

            <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle>Upload New Worksheet</CardTitle>
                        <CardDescription>Upload worksheet images for grading</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {/* File Upload */}
                        <div className="space-y-2">
                            <Label htmlFor="files">Worksheet Images</Label>
                            <Input
                                id="files"
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => setSelectedFiles(e.target.files)}
                                required
                            />
                            <p className="text-sm text-muted-foreground">
                                You can upload multiple images. Supported formats: PNG, JPG, JPEG
                            </p>
                        </div>

                        {/* Class Selection */}
                        <div className="space-y-2">
                            <Label htmlFor="classId">Class</Label>
                            <select
                                id="classId"
                                value={classId}
                                onChange={(e) => setClassId(e.target.value)}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                required
                            >
                                <option value="1025d255-a661-4a56-9876-7eac665c6ee1">Math 101</option>
                                <option value="ac8a86ea-6f20-4f74-bf6a-791768947829">Science 101</option>
                            </select>
                        </div>

                        {/* Student Selection (optional) */}
                        <div className="space-y-2">
                            <Label htmlFor="studentId">Student (Optional)</Label>
                            <select
                                id="studentId"
                                value={studentId}
                                onChange={(e) => setStudentId(e.target.value)}
                                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                            >
                                <option value="">Select a student</option>
                                <option value="5c2723e9-143f-4f9d-861a-5905ded96a49">Student 1</option>
                                <option value="39ff0ee0-9aea-484d-8b81-6acf500ce982">Student 2</option>
                            </select>
                        </div>

                        {/* Notes (optional) */}
                        <div className="space-y-2">
                            <Label htmlFor="notes">Notes (Optional)</Label>
                            <textarea
                                id="notes"
                                value={notes}
                                onChange={(e) => setNotes(e.target.value)}
                                className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                placeholder="Add any notes about this worksheet..."
                            />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button type="submit" disabled={isUploading}>
                            {isUploading ? 'Uploading...' : 'Upload Worksheet'}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
} 