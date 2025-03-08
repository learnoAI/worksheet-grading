'use client';

import { useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { worksheetAPI } from '@/lib/api';

export default function UploadWorksheetPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [isUploading, setIsUploading] = useState(false);
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [previewUrls, setPreviewUrls] = useState<string[]>([]);
    const [classId, setClassId] = useState('1025d255-a661-4a56-9876-7eac665c6ee1'); // Default to Math 101
    const [studentId, setStudentId] = useState('');
    const [notes, setNotes] = useState('');
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Handle file selection
    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = e.target.files;
        if (files && files.length > 0) {
            const newFiles: File[] = [];
            const newPreviews: string[] = [];

            // Convert FileList to array and process each file
            Array.from(files).forEach(file => {
                // Check if file is an image
                if (!file.type.startsWith('image/')) {
                    toast.error('Please select only image files');
                    return;
                }

                // Check file size (max 5MB)
                if (file.size > 5 * 1024 * 1024) {
                    toast.error(`File ${file.name} exceeds 5MB size limit`);
                    return;
                }

                newFiles.push(file);

                // Create preview URL
                const reader = new FileReader();
                reader.onloadend = () => {
                    newPreviews.push(reader.result as string);
                    if (newPreviews.length === newFiles.length) {
                        setPreviewUrls([...previewUrls, ...newPreviews]);
                    }
                };
                reader.readAsDataURL(file);
            });

            setSelectedFiles([...selectedFiles, ...newFiles]);
        }
    };

    // Handle form submission
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        if (selectedFiles.length === 0) {
            toast.error('Please select files to upload');
            return;
        }

        setIsUploading(true);

        try {
            const formData = new FormData();

            // Append each file with a unique field name
            selectedFiles.forEach((file, index) => {
                formData.append('images', file);
            });

            // Append other form data
            formData.append('classId', classId);
            formData.append('notes', notes || '');

            if (studentId) {
                formData.append('studentId', studentId);
            }

            const response = await worksheetAPI.uploadWorksheet(formData);

            toast.success('Worksheets uploaded successfully');
            router.push('/dashboard/worksheets');
        } catch (error) {
            console.error('Upload error:', error);
            toast.error('Failed to upload worksheets');
        } finally {
            setIsUploading(false);
        }
    };

    // Handle camera capture
    const handleCameraCapture = () => {
        if (fileInputRef.current) {
            fileInputRef.current.click();
        }
    };

    // Render preview images
    const renderPreviews = () => {
        if (previewUrls.length === 0) return null;

        return (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
                {previewUrls.map((url, index) => (
                    <div key={index} className="relative">
                        <img
                            src={url}
                            alt={`Preview ${index + 1}`}
                            className="w-full h-auto rounded-lg shadow-sm object-cover aspect-square"
                        />
                        <div className="absolute top-2 right-2 flex gap-2">
                            <Button
                                type="button"
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                    const newFiles = [...selectedFiles];
                                    const newUrls = [...previewUrls];
                                    newFiles.splice(index, 1);
                                    newUrls.splice(index, 1);
                                    setSelectedFiles(newFiles);
                                    setPreviewUrls(newUrls);
                                }}
                            >
                                Remove
                            </Button>
                        </div>
                        <div className="absolute bottom-2 left-2 bg-black/50 text-white px-2 py-1 rounded text-xs">
                            Page {index + 1}
                        </div>
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Upload Worksheets</h1>
                <Button variant="outline" onClick={() => router.push('/dashboard/worksheets')}>
                    Back to Worksheets
                </Button>
            </div>

            <Card>
                <form onSubmit={handleSubmit}>
                    <CardHeader>
                        <CardTitle>Upload new worksheets</CardTitle>
                        <CardDescription>
                            Take photos or upload images of completed worksheets
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        {/* Image Upload */}
                        <div className="space-y-2">
                            <Label htmlFor="images">Worksheet Images</Label>
                            <div className="flex flex-col items-center justify-center border-2 border-dashed border-gray-300 rounded-lg p-6 bg-gray-50">
                                {previewUrls.length > 0 ? (
                                    <>
                                        {renderPreviews()}
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => {
                                                setSelectedFiles([]);
                                                setPreviewUrls([]);
                                                if (fileInputRef.current) {
                                                    fileInputRef.current.value = '';
                                                }
                                            }}
                                        >
                                            Clear All
                                        </Button>
                                    </>
                                ) : (
                                    <div className="text-center">
                                        <svg
                                            className="mx-auto h-12 w-12 text-gray-400"
                                            fill="none"
                                            stroke="currentColor"
                                            viewBox="0 0 24 24"
                                            xmlns="http://www.w3.org/2000/svg"
                                        >
                                            <path
                                                strokeLinecap="round"
                                                strokeLinejoin="round"
                                                strokeWidth={2}
                                                d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"
                                            />
                                        </svg>
                                        <p className="mt-1 text-sm text-gray-500">
                                            Click to upload or take a photo
                                        </p>
                                        <p className="text-xs text-gray-400">
                                            PNG, JPG, GIF up to 5MB
                                        </p>
                                    </div>
                                )}
                                <input
                                    id="images"
                                    ref={fileInputRef}
                                    type="file"
                                    accept="image/*"
                                    capture="environment"
                                    className="hidden"
                                    onChange={handleFileChange}
                                    multiple
                                />
                                {previewUrls.length === 0 && (
                                    <div className="mt-4 flex space-x-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => fileInputRef.current?.click()}
                                        >
                                            Upload Files
                                        </Button>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={handleCameraCapture}
                                        >
                                            Take Photos
                                        </Button>
                                    </div>
                                )}
                            </div>
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
                                placeholder="Add any notes about these worksheets..."
                            />
                        </div>
                    </CardContent>
                    <CardFooter>
                        <Button
                            type="submit"
                            className="w-full"
                            disabled={isUploading || selectedFiles.length === 0}
                        >
                            {isUploading ? 'Uploading...' : 'Upload Worksheets'}
                        </Button>
                    </CardFooter>
                </form>
            </Card>
        </div>
    );
} 