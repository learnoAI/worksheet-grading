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
import { usePostHog } from 'posthog-js/react';

const PROGRESSION_THRESHOLD = 32;

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
    const posthog = usePostHog();
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingTableData, setIsFetchingTableData] = useState(false);

    const [classes, setClasses] = useState<Class[]>([]);
    const [selectedClass, setSelectedClass] = useState<string>('');
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
            
            const selectedDate = new Date(submittedOn);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            selectedDate.setHours(0, 0, 0, 0);
            
            const studentsWithHistory = new Map<string, boolean>();
            
            const grades = await Promise.all(studentsData.map(async (student) => {
                try {
                    const worksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                        selectedClass,
                        student.id,
                        submittedOn
                    );
                    
                    if (worksheet) {
                        return {
                            studentId: student.id,
                            name: student.name,
                            tokenNumber: student.tokenNumber,
                            id: worksheet.id || '',
                            worksheetNumber: worksheet.isAbsent ? 0 : (worksheet.template?.worksheetNumber || 0),
                            grade: worksheet.isAbsent ? '' : (worksheet.grade?.toString() || ''),
                            existing: true,
                            isAbsent: !!worksheet.isAbsent,
                            isRepeated: worksheet.isAbsent ? false : (worksheet.isRepeated || false),
                            isIncorrectGrade: worksheet.isAbsent ? false : (worksheet.isIncorrectGrade || false),
                            isNew: false
                        };
                    }
                    
                    const previousWorksheets = await worksheetAPI.getPreviousWorksheets(
                        selectedClass,
                        student.id, 
                        submittedOn
                    );
                    
                    const hasHistory = previousWorksheets && previousWorksheets.length > 0;
                    studentsWithHistory.set(student.id, hasHistory);
                    
                    const recommendedWorksheetNumber = await getRecommendedWorksheetNumber(
                        selectedClass,
                        student.id, 
                        submittedOn,
                        0
                    );
                    
                    const hasNonAbsentRecords = previousWorksheets && previousWorksheets.some(ws => !ws.isAbsent);
                    
                    return {
                        studentId: student.id,
                        name: student.name,
                        tokenNumber: student.tokenNumber,
                        id: '',
                        worksheetNumber: recommendedWorksheetNumber,
                        grade: '',
                        existing: false,
                        isAbsent: false,
                        isRepeated: false,
                        isIncorrectGrade: false,
                        isNew: !hasHistory
                    };
                } catch (error) {
                    return {
                        studentId: student.id,
                        name: student.name,
                        tokenNumber: student.tokenNumber,
                        id: '',
                        worksheetNumber: 0,
                        grade: '',
                        existing: false,
                        isAbsent: false,
                        isRepeated: false,
                        isIncorrectGrade: false,
                        isNew: !studentsWithHistory.get(student.id)
                    };
                }
            }));

            setStudentGrades(grades);
        } catch (error) {
            toast.error('Failed to refresh student data');
        } finally {
            setIsFetchingTableData(false);
        }
    };

    const getRecommendedWorksheetNumber = async (
        classId: string, 
        studentId: string, 
        currentDate: string,
        currentWorksheetNumber: number
    ): Promise<number> => {
        try {
            if (currentWorksheetNumber > 0) {
                return currentWorksheetNumber;
            }
            
            const futureDate = new Date();
            futureDate.setFullYear(futureDate.getFullYear() + 1); // One year in the future
            
            const allWorksheets = await worksheetAPI.getPreviousWorksheets(
                classId,
                studentId, 
                futureDate.toISOString().split('T')[0] // This will get ALL worksheets
            );
            
            if (!allWorksheets || allWorksheets.length === 0) {
                return 0;
            }
            
            // Sort worksheets by date (most recent first)
            const sortedWorksheets = allWorksheets.sort((a, b) => {
                const dateA = new Date(a.submittedOn || '').getTime();
                const dateB = new Date(b.submittedOn || '').getTime();
                return dateB - dateA;
            });
            
            // Find the most recent worksheet that is not absent and has a grade
            const latestValidWorksheet = sortedWorksheets.find(ws => 
                !ws.isAbsent && 
                ws.grade !== null && 
                ws.grade !== undefined && 
                ws.grade !== 0
            );
            
            // If no valid worksheets found, start with worksheet 0
            if (!latestValidWorksheet) {
                return 0;
            }
            
            const score = latestValidWorksheet.grade || 0;
            const worksheetNumber = latestValidWorksheet.template?.worksheetNumber || 0;
            
            // If the most recent worksheet has a score >= 32, increment the worksheet number
            if (score >= PROGRESSION_THRESHOLD) {
                const newWorksheetNumber = worksheetNumber + 1;
                return newWorksheetNumber;
            } else {
                // If the most recent worksheet has a score < 32, repeat the same worksheet
                return worksheetNumber;
            }
        } catch (error) {
            console.error('Error getting recommended worksheet number:', error);
            return 0;
        }
    };

    const handleSaveStudent = async (grade: StudentGrade) => {
            try {
                const currentStudentData = studentGrades.find(g => g.studentId === grade.studentId);
                if (!currentStudentData) {
                    toast.error('Student data not found');
                    return;
                }

                const worksheetNumber = currentStudentData.worksheetNumber;
                const gradeValue = typeof currentStudentData.grade === 'string' ? currentStudentData.grade.trim() : '';
                
                const isValidWorksheetNumber = worksheetNumber && worksheetNumber > 0;
                const isValidGrade = gradeValue !== '' && !isNaN(parseFloat(gradeValue));
                
                const isAbsent = currentStudentData.isAbsent;
                
                let updatedGrade = { ...currentStudentData };
                let shouldSave = false;
                let shouldDelete = false;
                
                if (isValidWorksheetNumber && isValidGrade && isAbsent) {
                    updatedGrade = {
                        ...updatedGrade,
                        isAbsent: false
                    };
                }
                
                if (updatedGrade.isAbsent) {
                    shouldSave = true;
                    updatedGrade = {
                        ...updatedGrade,
                        worksheetNumber: 0,
                        grade: "",
                        isRepeated: false
                    };
                } else if (isValidWorksheetNumber && isValidGrade) {
                    const numericGrade = parseFloat(gradeValue);
                    if (numericGrade < 0 || numericGrade > 40) {
                        toast.error(`Grade for ${updatedGrade.name} must be between 0 and 40`);
                        return;
                    }
                    shouldSave = true;
                    updatedGrade = {
                        ...updatedGrade,
                        isAbsent: false
                    };
                } else if (!isValidWorksheetNumber && !isValidGrade) {
                    if (updatedGrade.existing && updatedGrade.id) {
                        shouldDelete = true;
                    } else {
                        toast.info(`No changes to save for ${updatedGrade.name}.`);
                        return;
                    }
                } else {
                    toast.warning(`${updatedGrade.name} has incomplete data. Please fill in both Worksheet# and Grade, or mark as absent.`);
                    return;
                }            if (shouldDelete) {
                await worksheetAPI.deleteGradedWorksheet(updatedGrade.id);
                toast.success(`Record for ${updatedGrade.name} removed successfully`);
                
                setStudentGrades(prevGrades => prevGrades.map(g => {
                    if (g.studentId === updatedGrade.studentId) {
                        return {
                            ...g,
                            id: '',
                            worksheetNumber: 0,
                            grade: '',
                            existing: false,
                            isAbsent: false,
                            isRepeated: false
                        };
                    }
                    return g;
                }));
                
                await fetchStudentData(updatedGrade.studentId);
                return;
            }

            if (shouldSave) {
                const data = {
                    classId: selectedClass,
                    studentId: updatedGrade.studentId,
                    worksheetNumber: updatedGrade.isAbsent ? 0 : updatedGrade.worksheetNumber,
                    grade: updatedGrade.isAbsent ? 0 : parseFloat(updatedGrade.grade),
                    submittedOn: new Date(submittedOn).toISOString(),
                    isAbsent: updatedGrade.isAbsent,
                    isRepeated: updatedGrade.isAbsent ? false : (updatedGrade.isRepeated || false),
                    isIncorrectGrade: updatedGrade.isAbsent ? false : (updatedGrade.isIncorrectGrade || false),
                    notes: updatedGrade.isAbsent ? 'Student absent' : undefined
                };

                if (updatedGrade.existing && updatedGrade.id) {
                    await worksheetAPI.updateGradedWorksheet(updatedGrade.id, data);
                } else {
                    await worksheetAPI.createGradedWorksheet(data);
                }

                // Track if a student with incorrect grade was saved
                if (data.isIncorrectGrade) {
                    posthog.capture('incorrect_grade_student_saved', {
                        student_name: updatedGrade.name,
                        student_token: updatedGrade.tokenNumber,
                        worksheet_number: data.worksheetNumber,
                        grade: data.grade,
                        is_absent: data.isAbsent,
                        is_repeated: data.isRepeated,
                        action: updatedGrade.existing ? 'update' : 'create',
                        page: 'grade_worksheet_individual'
                    });
                }

                toast.success(`Grade for ${updatedGrade.name} saved successfully`);

                setStudentGrades(prevGrades => prevGrades.map(g =>
                    g.studentId === updatedGrade.studentId ? updatedGrade : g
                ));

                await fetchStudentData(updatedGrade.studentId);
            }

        } catch (error) {
            toast.error(`Failed to save grade for ${grade.name}`);
        }
    };

    const fetchStudentData = async (studentId: string) => {
        try {
            const worksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                selectedClass,
                studentId,
                submittedOn
            );

            const isAbsent = worksheet ? !!worksheet.isAbsent : false;

            setStudentGrades(prevGrades => prevGrades.map(g => {
                if (g.studentId === studentId) {
                    return {
                        ...g,
                        id: worksheet?.id || g.id,
                        worksheetNumber: isAbsent ? 0 : (worksheet?.template?.worksheetNumber || 0),
                        grade: isAbsent ? '' : (worksheet?.grade?.toString() || ''),
                        existing: !!worksheet,
                        isAbsent: isAbsent,
                        isRepeated: isAbsent ? false : (worksheet?.isRepeated || false),
                        isIncorrectGrade: isAbsent ? false : (worksheet?.isIncorrectGrade || false)
                    };
                }
                return g;
            }));
        } catch (error) {
            toast.error(`Failed to refresh data for student`);
        }
    };

    const handleSave = async () => {
        setIsSaving(true);
        let incompleteEntries: StudentGrade[] = [];
        let toSave: any[] = [];
        let toDelete: string[] = [];

        try {
            const updatedGrades = [...studentGrades];
            
            studentGrades.forEach((grade, index) => {                const worksheetNumber = grade.worksheetNumber;
                const gradeValue = typeof grade.grade === 'string' ? grade.grade.trim() : '';
                
                const isValidWorksheetNumber = worksheetNumber && worksheetNumber > 0;
                const isValidGrade = gradeValue !== '' && !isNaN(parseFloat(gradeValue));
                
                const isAbsent = grade.isAbsent;
                
                if (isValidWorksheetNumber && isValidGrade && isAbsent) {
                    updatedGrades[index] = {
                        ...updatedGrades[index],
                        isAbsent: false
                    };
                }
                  if (grade.isAbsent) {
                    const data = {
                        classId: selectedClass,
                        studentId: grade.studentId,
                        worksheetNumber: 0,
                        grade: 0,
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: true,
                        isRepeated: false,
                        isIncorrectGrade: false,
                        notes: 'Student absent'
                    };
                    
                    toSave.push({ 
                        id: grade.id, 
                        studentId: grade.studentId,
                        existing: grade.existing, 
                        data: data, 
                        name: grade.name 
                    });
                } else if (isValidWorksheetNumber && isValidGrade) {
                    const numericGrade = parseFloat(gradeValue);
                    if (numericGrade < 0 || numericGrade > 40) {
                        incompleteEntries.push(grade);
                        return;
                    }
                    
                    const data = {
                        classId: selectedClass,
                        studentId: grade.studentId,
                        worksheetNumber: worksheetNumber,
                        grade: numericGrade,
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: false,
                        isRepeated: grade.isRepeated || false,
                        isIncorrectGrade: grade.isIncorrectGrade || false,
                        notes: undefined
                    };
                    
                    toSave.push({ 
                        id: grade.id, 
                        studentId: grade.studentId,
                        existing: grade.existing, 
                        data: data, 
                        name: grade.name 
                    });
                    
                    updatedGrades[index] = {
                        ...updatedGrades[index],
                        isAbsent: false
                    };
                } else if (!isValidWorksheetNumber && !isValidGrade) {
                    if (grade.existing && grade.id) {
                        toDelete.push(grade.id);
                    }
                } else {
                    incompleteEntries.push(grade);
                }
            });

            // Instead of requiring all incomplete entries to be filled, just warn about them
            // and only save the complete ones
            if (incompleteEntries.length > 0) {
                const incompleteNames = incompleteEntries.map(g => g.name).join(', ');
                console.log(`Warning: ${incompleteEntries.length} students have incomplete data: ${incompleteNames}`);
                // Don't return early - continue with saving the complete ones
            }

            // If no students are ready to save and no deletions needed, inform the user
            if (toSave.length === 0 && toDelete.length === 0) {
                if (incompleteEntries.length > 0) {
                    const incompleteNames = incompleteEntries.map(g => g.name).join(', ');
                    toast.error(`No students ready to save. Please fill in both Worksheet# and Grade for: ${incompleteNames}, or mark them as absent.`);
                } else {
                    toast.info('No changes to save.');
                }
                setIsSaving(false);
                return;
            }

            if (toDelete.length > 0) {
                for (const id of toDelete) {
                    try {
                        await worksheetAPI.deleteGradedWorksheet(id);
                        await new Promise(resolve => setTimeout(resolve, 50));
                    } catch (error) {
                        toast.error(`Error removing worksheet record`);
                    }
                }
                toast.info(`${toDelete.length} blank existing record(s) removed.`);
            }
            
            const saveResults: {
                success: boolean;
                studentId: string;
                result?: any;
                data?: any;
                error?: unknown;
            }[] = [];
            
            for (let i = 0; i < toSave.length; i++) {
                const item = toSave[i];
                try {
                    let result;
                    if (item.existing && item.id) {
                        result = await worksheetAPI.updateGradedWorksheet(item.id, item.data);
                    } else {
                        result = await worksheetAPI.createGradedWorksheet(item.data);
                    }
                    
                    saveResults.push({
                        success: true,
                        studentId: item.studentId,
                        result,
                        data: item.data
                    });
                    
                    // Track if a student with incorrect grade was saved in bulk
                    if (item.data.isIncorrectGrade) {
                        posthog.capture('incorrect_grade_student_saved', {
                            student_name: item.name,
                            student_token: updatedGrades.find(g => g.studentId === item.studentId)?.tokenNumber,
                            worksheet_number: item.data.worksheetNumber,
                            grade: item.data.grade,
                            is_absent: item.data.isAbsent,
                            is_repeated: item.data.isRepeated,
                            action: item.existing ? 'update' : 'create',
                            page: 'grade_worksheet_bulk'
                        });
                    }
                    
                    await new Promise(resolve => setTimeout(resolve, 200));
                } catch (error) {
                    toast.error(`Error saving grade for ${item.name}`);
                    saveResults.push({
                        success: false,
                        studentId: item.studentId,
                        error
                    });
                }
            }

            const successCount = saveResults.filter(r => r.success).length;
            const failedCount = saveResults.length - successCount;
            
            if (successCount > 0) {
                let message = `${successCount} grade(s) saved successfully`;
                
                if (incompleteEntries.length > 0) {
                    const incompleteNames = incompleteEntries.slice(0, 3).map(g => g.name).join(', ');
                    const remainingCount = incompleteEntries.length - 3;
                    message += `. ${incompleteEntries.length} student${incompleteEntries.length !== 1 ? 's have' : ' has'} incomplete data (${incompleteNames}${remainingCount > 0 ? ` and ${remainingCount} more` : ''})`;
                }
                
                if (failedCount > 0) {
                    message += `. ${failedCount} failed to save`;
                }
                
                toast.success(message);
                
                // Track bulk save with incorrect grades summary
                const incorrectGradeCount = saveResults
                    .filter(r => r.success && r.data?.isIncorrectGrade)
                    .length;
                
                if (incorrectGradeCount > 0) {
                    posthog.capture('incorrect_grade_bulk_save', {
                        total_students_saved: successCount,
                        incorrect_grade_count: incorrectGradeCount,
                        total_failed: failedCount,
                        page: 'grade_worksheet_bulk'
                    });
                }
                
                setStudentGrades(updatedGrades);
                
                setTimeout(async () => {
                    try {
                        await fetchStudentsAndWorksheets();
                    } catch (error) {
                        toast.error('Error refreshing data after save');
                    }
                }, 2000);
            } else if (toDelete.length === 0 && successCount === 0) {
                toast.info("No changes needed.");
            } else if (failedCount > 0) {
                toast.error(`Failed to save ${failedCount} grade(s). Please try again.`);
            }
        } catch (error: any) {
            toast.error(`Failed to save grades. ${error.message || ''}`);
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