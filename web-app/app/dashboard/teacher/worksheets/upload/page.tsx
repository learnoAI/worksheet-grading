'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { classAPI, worksheetAPI } from '@/lib/api';
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
    grade: string;
    isUploading: boolean;
    page1File?: File | null;
    page2File?: File | null;
}

// Token number sorting function (same as used in grade/columns.tsx)
const sortStudentsByTokenNumber = <T extends { tokenNumber: string }>(students: T[]): T[] => {
    return [...students].sort((a, b) => {
        const parseToken = (token: string) => {
            // Check if it matches YearSNumber format (e.g., 24S138)
            const yearSMatch = token.match(/^(\d+)S(\d+)$/);
            if (yearSMatch) {
                const year = parseInt(yearSMatch[1]);
                const number = parseInt(yearSMatch[2]);
                return { type: 'yearS' as const, year, number, original: token };
            }
            
            // Check if it's a pure number
            const pureNumber = parseInt(token);
            if (!isNaN(pureNumber) && token === pureNumber.toString()) {
                return { type: 'number' as const, number: pureNumber, original: token };
            }
            
            // Fallback to string sorting for other formats
            return { type: 'string' as const, original: token };
        };
        
        const aParsed = parseToken(a.tokenNumber);
        const bParsed = parseToken(b.tokenNumber);
        
        // Sort by type first: numbers, then yearS format, then strings
        const typeOrder = { number: 0, yearS: 1, string: 2 };
        const aTypeOrder = typeOrder[aParsed.type] || 2;
        const bTypeOrder = typeOrder[bParsed.type] || 2;
        
        if (aTypeOrder !== bTypeOrder) {
            return aTypeOrder - bTypeOrder;
        }
        
        // Within same type, sort appropriately
        if (aParsed.type === 'number' && bParsed.type === 'number') {
            return aParsed.number - bParsed.number;
        } else if (aParsed.type === 'yearS' && bParsed.type === 'yearS') {
            // Sort by year first, then by number
            if (aParsed.year !== bParsed.year) {
                return aParsed.year - bParsed.year;
            }
            return aParsed.number - bParsed.number;
        } else {
            // String comparison for other formats
            return aParsed.original.localeCompare(bParsed.original);
        }
    });
};

