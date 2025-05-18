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
import { 
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "@/components/ui/tooltip";
import { InfoIcon } from 'lucide-react';

// Threshold for worksheet progression (80% of 40)
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
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingTableData, setIsFetchingTableData] = useState(false);

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
            setIsFetchingTableData(true);
            
            const studentsData = await classAPI.getClassStudents(selectedClass);
            setStudents(studentsData);
            
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
                    
                    // Changed default behavior: students should NOT be marked absent by default
                    let shouldBeAbsent = false;
                    
                    if (recommendedWorksheetNumber > 0) {
                        shouldBeAbsent = false;
                    }
                    
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
            
            const selectedDate = new Date(currentDate);
            const today = new Date();
            today.setHours(0, 0, 0, 0);
            selectedDate.setHours(0, 0, 0, 0);
            
            const previousWorksheets = await worksheetAPI.getPreviousWorksheets(
                classId,
                studentId, 
                currentDate
            );
            
            if (!previousWorksheets || previousWorksheets.length === 0) {
                return 0;
            }
            
            const sortedWorksheets = previousWorksheets.sort((a, b) => {
                const dateA = new Date(a.submittedOn || '').getTime();
                const dateB = new Date(b.submittedOn || '').getTime();
                return dateB - dateA;
            });
            
            const allPreviousAreAbsent = sortedWorksheets.every(ws => !!ws.isAbsent);
            
            const latestValidWorksheet = sortedWorksheets.find(ws => !ws.isAbsent);
            
            if (allPreviousAreAbsent) {
                return 0;
            }
            
            if (!latestValidWorksheet) {
                return 0;
            }
            
            const score = latestValidWorksheet.grade || 0;
            const worksheetNumber = latestValidWorksheet.template?.worksheetNumber || 0;
            
            if (score >= PROGRESSION_THRESHOLD) {
                const newWorksheetNumber = worksheetNumber + 1;
                return newWorksheetNumber;
            } else {
                return worksheetNumber;
            }
        } catch (error) {
            return 0;
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

            // Validate the grade is within the allowed range
            if (!updatedGrade.isAbsent && (parseFloat(updatedGrade.grade) < 0 || parseFloat(updatedGrade.grade) > 40)) {
                toast.error(`Grade for ${updatedGrade.name} must be between 0 and 40`);
                return;
            }

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
                        isRepeated: isAbsent ? false : (worksheet?.isRepeated || false)
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
            
            studentGrades.forEach((grade, index) => {
                const worksheetNumber = grade.worksheetNumber;
                const gradeValue = typeof grade.grade === 'string' ? grade.grade.trim() : '';
                
                const isValidWorksheetNumber = worksheetNumber && worksheetNumber > 0;
                const isValidGrade = gradeValue !== '' && !isNaN(parseFloat(gradeValue));
                
                let shouldBeAbsent = grade.isAbsent;
                
                if (isValidWorksheetNumber && isValidGrade) {
                    if (shouldBeAbsent) {
                        shouldBeAbsent = false;
                        
                        updatedGrades[index] = {
                            ...updatedGrades[index],
                            isAbsent: false
                        };
                    }
                }
                
                if (shouldBeAbsent) {
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

            if (incompleteEntries.length > 0) {
                const incompleteNames = incompleteEntries.map(g => g.name).join(', ');
                toast.error(`Please fill in both Worksheet# and Grade for: ${incompleteNames}, or mark them as absent.`);
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
                if (failedCount > 0) {
                    toast.success(`${successCount} grade(s) saved successfully. ${failedCount} failed.`);
                } else {
                    toast.success(`${successCount} grade(s) saved successfully`);
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