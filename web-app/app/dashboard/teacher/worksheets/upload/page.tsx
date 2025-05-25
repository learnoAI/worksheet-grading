'use client';

import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { classAPI, worksheetAPI } from '@/lib/api';
import { UploadIcon } from 'lucide-react';
import { StudentWorksheetCard } from './student-worksheet-card';

interface Class {
    id: string;
    name: string;
}

interface Student {
    id: string;
    username: string;
    name: string;
    tokenNumber: string;
}

interface StudentWorksheet {
    studentId: string;
    name: string;
    tokenNumber: string;
    worksheetNumber: number;
    isAbsent: boolean;
    files: FileList | null;
    grade: string;
    isUploading: boolean;
}

export default function UploadWorksheetPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [classes, setClasses] = useState<Class[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [students, setStudents] = useState<Student[]>([]);
    const [submittedOn, setSubmittedOn] = useState<string>(new Date().toISOString().split('T')[0]);
    const [studentWorksheets, setStudentWorksheets] = useState<StudentWorksheet[]>([]);
    const fileInputRefs = useRef<{[key: string]: HTMLInputElement | null}>({});

    // Fetch classes for the current teacher
    useEffect(() => {
        const fetchInitialData = async () => {
            if (!user?.id) return;

            try {
                const classesData = await classAPI.getTeacherClasses(user.id);
                setClasses(classesData);
            } catch (error) {
                console.error('Error fetching initial data:', error);
                toast.error('Failed to load initial data');
            } finally {
                setIsLoading(false);
            }
        };

        fetchInitialData();
    }, [user?.id]);

    // Fetch students for the selected class
    useEffect(() => {
        const fetchStudents = async () => {
            if (!selectedClass) {
                setStudents([]);
                setStudentWorksheets([]);
                return;
            }

            try {
                const studentsData = await classAPI.getClassStudents(selectedClass);
                setStudents(studentsData);
                setStudentWorksheets(studentsData.map(student => ({
                    studentId: student.id,
                    name: student.name,
                    tokenNumber: student.tokenNumber,
                    worksheetNumber: 0,
                    isAbsent: false,  // Default to NOT absent
                    files: null,
                    grade: '',
                    isUploading: false
                })));
            } catch (error) {
                console.error('Error fetching students:', error);
                toast.error('Failed to load students');
            }
        };

        fetchStudents();
    }, [selectedClass]);

    const handleFileChange = (studentId: string, files: FileList | null) => {
        setStudentWorksheets(prev => prev.map(sw => 
            sw.studentId === studentId ? { ...sw, files } : sw
        ));
    };

    const handleUpdateWorksheet = (index: number, field: string, value: any) => {
        const newWorksheets = [...studentWorksheets];
        
        // If marking as absent, clear other fields
        if (field === "isAbsent" && value === true) {
            newWorksheets[index] = {
                ...newWorksheets[index],
                isAbsent: true,
                worksheetNumber: 0,  // Clear worksheet number
                grade: '',           // Clear grade
                files: null          // Clear files
            };
        } else {
            (newWorksheets[index] as any)[field] = value;
            
            // If setting worksheet number or uploading files, ensure student isn't marked as absent
            if ((field === "worksheetNumber" && value > 0) || field === "files") {
                newWorksheets[index].isAbsent = false;
            }
        }
        
        setStudentWorksheets(newWorksheets);
    };

    const handleUpload = async (worksheet: StudentWorksheet) => {
        if (worksheet.isAbsent) {
            return;
        }

        if (!worksheet.worksheetNumber) {
            toast.error('Please enter a worksheet number');
            return;
        }

        if (!worksheet.files || worksheet.files.length === 0) {
            toast.error('Please select at least one image file');
            return;
        }

        // Update status to uploading
        setStudentWorksheets(prev => prev.map(sw => 
            sw.studentId === worksheet.studentId ? { ...sw, isUploading: true } : sw
        ));        try {
            // Prepare form data for API call to our backend proxy
            const formData = new FormData();
            
            // Add metadata fields needed for our backend database
            formData.append('classId', selectedClass);
            formData.append('studentId', worksheet.studentId);
            formData.append('worksheetNumber', worksheet.worksheetNumber.toString());
            formData.append('submittedOn', submittedOn);
            
            // Add token_no and worksheet_name for Python API
            formData.append('token_no', worksheet.tokenNumber);
            formData.append('worksheet_name', worksheet.worksheetNumber.toString());
            
            // Append all files
            for (let i = 0; i < worksheet.files.length; i++) {
                formData.append('files', worksheet.files[i]);
            }

            // Call our backend API endpoint which proxies to the Python API
            const API_URL = process.env.NEXT_PUBLIC_API_URL;
            const response = await fetch(`${API_URL}/worksheet-processing/process`, {
                method: 'POST',
                body: formData,
                headers: {
                    // No content-type header needed, it's set automatically with FormData
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to process worksheet');
            }

            const result = await response.json();
            
            if (!result.success) {
                throw new Error(result.error || 'Error processing worksheet');
            }
            
            // Update the grade from the API response
            const grade = result.grade || result.totalScore || 0;
            setStudentWorksheets(prev => prev.map(sw => 
                sw.studentId === worksheet.studentId 
                    ? { ...sw, grade: grade.toString(), isUploading: false } 
                    : sw
            ));
            
            toast.success(`Worksheet for ${worksheet.name} processed successfully! Grade: ${grade}/10`);
            
            // Clear file input
            if (fileInputRefs.current[worksheet.studentId]) {
                fileInputRefs.current[worksheet.studentId]!.value = '';
            }
            
            // Return success for batch processing
            return { success: true };
        } catch (error) {
            console.error('Error uploading worksheet:', error);
            toast.error('Failed to upload or grade worksheet');
            
            // Reset uploading status
            setStudentWorksheets(prev => prev.map(sw => 
                sw.studentId === worksheet.studentId ? { ...sw, isUploading: false } : sw
            ));
            // Return failure for batch processing
            return { success: false };
        }
    };

    // Process all non-absent students' worksheets in parallel
    const handleBatchProcess = async () => {
        const studentsWithFiles = studentWorksheets.filter(sw => 
            !sw.isAbsent && sw.files && sw.files.length > 0 && sw.worksheetNumber
        );
        
        if (studentsWithFiles.length === 0) {
            toast.error('No worksheets to process. Please upload files and assign worksheet numbers.');
            return;
        }
        
        // Set all selected students to uploading state
        setStudentWorksheets(prev => prev.map(sw => 
            studentsWithFiles.some(s => s.studentId === sw.studentId) 
                ? { ...sw, isUploading: true } 
                : sw
        ));
        
        try {
            // Process all worksheets in parallel with a concurrency limit
            const batchSize = 3; // Process 3 worksheets at a time to avoid overwhelming the server
            let successful = 0;
            let failed = 0;
            
            // Process worksheets in batches to control concurrency
            for (let i = 0; i < studentsWithFiles.length; i += batchSize) {
                const currentBatch = studentsWithFiles.slice(i, i + batchSize);
                
                const batchResults = await Promise.allSettled(
                    currentBatch.map(worksheet => handleUpload(worksheet))
                );
                
                // Count successes and failures for this batch
                successful += batchResults.filter(r => 
                    r.status === 'fulfilled' && r.value && r.value.success
                ).length;
                
                failed += batchResults.filter(r => 
                    r.status === 'rejected' || (r.status === 'fulfilled' && (!r.value || !r.value.success))
                ).length;
                
                // Small delay between batches to prevent rate limiting
                if (i + batchSize < studentsWithFiles.length) {
                    await new Promise(resolve => setTimeout(resolve, 500));
                }
            }
            
            if (successful > 0) {
                toast.success(`Successfully processed ${successful} worksheet${successful !== 1 ? 's' : ''}`);
            }
            
            if (failed > 0) {
                toast.error(`Failed to process ${failed} worksheet${failed !== 1 ? 's' : ''}`);
            }
        } catch (error) {
            console.error('Error in batch processing:', error);
            toast.error('Failed to process worksheets');
        }
    };

    // Save all student worksheets including absent students
    const handleSaveAllChanges = async () => {
        setIsSaving(true);
        
        try {
            const incompleteEntries = studentWorksheets.filter(
                worksheet => !worksheet.isAbsent && 
                (!worksheet.worksheetNumber || worksheet.worksheetNumber <= 0)
            );
            
            if (incompleteEntries.length > 0) {
                toast.error(`Please fill in worksheet numbers for all non-absent students. ${incompleteEntries.length} student(s) are incomplete.`);
                setIsSaving(false);
                return;
            }
            
            // Save all changes - both absent students and those with uploaded grades
            await Promise.all(studentWorksheets.map(async (worksheet) => {
                if (worksheet.isAbsent) {
                    // Always update the absent status, even if the student already had a grade
                    const data = {
                        classId: selectedClass,
                        studentId: worksheet.studentId,
                        worksheetNumber: 0,
                        grade: 0, // Grade is 0 for absent students
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: true,
                        notes: 'Student absent'
                    };
                    
                    // Check if a record already exists to decide between create and update
                    // This logic might need refinement based on how existing records are identified
                    // For simplicity, assuming grade presence indicates an existing record for now.
                    // A more robust check would involve fetching existing worksheet by studentId and date.
                    const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(selectedClass, worksheet.studentId, submittedOn);

                    if (existingWorksheet && existingWorksheet.id) {
                        await worksheetAPI.updateGradedWorksheet(existingWorksheet.id, data);
                    } else {
                        await worksheetAPI.createGradedWorksheet(data);
                    }

                }
                // For students with grades but no files (manually entered grades or previously uploaded)
                // This part handles saving changes for students who are NOT absent
                // and might have had their grade manually entered or worksheet previously uploaded and graded.
                else if (worksheet.grade && !worksheet.files) { // Or some other condition to identify these cases
                    const data = {
                        classId: selectedClass,
                        studentId: worksheet.studentId,
                        worksheetNumber: worksheet.worksheetNumber,
                        grade: parseFloat(worksheet.grade),
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: false
                    };
                     const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(selectedClass, worksheet.studentId, submittedOn);
                    if (existingWorksheet && existingWorksheet.id) {
                        await worksheetAPI.updateGradedWorksheet(existingWorksheet.id, data);
                    } else {
                        // This case (grade exists, no files, but no existing DB record) might be an edge case
                        // or indicate a new manual grade entry.
                        await worksheetAPI.createGradedWorksheet(data);
                    }
                }
                // Implicitly, worksheets that were uploaded and graded via handleUpload 
                // are already saved to DB in that function.
                // handleSaveAllChanges primarily handles absent students and potentially manual grade adjustments
                // for already processed worksheets if that's a feature.
                // If a student is not absent, has a worksheet number, but no grade yet (and no files for new upload),
                // this function currently doesn't explicitly save them unless they fall into the above categories.
                // This might be okay if the expectation is that grading happens via the 'Grade' button per student.
            }));
            
            toast.success('Changes saved successfully');
            router.refresh(); // Refresh to show updated data if necessary
            
        } catch (error) {
            console.error('Error saving changes:', error);
            toast.error('Failed to save some changes');
        } finally {
            setIsSaving(false);
        }
    };


    if (isLoading) {
        return <div className="flex items-center justify-center min-h-[60vh]">Loading...</div>;
    }

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center">
                <h1 className="text-2xl font-bold">Upload Student Worksheets</h1>
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
                <CardHeader>
                    <CardTitle>Upload Worksheet Images</CardTitle>
                    <CardDescription>Select class and date, then upload and grade worksheets for each student.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                        <div className="space-y-2">
                            <Label htmlFor="class">Class</Label>
                            <select
                                id="class"
                                value={selectedClass}
                                onChange={(e) => setSelectedClass(e.target.value)}
                                className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                                required
                            >
                                <option value="">Select a class</option>
                                {classes.map((cls) => (
                                    <option key={cls.id} value={cls.id}>
                                        {cls.name}
                                    </option>
                                ))}
                            </select>
                        </div>

                        <div className="space-y-2">
                            <Label htmlFor="submittedOn">Date</Label>
                            <Input
                                id="submittedOn"
                                type="date"
                                value={submittedOn}
                                onChange={(e) => setSubmittedOn(e.target.value)}
                                className="h-9 py-1"
                                required
                            />
                        </div>
                    </div>                    {selectedClass && studentWorksheets.length > 0 && (
                        <>
                            {/* Scrollable Card Grid Layout */}
                            <div className="border rounded-lg shadow-sm bg-white overflow-hidden">
                                <div className="max-h-[70vh] overflow-y-auto p-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        {studentWorksheets.map((worksheet, index) => (
                                            <StudentWorksheetCard 
                                                key={worksheet.studentId}
                                                worksheet={worksheet}
                                                index={index}
                                                onUpdate={handleUpdateWorksheet}
                                                onFileChange={handleFileChange}
                                                onUpload={handleUpload}
                                                fileInputRefs={fileInputRefs}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </div>                            <div className="flex justify-end mt-6 space-x-3">
                                <Button
                                    onClick={handleBatchProcess}
                                    disabled={isSaving || studentWorksheets.some(ws => ws.isUploading) || 
                                             !studentWorksheets.some(ws => !ws.isAbsent && ws.files && ws.files.length > 0 && ws.worksheetNumber)}
                                    className="w-full sm:w-auto"
                                    variant="secondary"
                                >
                                    AI Grade All
                                </Button>
                                <Button
                                    onClick={handleSaveAllChanges}
                                    disabled={isSaving || studentWorksheets.some(ws => ws.isUploading)}
                                    className="w-full sm:w-auto"
                                >
                                    {isSaving ? 'Saving All...' : 'Save All Changes'}
                                </Button>
                            </div>
                            
                            <div className="text-sm text-muted-foreground">
                                Showing {studentWorksheets.length} students
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}