export default function UploadWorksheetPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [classes, setClasses] = useState<Class[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [students, setStudents] = useState<Student[]>([]);
    const [submittedOn, setSubmittedOn] = useState<string>(new Date().toISOString().split('T')[0]);    const [studentWorksheets, setStudentWorksheets] = useState<StudentWorksheet[]>([]);
    const fileInputRefs = useRef<{[key: string]: HTMLInputElement | null}>({});

    // Memoized sorted student worksheets to ensure consistent ordering in UI
    const sortedStudentWorksheets = useMemo(() => {
        return sortStudentsByTokenNumber(studentWorksheets);
    }, [studentWorksheets]);

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
    }, [user?.id]);    // Fetch students for the selected class
    useEffect(() => {
        const fetchStudents = async () => {
            if (!selectedClass) {
                setStudents([]);
                setStudentWorksheets([]);
                return;
            }

            try {
                const studentsData = await classAPI.getClassStudents(selectedClass);
                
                // Sort students by token number using the same logic as grading table
                const sortedStudents = sortStudentsByTokenNumber(studentsData);
                setStudents(sortedStudents);                // Create sorted student worksheets maintaining the same order
                const sortedStudentWorksheets = sortStudentsByTokenNumber(
                    sortedStudents.map(student => ({
                        studentId: student.id,
                        name: student.name,
                        tokenNumber: student.tokenNumber,
                        worksheetNumber: 0,
                        isAbsent: false,  // Default to NOT absent
                        grade: '',
                        isUploading: false,
                        page1File: null,
                        page2File: null
                    }))
                );
                setStudentWorksheets(sortedStudentWorksheets);
            } catch (error) {
                console.error('Error fetching students:', error);
                toast.error('Failed to load students');
            }
        };        fetchStudents();
    }, [selectedClass]);    const handlePageFileChange = (studentId: string, pageNumber: number, file: File | null) => {
        setStudentWorksheets(prev => prev.map(sw => {
            if (sw.studentId === studentId) {
                const updated = { ...sw };
                
                // Update the specific page file
                if (pageNumber === 1) {
                    updated.page1File = file;
                } else if (pageNumber === 2) {
                    updated.page2File = file;
                }
                
                return updated;
            }
            return sw;
        }));
    };const handleUpdateWorksheet = (sortedIndex: number, field: string, value: any) => {
        // Find the actual worksheet in the original array by studentId
        const sortedWorksheet = sortedStudentWorksheets[sortedIndex];
        const originalIndex = studentWorksheets.findIndex(w => w.studentId === sortedWorksheet.studentId);
        
        if (originalIndex === -1) return;
        
        const newWorksheets = [...studentWorksheets];        // If marking as absent, clear other fields        
        if (field === "isAbsent" && value === true) {
            newWorksheets[originalIndex] = {
                ...newWorksheets[originalIndex],
                isAbsent: true,
                worksheetNumber: 0,  // Clear worksheet number
                grade: '',           // Clear grade
                page1File: null,     // Clear page 1 file
                page2File: null      // Clear page 2 file
            };
        } else {
            (newWorksheets[originalIndex] as any)[field] = value;
                // If setting worksheet number, uploading files, or entering grade, ensure student isn't marked as absent
            if ((field === "worksheetNumber" && value > 0) || field === "page1File" || field === "page2File" || (field === "grade" && value)) {
                newWorksheets[originalIndex].isAbsent = false;
            }
        }
        
        setStudentWorksheets(newWorksheets);
    };    const handleUpload = async (worksheet: StudentWorksheet) => {
        if (worksheet.isAbsent) {
            return;
        }

        if (!worksheet.worksheetNumber) {
            toast.error('Please enter a worksheet number');
            return;
        }

        // Check if at least one page file exists
        if (!worksheet.page1File && !worksheet.page2File) {
            toast.error('Please upload at least one page image');
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
            
            // Append page files
            if (worksheet.page1File) {
                formData.append('files', worksheet.page1File);
            }
            if (worksheet.page2File) {
                formData.append('files', worksheet.page2File);
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
                    ? { 
                        ...sw, 
                        grade: grade.toString(), 
                        isUploading: false,
                        // Clear page files after successful processing
                        page1File: null,
                        page2File: null
                    } 
                    : sw
            ));
            
            toast.success(`Worksheet for ${worksheet.name} processed successfully! Grade: ${grade}`);
            
            // No need to clear file input since we're using individual page files
            
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
    };    // Process all non-absent students' worksheets in parallel
    const handleBatchProcess = async () => {
        const studentsWithFiles = studentWorksheets.filter(sw => 
            !sw.isAbsent && (sw.page1File || sw.page2File) && sw.worksheetNumber
        );
          if (studentsWithFiles.length === 0) {
            toast.error('No worksheets to process. Please upload page images and assign worksheet numbers.');
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
            const batchSize = 10; // Process 10 worksheets at a time in parallel
            let successful = 0;
            let failed = 0;
              console.log(`Processing ${studentsWithFiles.length} worksheets in batches of ${batchSize}...`);
            
            // Process worksheets in batches to control concurrency
            for (let i = 0; i < studentsWithFiles.length; i += batchSize) {
                const currentBatch = studentsWithFiles.slice(i, i + batchSize);
                const batchNumber = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(studentsWithFiles.length / batchSize);
                
                console.log(`Processing batch ${batchNumber}/${totalBatches} (${currentBatch.length} worksheets)...`);
                
                const batchResults = await Promise.allSettled(
                    currentBatch.map(worksheet => handleUpload(worksheet))
                );
                
                // Count successes and failures for this batch with detailed logging
                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value && result.value.success) {
                        successful++;
                        console.log(`✓ Successfully processed worksheet for ${currentBatch[index].name}`);
                    } else {
                        failed++;
                        const studentName = currentBatch[index].name;
                        const error = result.status === 'rejected' ? 
                            (result.reason?.message || result.reason || 'Upload failed') : 
                            'Processing failed';
                        console.error(`✗ Failed to process worksheet for ${studentName}:`, error);
                    }
                });
                
                // Add a delay between batches to be gentle on the server
                if (i + batchSize < studentsWithFiles.length) {
                    console.log(`Waiting 1 second before next batch...`);
                    await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay
                }
            }
            
            // Show final results
            console.log(`Batch processing completed: ${successful} successful, ${failed} failed`);
              if (successful > 0) {
                toast.success(`Successfully processed ${successful} worksheet${successful !== 1 ? 's' : ''}!`);
            }
            
            if (failed > 0) {
                toast.error(`Failed to process ${failed} worksheet${failed !== 1 ? 's' : ''}. Check console for details.`);
            }
            
            if (successful === 0 && failed === 0) {
                toast.info('No worksheets were processed.');
            }
        } catch (error) {
            console.error('Error in batch processing:', error);
            toast.error('Failed to process worksheets');
        }
    };

    // Save individual student worksheet
    const handleSaveStudent = async (worksheet: StudentWorksheet) => {
        if (!selectedClass) {
            toast.error('Please select a class first');
            return;
        }

        // Set uploading state for this specific student
        setStudentWorksheets(prev => 
            prev.map(w => w.studentId === worksheet.studentId 
                ? { ...w, isUploading: true } 
                : w
            )
        );

        try {
            if (worksheet.isAbsent) {
                // Save absent student
                const data = {
                    classId: selectedClass,
                    studentId: worksheet.studentId,
                    worksheetNumber: 0,
                    grade: 0,
                    submittedOn: new Date(submittedOn).toISOString(),
                    isAbsent: true,
                    notes: 'Student absent'
                };

                const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                    selectedClass, 
                    worksheet.studentId, 
                    submittedOn
                );

                if (existingWorksheet && existingWorksheet.id) {
                    await worksheetAPI.updateGradedWorksheet(existingWorksheet.id, data);
                } else {
                    await worksheetAPI.createGradedWorksheet(data);
                }

                toast.success(`${worksheet.name} marked as absent and saved`);
            } else {
                // Validate non-absent student data
                if (!worksheet.worksheetNumber || worksheet.worksheetNumber <= 0) {
                    toast.error('Please enter a worksheet number');
                    return;
                }

                if (!worksheet.grade || worksheet.grade.trim() === '') {
                    toast.error('Please enter a grade');
                    return;
                }

                // Save student with grade
                const data = {
                    classId: selectedClass,
                    studentId: worksheet.studentId,
                    worksheetNumber: worksheet.worksheetNumber,
                    grade: parseFloat(worksheet.grade),
                    submittedOn: new Date(submittedOn).toISOString(),
                    isAbsent: false
                };

                const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                    selectedClass, 
                    worksheet.studentId, 
                    submittedOn
                );

                if (existingWorksheet && existingWorksheet.id) {
                    await worksheetAPI.updateGradedWorksheet(existingWorksheet.id, data);
                } else {
                    await worksheetAPI.createGradedWorksheet(data);
                }

                toast.success(`${worksheet.name}'s worksheet saved successfully`);
            }
        } catch (error) {
            console.error('Error saving student worksheet:', error);
            toast.error(`Failed to save ${worksheet.name}'s worksheet`);
        } finally {
            // Remove uploading state for this specific student
            setStudentWorksheets(prev => 
                prev.map(w => w.studentId === worksheet.studentId 
                    ? { ...w, isUploading: false } 
                    : w
                )
            );
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
                    }                }
                // For students with grades (manually entered or AI graded that might have been edited)
                // This part handles saving changes for students who are NOT absent and have grades
                else if (worksheet.grade && worksheet.worksheetNumber > 0) {
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
                        // This case handles new manual grade entries or AI graded worksheets that need to be saved
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
    }    return (
        <div className="space-y-4 md:space-y-6">
            <div className="flex justify-between items-center px-2 md:px-0">
                <h1 className="text-xl md:text-2xl font-bold">Upload Student Worksheets</h1>
                <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                        const basePath = user?.role === 'TEACHER' ? '/dashboard/teacher' : '/dashboard/superadmin';
                        router.push(`${basePath}/worksheets`);
                    }}
                >
                    Cancel
                </Button>
            </div>

            <div className="bg-white rounded-lg border shadow-sm">
                <div className="p-4 md:p-6 border-b">
                    <h2 className="text-lg font-semibold mb-1">Upload Worksheet Images</h2>
                    <p className="text-sm text-gray-600">Select class and date, then upload and grade worksheets for each student.</p>
                </div>
                <div className="p-4 md:p-6 space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="class" className="text-sm font-medium">Class</Label>
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
                            <Label htmlFor="submittedOn" className="text-sm font-medium">Date</Label>
                            <Input
                                id="submittedOn"
                                type="date"
                                value={submittedOn}
                                onChange={(e) => setSubmittedOn(e.target.value)}
                                className="h-9 py-1"
                                required
                            />
                        </div>
                    </div>                    {selectedClass && sortedStudentWorksheets.length > 0 && (
                        <>
                            {/* Scrollable Student Grid */}
                            <div className="max-h-[70vh] overflow-y-auto">
                                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 p-2 md:p-0">
                                    {sortedStudentWorksheets.map((worksheet, sortedIndex) => (
                                        <StudentWorksheetCard 
                                            key={worksheet.studentId}
                                            worksheet={worksheet}
                                            index={sortedIndex}
                                            onUpdate={handleUpdateWorksheet}
                                            onPageFileChange={handlePageFileChange}
                                            onUpload={handleUpload}
                                            onSave={handleSaveStudent}
                                            fileInputRefs={fileInputRefs}
                                        />
                                    ))}
                                </div>
                            </div>

                            <div className="flex flex-col md:flex-row justify-end mt-4 space-y-2 md:space-y-0 md:space-x-3 px-2 md:px-0">
                                <Button
                                    onClick={handleBatchProcess}
                                    disabled={isSaving || sortedStudentWorksheets.some(ws => ws.isUploading) || 
                                             !sortedStudentWorksheets.some(ws => !ws.isAbsent && (ws.page1File || ws.page2File) && ws.worksheetNumber)}
                                    className="w-full md:w-auto"
                                    variant="secondary"
                                >
                                    AI Grade All
                                </Button>
                                <Button
                                    onClick={handleSaveAllChanges}
                                    disabled={isSaving || sortedStudentWorksheets.some(ws => ws.isUploading)}
                                    className="w-full md:w-auto"
                                >
                                    {isSaving ? 'Saving All...' : 'Save All Changes'}
                                </Button>
                            </div>
                            
                            <div className="text-sm text-muted-foreground px-2 md:px-0">
                                Showing {sortedStudentWorksheets.length} students
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}