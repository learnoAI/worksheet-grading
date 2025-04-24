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

    // Form state
    const [classes, setClasses] = useState<Class[]>([]);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [students, setStudents] = useState<Student[]>([]);
    const [submittedOn, setSubmittedOn] = useState<string>(new Date().toISOString().split('T')[0]);

    // Student grades state
    const [studentGrades, setStudentGrades] = useState<StudentGrade[]>([]);

    // Handle state updates from data table
    const handleDataChange = (updatedData: StudentGrade[]) => {
        // Create a completely new array to ensure React detects the state change
        const newGrades = updatedData.map(grade => ({...grade}));
        setStudentGrades(newGrades);
        
        // Debug - log the changed data
        console.log('State updated with new grades:', newGrades);
    };

    // Fetch teacher's classes on mount
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

    // Fetch students and their existing worksheets when class or date changes
    useEffect(() => {
        const fetchStudentsAndWorksheets = async () => {
            if (!selectedClass) {
                setStudents([]);
                setStudentGrades([]);
                return;
            }

            try {
                const studentsData = await classAPI.getClassStudents(selectedClass);
                setStudents(studentsData);

                // Initialize grades for all students
                const grades = await Promise.all(studentsData.map(async (student) => {
                    try {
                        const worksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                            selectedClass,
                            student.id,
                            submittedOn
                        );

                        return {
                            studentId: student.id,
                            name: student.name,
                            tokenNumber: student.tokenNumber,
                            id: worksheet?.id || '',
                            worksheetNumber: worksheet?.template?.worksheetNumber || 0,
                            grade: worksheet?.grade?.toString() || '',
                            existing: !!worksheet,
                            isAbsent: worksheet?.isAbsent || false,
                            isRepeated: worksheet?.isRepeated || false
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
                            isAbsent: false,
                            isRepeated: false
                        };
                    }
                }));

                setStudentGrades(grades);
            } catch (error) {
                console.error('Error fetching students:', error);
                toast.error('Failed to load students');
            }
        };

        fetchStudentsAndWorksheets();
    }, [selectedClass, submittedOn]);

    const handleSave = async () => {
        setIsSaving(true);
        try {
            // Ensure all students have either a grade or are marked as absent
            const incompleteEntries = studentGrades.filter(
                grade => !grade.isAbsent && (!grade.worksheetNumber || grade.worksheetNumber <= 0 || !grade.grade)
            );
            
            if (incompleteEntries.length > 0) {
                toast.error(`Please fill in all student entries or mark them as absent. ${incompleteEntries.length} student(s) are incomplete.`);
                setIsSaving(false);
                return;
            }

            // Process each grade including absent students
            await Promise.all(studentGrades.map(async (grade) => {
                const data = {
                    classId: selectedClass,
                    studentId: grade.studentId,
                    worksheetNumber: grade.isAbsent ? 0 : grade.worksheetNumber,
                    grade: grade.isAbsent ? 0 : parseFloat(grade.grade),
                    submittedOn: new Date(submittedOn).toISOString(),
                    isAbsent: grade.isAbsent,
                    isRepeated: grade.isRepeated || false,
                    notes: grade.isAbsent ? 'Student absent' : undefined
                };

                if (grade.existing) {
                    await worksheetAPI.updateGradedWorksheet(grade.id, data);
                } else {
                    await worksheetAPI.createGradedWorksheet(data);
                }
            }));

            toast.success('Grades saved successfully');
            // Refresh data to reflect the latest changes
            router.refresh();
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

                    {selectedClass && students.length > 0 && (
                        <>
                            <DataTable
                                key={JSON.stringify(studentGrades)}
                                columns={columns}
                                data={studentGrades}
                                onDataChange={handleDataChange}
                            />
                            <div className="flex justify-end mt-6">
                                <Button
                                    onClick={handleSave}
                                    disabled={isSaving || studentGrades.every(g => !g.worksheetNumber && !g.grade)}
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