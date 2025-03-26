'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { classAPI, worksheetAPI } from '@/lib/api';

interface Class {
    id: string;
    name: string;
}

interface Student {
    id: string;
    username: string;
}

interface StudentGrade {
    studentId: string;
    worksheetNumber: number;
    grade: string;
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
    const [studentGrades, setStudentGrades] = useState<Record<string, StudentGrade>>({});

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
                setStudentGrades({});
                return;
            }

            try {
                const studentsData = await classAPI.getClassStudents(selectedClass);
                setStudents(studentsData);

                // Initialize empty grades for all students
                const newGrades: Record<string, StudentGrade> = {};

                // Check for existing worksheets for each student
                await Promise.all(studentsData.map(async (student) => {
                    try {
                        const worksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                            selectedClass,
                            student.id,
                            submittedOn
                        );

                        newGrades[student.id] = {
                            studentId: student.id,
                            worksheetNumber: worksheet?.worksheetNumber || 0,
                            grade: worksheet?.grade?.toString() || '',
                        };
                    } catch (error) {
                        console.error(`Error fetching worksheet for student ${student.id}:`, error);
                        newGrades[student.id] = {
                            studentId: student.id,
                            worksheetNumber: 0,
                            grade: '',
                        };
                    }
                }));

                setStudentGrades(newGrades);
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
            // Filter out students with no worksheet number or grade
            const gradesToSubmit = Object.values(studentGrades).filter(
                grade => grade.worksheetNumber > 0 && grade.grade
            );

            // Process each grade
            await Promise.all(gradesToSubmit.map(async (grade) => {
                const data = {
                    classId: selectedClass,
                    studentId: grade.studentId,
                    worksheetNumber: grade.worksheetNumber,
                    grade: parseFloat(grade.grade),
                    submittedOn: new Date(submittedOn).toISOString()
                };

                if (grade.worksheetNumber > 0) {
                    await worksheetAPI.updateGradedWorksheet(grade.worksheetNumber, data);
                } else {
                    await worksheetAPI.createGradedWorksheet(data);
                }
            }));

            toast.success('Grades saved successfully');
            router.push('/dashboard/teacher/worksheets');
        } catch (error) {
            console.error('Error saving grades:', error);
            toast.error('Failed to save some grades');
        } finally {
            setIsSaving(false);
        }
    };

    const updateStudentGrade = (studentId: string, field: keyof StudentGrade, value: string | number) => {
        setStudentGrades(prev => ({
            ...prev,
            [studentId]: {
                ...prev[studentId],
                [field]: value
            }
        }));
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
                        <div className="mt-6 -mx-6 sm:mx-0">
                            <div className="overflow-x-auto">
                                <table className="min-w-full divide-y divide-gray-200">
                                    <thead className="bg-gray-50">
                                        <tr>
                                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Student
                                            </th>
                                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Worksheet #
                                            </th>
                                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Grade
                                            </th>
                                            <th scope="col" className="px-4 py-2 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                                                Status
                                            </th>
                                        </tr>
                                    </thead>
                                    <tbody className="bg-white divide-y divide-gray-200">
                                        {students.map((student) => {
                                            const grade = studentGrades[student.id];
                                            return (
                                                <tr key={student.id}>
                                                    <td className="px-4 py-2 whitespace-nowrap text-sm">
                                                        {student.username}
                                                    </td>
                                                    <td className="px-4 py-2 whitespace-nowrap">
                                                        <Input
                                                            type="number"
                                                            min="1"
                                                            step="1"
                                                            value={grade?.worksheetNumber || ''}
                                                            onChange={(e) => updateStudentGrade(student.id, 'worksheetNumber', parseInt(e.target.value) || 0)}
                                                            className="w-20 h-8 px-2 text-sm"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-2 whitespace-nowrap">
                                                        <Input
                                                            type="number"
                                                            min="0"
                                                            max="10"
                                                            step="0.1"
                                                            value={grade?.grade || ''}
                                                            onChange={(e) => updateStudentGrade(student.id, 'grade', e.target.value)}
                                                            className="w-16 h-8 px-2 text-sm"
                                                        />
                                                    </td>
                                                    <td className="px-4 py-2 whitespace-nowrap text-xs">
                                                        {grade?.worksheetNumber > 0 || grade?.grade ? (
                                                            <span className="text-blue-600">Create</span>
                                                        ) : (
                                                            <span className="text-gray-500">-</span>
                                                        )}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}

                    {selectedClass && students.length > 0 && (
                        <div className="flex justify-end mt-6">
                            <Button
                                onClick={handleSave}
                                disabled={isSaving || Object.values(studentGrades).every(g => !g.worksheetNumber && !g.grade)}
                                className="w-full sm:w-auto"
                            >
                                {isSaving ? 'Saving...' : 'Save All Changes'}
                            </Button>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
} 