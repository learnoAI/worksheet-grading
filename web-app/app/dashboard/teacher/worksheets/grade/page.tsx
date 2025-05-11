'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { classAPI, worksheetAPI } from '@/lib/api';
import { DataTable } from './data-table';
import { columns, StudentGrade } from './columns';

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

export default function GradeWorksheetPage() {
    const { user } = useAuth();
    const router = useRouter();
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);

    const [classes, setClasses] = useState<Class[]>([]);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [students, setStudents] = useState<Student[]>([]);
    const [submittedOn, setSubmittedOn] = useState<string>(new Date().toISOString().split('T')[0]);

    const [studentGrades, setStudentGrades] = useState<StudentGrade[]>([]);

    const handleDataChange = (updatedData: StudentGrade[]) => {
        const newGrades = updatedData.map(grade => ({...grade}));
        setStudentGrades(newGrades);
    };

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

    useEffect(() => {
        const loadStudentsData = async () => {
            if (!selectedClass) {
                setStudents([]);
                setStudentGrades([]);
                return;
            }
            await fetchStudentsAndWorksheets();
        };
        
        loadStudentsData();
    }, [selectedClass, submittedOn]);

    const fetchStudentsAndWorksheets = async () => {
        if (!selectedClass) {
            return;
        }

        try {
            const studentsData = await classAPI.getClassStudents(selectedClass);
            setStudents(studentsData); // Make sure to update the students array
            
            const grades = await Promise.all(studentsData.map(async (student) => {
                try {
                    const worksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                        selectedClass,
                        student.id,
                        submittedOn
                    );

                    // Ensure that absent students have empty values
                    const isAbsent = worksheet ? !!worksheet.isAbsent : true; // Default to absent when no worksheet exists
                    
                    return {
                        studentId: student.id,
                        name: student.name,
                        tokenNumber: student.tokenNumber,
                        id: worksheet?.id || '',
                        worksheetNumber: isAbsent ? 0 : (worksheet?.template?.worksheetNumber || 0),
                        grade: isAbsent ? '' : (worksheet?.grade?.toString() || ''),
                        existing: !!worksheet,
                        isAbsent: isAbsent,
                        isRepeated: isAbsent ? false : (worksheet?.isRepeated || false)
                    };
                } catch (error) {
                    console.error(`Error fetching worksheet for student ${student.id}:`, error);
                    return {
                        studentId: student.id,
                        name: student.name,
                        tokenNumber: student.tokenNumber,
                        id: '',
                        worksheetNumber: 0,
                        grade: '',
                        existing: false,
                        isAbsent: true, // Default to absent for new entries or errors
                        isRepeated: false
                    };
                }
            }));

            setStudentGrades(grades);
        } catch (error) {
            console.error('Error refreshing student data:', error);
            toast.error('Failed to refresh student data');
        }
    };

    const handleSaveStudent = async (grade: StudentGrade) => {
        try {
            let updatedGrade = { ...grade };
            if (updatedGrade.isAbsent) {
                updatedGrade = {
                    ...updatedGrade,
                    worksheetNumber: 0,
                    grade: "",
                    isRepeated: false
                };
            }

            if (!updatedGrade.isAbsent && (!updatedGrade.worksheetNumber || updatedGrade.worksheetNumber <= 0 || !updatedGrade.grade)) {
                toast.error('Please fill in all fields or mark the student as absent');
                return;
            }

            const data = {
                classId: selectedClass,
                studentId: updatedGrade.studentId,
                worksheetNumber: updatedGrade.isAbsent ? 0 : updatedGrade.worksheetNumber,
                grade: updatedGrade.isAbsent ? 0 : parseFloat(updatedGrade.grade),
                submittedOn: new Date(submittedOn).toISOString(),
                isAbsent: updatedGrade.isAbsent,
                isRepeated: updatedGrade.isAbsent ? false : (updatedGrade.isRepeated || false),
                notes: updatedGrade.isAbsent ? 'Student absent' : undefined
            };

            if (updatedGrade.existing) {
                await worksheetAPI.updateGradedWorksheet(updatedGrade.id, data);
            } else {
                await worksheetAPI.createGradedWorksheet(data);
            }

            toast.success(`Grade for ${updatedGrade.name} saved successfully`);
            
            // Update student grade locally first for immediate feedback
            setStudentGrades(prevGrades => prevGrades.map(g => 
                g.studentId === updatedGrade.studentId ? updatedGrade : g
            ));
            
            // Then fetch from server to ensure full consistency
            await fetchStudentData(updatedGrade.studentId);
            
        } catch (error) {
            console.error('Error saving grade:', error);
            toast.error(`Failed to save grade for ${grade.name}`);
        }
    };

    // Fetch data for a single student
    const fetchStudentData = async (studentId: string) => {
        try {
            const worksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                selectedClass,
                studentId,
                submittedOn
            );
            
            // Ensure that absent students have empty values
            const isAbsent = worksheet ? !!worksheet.isAbsent : false;
            
            // Update just this student in the state
            setStudentGrades(prevGrades => prevGrades.map(g => 
                g.studentId === studentId 
                ? {
                    ...g,
                    id: worksheet?.id || g.id,
                    worksheetNumber: isAbsent ? 0 : (worksheet?.template?.worksheetNumber || 0),
                    grade: isAbsent ? '' : (worksheet?.grade?.toString() || ''),
                    existing: !!worksheet,
                    isAbsent: isAbsent,
                    isRepeated: isAbsent ? false : (worksheet?.isRepeated || false)
                } 
                : g
            ));
        } catch (error) {
            console.error(`Error refreshing data for student ${studentId}:`, error);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Force clear all data for absent students before saving
            const consistentGrades = studentGrades.map(grade => {
                if (grade.isAbsent) {
                    return {
                        ...grade,
                        worksheetNumber: 0, // Force to 0 for absent students
                        grade: "",          // Force to empty for absent students
                        isRepeated: false   // Can't be repeated if absent
                    };
                }
                return grade;
            });
            
            // Update the state with consistent data
            setStudentGrades(consistentGrades);

            // Only validate non-absent students
            const incompleteEntries = consistentGrades.filter(
                grade => !grade.isAbsent && (!grade.worksheetNumber || grade.worksheetNumber <= 0 || !grade.grade)
            );
            
            if (incompleteEntries.length > 0) {
                toast.error(`Please fill in all student entries or mark them as absent. ${incompleteEntries.length} student(s) are incomplete.`);
                setIsSaving(false);
                return;
            }

            await Promise.all(consistentGrades.map(async (grade) => {
                // Create a clean data object that enforces absent rules
                const data = {
                    classId: selectedClass,
                    studentId: grade.studentId,
                    worksheetNumber: grade.isAbsent ? 0 : grade.worksheetNumber,
                    grade: grade.isAbsent ? 0 : parseFloat(grade.grade),
                    submittedOn: new Date(submittedOn).toISOString(),
                    isAbsent: grade.isAbsent,
                    isRepeated: grade.isAbsent ? false : (grade.isRepeated || false),
                    notes: grade.isAbsent ? 'Student absent' : undefined
                };

                try {
                    // Always update if the record exists, whether absent or not
                    if (grade.existing) {
                        await worksheetAPI.updateGradedWorksheet(grade.id, data);
                    } else {
                        await worksheetAPI.createGradedWorksheet(data);
                    }
                } catch (error) {
                    console.error(`Error saving grade for ${grade.name}:`, error);
                    throw error; // Re-throw to catch in outer catch block
                }
            }));

            toast.success('All grades saved successfully');
            
            // Completely refresh data after save to ensure consistency with server state
            await fetchStudentsAndWorksheets();
        } catch (error) {
            console.error('Error saving grades:', error);
            toast.error('Failed to save some grades');
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
                <h1 className="text-2xl font-bold">Grade Worksheets</h1>
                <Button
                    variant="outline"
                    onClick={() => router.push('/dashboard/teacher/worksheets')}
                >
                    Cancel
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Submit Worksheet Grades</CardTitle>
                    <CardDescription>Grade worksheets for multiple students</CardDescription>
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

                    {selectedClass && studentGrades.length > 0 && (
                        <>
                            <div className="p-4 mb-4 bg-blue-50 rounded-md border border-blue-100">
                                <h3 className="text-sm font-medium text-blue-800 mb-2">Student Selection Instructions:</h3>
                                <p className="text-sm text-blue-700">
                                    1. Use the search box to filter students by name or token number
                                </p>
                                <p className="text-sm text-blue-700">
                                    2. Select specific students from the dropdown or by clicking their cards
                                </p>
                                <p className="text-sm text-blue-700">
                                    3. Enter worksheet number and grade to apply to all selected students
                                </p>
                                <p className="text-sm text-blue-700">
                                    4. Click "Apply to Selected" to update all selected students at once
                                </p>
                            </div>
                            <DataTable
                                key={selectedClass + submittedOn}
                                columns={columns}
                                data={studentGrades}
                                onDataChange={handleDataChange}
                                onSaveStudent={handleSaveStudent}
                            />
                            <div className="flex justify-end mt-6">
                                <Button
                                    onClick={handleSave}
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