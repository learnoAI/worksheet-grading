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
    const [isFetchingTableData, setIsFetchingTableData] = useState(false);

    const [classes, setClasses] = useState<Class[]>([]);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [students, setStudents] = useState<Student[]>([]);
    const [submittedOn, setSubmittedOn] = useState<string>(new Date().toISOString().split('T')[0]);

    const [studentGrades, setStudentGrades] = useState<StudentGrade[]>([]);

    const handleDataChange = (updatedData: StudentGrade[]) => {
        setStudentGrades(updatedData);
        console.log('State updated with new grades:', updatedData);
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
            setIsFetchingTableData(true);
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
                    const isAbsent = worksheet ? !!worksheet.isAbsent : false; // Default to absent when no worksheet exists

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
        } finally {
            setIsFetchingTableData(false);
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
        let incompleteEntries: StudentGrade[] = [];
        let toSave: any[] = [];
        let toDelete: string[] = []; // Store IDs of worksheets to delete

        try {
            studentGrades.forEach(grade => {
                if (grade.isAbsent) {
                    // Category 1: Absent - Prepare data for save/update
                    const data = {
                        classId: selectedClass,
                        studentId: grade.studentId,
                        worksheetNumber: 0,
                        grade: 0,
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: true,
                        isRepeated: false,
                        notes: 'Student absent'
                    };
                    toSave.push({ id: grade.id, existing: grade.existing, data: data, name: grade.name });
                } else {
                    const worksheetNumber = grade.worksheetNumber;
                    const gradeValue = grade.grade.trim();
                    const isValidWorksheetNumber = worksheetNumber && worksheetNumber > 0;
                    const isValidGrade = gradeValue !== '' && !isNaN(parseFloat(gradeValue));

                    if (isValidWorksheetNumber && isValidGrade) {
                        // Category 2: Present and Complete - Prepare data for save/update
                        const data = {
                            classId: selectedClass,
                            studentId: grade.studentId,
                            worksheetNumber: worksheetNumber,
                            grade: parseFloat(gradeValue),
                            submittedOn: new Date(submittedOn).toISOString(),
                            isAbsent: false,
                            isRepeated: grade.isRepeated || false,
                            notes: undefined // Clear any previous absent notes if now present
                        };
                        toSave.push({ id: grade.id, existing: grade.existing, data: data, name: grade.name });
                    } else if (!isValidWorksheetNumber && !isValidGrade) {
                        // Category 4: Present and Blank
                        if (grade.existing && grade.id) {
                            // If record exists, mark for deletion
                            toDelete.push(grade.id);
                        }
                        // If no record exists, simply ignore this student (do nothing)
                    } else {
                        // Category 3: Present and Incomplete - Add to validation error list
                        incompleteEntries.push(grade);
                    }
                }
            });

            if (incompleteEntries.length > 0) {
                const incompleteNames = incompleteEntries.map(g => g.name).join(', ');
                toast.error(`Please fill in both Worksheet# and Grade for: ${incompleteNames}, or mark them as absent.`);
                setIsSaving(false);
                return;
            }

            // Execute deletions first
            if (toDelete.length > 0) {
                await Promise.all(toDelete.map(id => worksheetAPI.deleteGradedWorksheet(id)));
                toast.info(`${toDelete.length} blank existing record(s) removed.`);
            }

            // Execute saves/updates
            await Promise.all(toSave.map(async (item) => {
                try {
                    if (item.existing && item.id) {
                        await worksheetAPI.updateGradedWorksheet(item.id, item.data);
                    } else if (!item.data.isAbsent || (item.data.isAbsent && !item.existing)) {
                        // Create only if it's a new entry (present or absent)
                        // Avoid creating a new record if it was just deleted (present and blank)
                        // Or if an absent record already existed (though update handles this)
                        if (!toDelete.includes(item.id)) { // Ensure we don't try to create what was just deleted
                            await worksheetAPI.createGradedWorksheet(item.data);
                        }
                    }
                } catch (error) {
                    console.error(`Error saving grade for ${item.name}:`, error);
                    throw new Error(`Failed for ${item.name}`); // Re-throw specific error
                }
            }));

            if (toSave.length > 0) {
                toast.success(`${toSave.length} grade(s) saved successfully`);
            } else if (toDelete.length === 0) {
                toast.info("No changes needed.");
            }


            // Completely refresh data after save/delete to ensure consistency with server state
            await fetchStudentsAndWorksheets();
        } catch (error: any) {
            console.error('Error saving grades:', error);
            toast.error(`Failed to save some grades. ${error.message || ''}`);
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

                    {selectedClass && isFetchingTableData && (
                        <div className="flex justify-center items-center h-40">
                            <p>Loading student data...</p>
                        </div>
                    )}

                    {selectedClass && !isFetchingTableData && studentGrades.length > 0 && (
                        <>
                            <DataTable
                                key={`${selectedClass}-${submittedOn}`}
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