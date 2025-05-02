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
                    isAbsent: false,
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
        ));

        try {
            // Prepare form data for API call to Python endpoint
            const formData = new FormData();
            formData.append('token_no', worksheet.tokenNumber);
            formData.append('worksheet_name', worksheet.worksheetNumber.toString());
            
            // Append all files
            for (let i = 0; i < worksheet.files.length; i++) {
                formData.append('files', worksheet.files[i]);
            }

            // Call the Python API endpoint
            const response = await fetch('http://your-python-api-endpoint/process-worksheets', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                throw new Error('Failed to process worksheet');
            }

            const result = await response.json();
            
            // Update the grade from the API response
            setStudentWorksheets(prev => prev.map(sw => 
                sw.studentId === worksheet.studentId 
                    ? { ...sw, grade: result.score.toString(), isUploading: false } 
                    : sw
            ));

            // Save the graded worksheet to the database
            await worksheetAPI.createGradedWorksheet({
                classId: selectedClass,
                studentId: worksheet.studentId,
                worksheetNumber: worksheet.worksheetNumber,
                grade: result.score,
                submittedOn: submittedOn,
                isAbsent: false
            });

            toast.success(`Worksheet for ${worksheet.name} uploaded and graded successfully`);
            
            // Clear file input
            if (fileInputRefs.current[worksheet.studentId]) {
                fileInputRefs.current[worksheet.studentId]!.value = '';
            }
        } catch (error) {
            console.error('Error uploading worksheet:', error);
            toast.error('Failed to upload or grade worksheet');
            
            // Reset uploading status
            setStudentWorksheets(prev => prev.map(sw => 
                sw.studentId === worksheet.studentId ? { ...sw, isUploading: false } : sw
            ));
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
                    // Skip if student is already marked absent in the database (has grade)
                    // if (worksheet.grade !== '') return;
                    
                    // Always update the absent status, even if the student already had a grade
                    const data = {
                        classId: selectedClass,
                        studentId: worksheet.studentId,
                        worksheetNumber: 0,
                        grade: 0,
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: true,
                        notes: 'Student absent'
                    };
                    
                    if (worksheet.grade) {
                        // Update existing record
                        await worksheetAPI.updateGradedWorksheet(worksheet.studentId, data);
                    } else {
                        // Create new record
                        await worksheetAPI.createGradedWorksheet(data);
                    }
                }
                // For students with grades but no files (manually entered grades)
                else if (worksheet.grade && !worksheet.files) {
                    const data = {
                        classId: selectedClass,
                        studentId: worksheet.studentId,
                        worksheetNumber: worksheet.worksheetNumber,
                        grade: parseFloat(worksheet.grade),
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: false
                    };
                    
                    if (worksheet.grade) {
                        // Update existing record
                        await worksheetAPI.updateGradedWorksheet(worksheet.studentId, data);
                    } else {
                        // Create new record
                        await worksheetAPI.createGradedWorksheet(data);
                    }
                }
            }));
            
            toast.success('Changes saved successfully');
            router.refresh();
            
        } catch (error) {
            console.error('Error saving changes:', error);
            toast.error('Failed to save some changes');
        } finally {
            setIsSaving(false);
        }
    };

    // Define columns for the data table
    const columns = [
        {
            accessorKey: "name",
            header: "Student Name",
            cell: ({ row }: { row: any }) => <div>{row.getValue("name")}</div>
        },
        {
            accessorKey: "tokenNumber",
            header: "Token Number",
            cell: ({ row }: { row: any }) => <div>{row.getValue("tokenNumber")}</div>
        },
        {
            accessorKey: "isAbsent",
            header: "Absent",
            cell: ({ row }: { row: any }) => {
                const isChecked = Boolean(row.getValue("isAbsent"));
                return (
                    <div className="flex items-center">
                        <input
                            type="checkbox"
                            checked={isChecked}
                            onChange={(e) => {
                                const index = row.index;
                                handleUpdateWorksheet(index, "isAbsent", e.target.checked);
                            }}
                            className="h-4 w-4 rounded border-gray-300 text-primary focus:ring-primary"
                        />
                        <span className="ml-2 text-xs">Absent</span>
                    </div>
                );
            }
        },
        {
            accessorKey: "worksheetNumber",
            header: "Worksheet #",
            cell: ({ row }: { row: any }) => {
                const isAbsent = Boolean(row.getValue("isAbsent"));
                return (
                    <Input
                        type="number"
                        min="1"
                        step="1"
                        value={row.getValue("worksheetNumber") || ''}
                        onChange={(e) => {
                            const index = row.index;
                            handleUpdateWorksheet(index, "worksheetNumber", parseInt(e.target.value) || 0);
                        }}
                        className="w-20 h-8 px-2 text-sm"
                        disabled={isAbsent}
                    />
                );
            }
        },
        {
            accessorKey: "grade",
            header: "Grade",
            cell: ({ row }: { row: any }) => {
                const grade = row.getValue("grade");
                return (
                    <div className="w-16 h-8 px-2 text-sm flex items-center">
                        {grade ? `${grade}/10` : "-"}
                    </div>
                );
            }
        },
        {
            accessorKey: "upload",
            header: "Upload Image",
            cell: ({ row }: { row: any }) => {
                const index = row.index;
                const studentId = studentWorksheets[index]?.studentId;
                const isAbsent = Boolean(row.getValue("isAbsent"));
                const isUploading = studentWorksheets[index]?.isUploading;
                
                return (
                    <div className="flex flex-col space-y-2">
                        <div className="relative flex items-center">
                            <label htmlFor={`file-input-${studentId}`} className="cursor-pointer flex items-center">
                                <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 mr-2">
                                    <UploadIcon size={16} />
                                </div>
                                <span className="text-xs text-blue-600">
                                    {studentWorksheets[index]?.files ? 
                                        `${studentWorksheets[index]?.files.length} file(s)` : 
                                        "Upload Images"}
                                </span>
                            </label>
                            <input 
                                id={`file-input-${studentId}`}
                                type="file"
                                accept="image/*"
                                multiple
                                onChange={(e) => handleFileChange(studentId, e.target.files)}
                                disabled={isAbsent || isUploading}
                                className="hidden"
                                ref={(el) => {
                                    fileInputRefs.current[studentId] = el;
                                }}
                            />
                        </div>
                        <Button 
                            size="sm"
                            onClick={() => handleUpload(studentWorksheets[index])}
                            disabled={isAbsent || isUploading || !studentWorksheets[index]?.files}
                            className="w-full"
                        >
                            {isUploading ? "Uploading..." : "Grade"}
                        </Button>
                    </div>
                );
            }
        }
    ];

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
                    <CardDescription>Upload and grade student worksheet images</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
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
                    </div>

                    {selectedClass && studentWorksheets.length > 0 && (
                        <>
                            <div className="rounded-md border mt-6">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            {columns.map((column, i) => (
                                                <th 
                                                    key={i} 
                                                    className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
                                                >
                                                    {column.header}
                                                </th>
                                            ))}
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {studentWorksheets.map((worksheet, i) => (
                                            <tr key={worksheet.studentId}>
                                                {columns.map((column, j) => (
                                                    <td key={j} className="px-6 py-4 whitespace-nowrap">
                                                        {column.cell({ 
                                                            row: { 
                                                                getValue: (key: string) => (worksheet as any)[key],
                                                                index: i 
                                                            }
                                                        })}
                                                    </td>
                                                ))}
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            <div className="flex justify-end mt-6">
                                <Button
                                    onClick={handleSaveAllChanges}
                                    disabled={isSaving}
                                    className="w-full sm:w-auto"
                                >
                                    {isSaving ? 'Saving...' : 'Save All Changes'}
                                </Button>
                            </div>
                        </>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}