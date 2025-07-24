'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { classAPI, worksheetAPI } from '@/lib/api';
import { StudentWorksheetCard } from './student-worksheet-card';
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

interface QuestionScore {
    question_number: number;
    question: string;
    student_answer: string;
    correct_answer: string;
    points_earned: number;
    max_points: number;
    is_correct: boolean;
    feedback: string;
}

interface GradingDetails {
    total_possible: number;
    grade_percentage: number;
    total_questions: number;
    correct_answers: number;
    wrong_answers: number;
    unanswered: number;
    question_scores: QuestionScore[];
    wrong_questions: QuestionScore[];
    correct_questions: QuestionScore[];
    unanswered_questions: QuestionScore[];
    overall_feedback: string;
}

interface StudentWorksheet {
    studentId: string;
    name: string;
    tokenNumber: string;
    worksheetNumber: number;
    isAbsent: boolean;
    isCorrectGrade?: boolean;
    isIncorrectGrade?: boolean;
    grade: string;
    isUploading: boolean;
    isRepeated?: boolean;
    page1File?: File | null;
    page2File?: File | null;
    gradingDetails?: GradingDetails;
    wrongQuestionNumbers?: string; // Comma-separated wrong question numbers
    
    id?: string;
    existing?: boolean;
}


const sortStudentsByTokenNumber = <T extends { tokenNumber: string }>(students: T[]): T[] => {
    return [...students].sort((a, b) => {
        const parseToken = (token: string) => {
            const yearSMatch = token.match(/^(\d+)S(\d+)$/);
            if (yearSMatch) {
                const year = parseInt(yearSMatch[1]);
                const number = parseInt(yearSMatch[2]);
                return { type: 'yearS' as const, year, number, original: token };
            }
            
            const pureNumber = parseInt(token);
            if (!isNaN(pureNumber) && token === pureNumber.toString()) {
                return { type: 'number' as const, number: pureNumber, original: token };
            }
            
            return { type: 'string' as const, original: token };
        };
        
        const aParsed = parseToken(a.tokenNumber);
        const bParsed = parseToken(b.tokenNumber);
        
        const typeOrder = { number: 0, yearS: 1, string: 2 };
        const aTypeOrder = typeOrder[aParsed.type] || 2;
        const bTypeOrder = typeOrder[bParsed.type] || 2;
        
        if (aTypeOrder !== bTypeOrder) {
            return aTypeOrder - bTypeOrder;
        }
        
        if (aParsed.type === 'number' && bParsed.type === 'number') {
            return aParsed.number - bParsed.number;
        } else if (aParsed.type === 'yearS' && bParsed.type === 'yearS') {
            if (aParsed.year !== bParsed.year) {
                return aParsed.year - bParsed.year;
            }
            return aParsed.number - bParsed.number;
        } else {
            return aParsed.original.localeCompare(bParsed.original);
        }
    });
};


export default function UploadWorksheetPage() {
    const { user } = useAuth();
    const router = useRouter();
    const posthog = usePostHog();
    const [classes, setClasses] = useState<Class[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingTableData, setIsFetchingTableData] = useState(false);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [students, setStudents] = useState<Student[]>([]);
    const [submittedOn, setSubmittedOn] = useState<string>(new Date().toISOString().split('T')[0]);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [studentWorksheets, setStudentWorksheets] = useState<StudentWorksheet[]>([]);

    
    const sortedStudentWorksheets = useMemo(() => {
        return sortStudentsByTokenNumber(studentWorksheets);
    }, [studentWorksheets]);

    // Filtered worksheets based on search term
    const filteredStudentWorksheets = useMemo(() => {
        if (!searchTerm.trim()) {
            return sortedStudentWorksheets;
        }
        
        const lowercaseSearch = searchTerm.toLowerCase().trim();
        return sortedStudentWorksheets.filter(worksheet => 
            worksheet.name.toLowerCase().includes(lowercaseSearch) ||
            worksheet.tokenNumber.toLowerCase().includes(lowercaseSearch)
        );
    }, [sortedStudentWorksheets, searchTerm]);

    
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
        const fetchStudentsAndWorksheets = async () => {
            if (!selectedClass) {
                setStudents([]);
                setStudentWorksheets([]);
                return;
            }

            try {
                setIsFetchingTableData(true);
                
                const studentsData = await classAPI.getClassStudents(selectedClass);
                
                
                const sortedStudents = sortStudentsByTokenNumber(studentsData);
                setStudents(sortedStudents);

                const selectedDate = new Date(submittedOn);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                selectedDate.setHours(0, 0, 0, 0);
                
                const studentsWithHistory = new Map<string, boolean>();
                
                const worksheets = await Promise.all(sortedStudents.map(async (student) => {
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
                                isCorrectGrade: worksheet.isCorrectGrade || false,
                                isIncorrectGrade: worksheet.isIncorrectGrade || false,
                                isNew: false,
                                isUploading: false,
                                page1File: null,
                                page2File: null,
                                gradingDetails: worksheet.gradingDetails || undefined
                            };
                        }
                        
                        
                        // Get ALL worksheets for this student to find the most recent one with a grade >= 32
                        // We use a future date to ensure we get all worksheets including today's and future ones
                        const futureDate = new Date();
                        futureDate.setFullYear(futureDate.getFullYear() + 1); // One year in the future
                        
                        const allWorksheets = await worksheetAPI.getPreviousWorksheets(
                            selectedClass,
                            student.id, 
                            futureDate.toISOString().split('T')[0] // This will get ALL worksheets
                        );
                        
                        const hasHistory = allWorksheets && allWorksheets.length > 0;
                        studentsWithHistory.set(student.id, hasHistory);
                        
                        // Sort worksheets by date (most recent first)
                        const sortedWorksheets = allWorksheets?.sort((a, b) => {
                            const dateA = new Date(a.submittedOn || '').getTime();
                            const dateB = new Date(b.submittedOn || '').getTime();
                            return dateB - dateA;
                        }) || [];
                        
                        // Find the most recent worksheet that is not absent and has a grade
                        const latestValidWorksheet = sortedWorksheets.find(ws => 
                            !ws.isAbsent && 
                            ws.grade !== null && 
                            ws.grade !== undefined && 
                            ws.grade !== 0
                        );
                        
                        let recommendedWorksheetNumber = 0;
                        
                        if (latestValidWorksheet) {
                            const score = latestValidWorksheet.grade || 0;
                            const worksheetNumber = latestValidWorksheet.template?.worksheetNumber || 0;
                            
                            // If the most recent worksheet has a score >= PROGRESSION_THRESHOLD, increment the worksheet number
                            if (score >= PROGRESSION_THRESHOLD) {
                                recommendedWorksheetNumber = worksheetNumber + 1;
                            } else {
                                // If the most recent worksheet has a score < 32, repeat the same worksheet
                                recommendedWorksheetNumber = worksheetNumber;
                            }
                        }
                        
                        // Check if this worksheet number has been done before to determine if it's repeated
                        const isRepeatedWorksheet = allWorksheets && allWorksheets.some(pw => 
                            !pw.isAbsent && pw.template?.worksheetNumber === recommendedWorksheetNumber
                        );
                        
                        return {
                            studentId: student.id,
                            name: student.name,
                            tokenNumber: student.tokenNumber,
                            id: '',
                            worksheetNumber: recommendedWorksheetNumber,
                            grade: '',
                            existing: false,
                            isAbsent: false,
                            isRepeated: !!isRepeatedWorksheet,
                            isCorrectGrade: false,
                            isIncorrectGrade: false,
                            isNew: !hasHistory,
                            isUploading: false,
                            page1File: null,
                            page2File: null
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
                            isCorrectGrade: false,
                            isIncorrectGrade: false,
                            isNew: !studentsWithHistory.get(student.id),
                            isUploading: false,
                            page1File: null,
                            page2File: null
                        };
                    }
                }));

                setStudentWorksheets(worksheets);
            } catch (error) {
                toast.error('Failed to load student data');
            } finally {
                setIsFetchingTableData(false);
            }
        };

        fetchStudentsAndWorksheets();
    }, [selectedClass, submittedOn]);    const handlePageFileChange = (studentId: string, pageNumber: number, file: File | null) => {
        setStudentWorksheets(prev => prev.map(sw => {
            if (sw.studentId === studentId) {
                const updated = { ...sw };
                
                
                if (pageNumber === 1) {
                    updated.page1File = file;
                } else if (pageNumber === 2) {
                    updated.page2File = file;
                }
                
                return updated;
            }
            return sw;
        }));
    };    const handleUpdateWorksheet = async (sortedIndex: number, field: string, value: any) => {
        
        const sortedWorksheet = sortedStudentWorksheets[sortedIndex];
        const originalIndex = studentWorksheets.findIndex(w => w.studentId === sortedWorksheet.studentId);
        
        if (originalIndex === -1) return;
        
        const newWorksheets = [...studentWorksheets];        
        if (field === "isAbsent" && value === true) {
            newWorksheets[originalIndex] = {
                ...newWorksheets[originalIndex],
                isAbsent: true,
                worksheetNumber: 0,  
                grade: '',           
                page1File: null,     
                page2File: null,     
                isRepeated: false,
                isIncorrectGrade: false
            };
        } else if (field === "worksheetNumber") {
            // When worksheet number changes, check if it's a repeat
            const newWorksheetNumber = value;
            let isRepeated = false;
            
            if (newWorksheetNumber > 0) {
                try {
                    // Get ALL worksheets for this student to check if this worksheet number was done before
                    const futureDate = new Date();
                    futureDate.setFullYear(futureDate.getFullYear() + 1); // One year in the future
                    
                    const allWorksheets = await worksheetAPI.getPreviousWorksheets(
                        selectedClass,
                        sortedWorksheet.studentId, 
                        futureDate.toISOString().split('T')[0] // This will get ALL worksheets
                    );
                    
                    isRepeated = allWorksheets && allWorksheets.some(pw => 
                        !pw.isAbsent && pw.template?.worksheetNumber === newWorksheetNumber
                    );
                } catch (error) {
                    console.error('Error checking if worksheet is repeated:', error);
                }
            }
            
            newWorksheets[originalIndex] = {
                ...newWorksheets[originalIndex],
                worksheetNumber: newWorksheetNumber,
                isRepeated: !!isRepeated,
                isAbsent: false
            };
        } else {
            (newWorksheets[originalIndex] as any)[field] = value;
                
            if ((field === "page1File" || field === "page2File" || (field === "grade" && value))) {
                newWorksheets[originalIndex].isAbsent = false;
            }
        }
        
        setStudentWorksheets(newWorksheets);
    };const handleUpload = async (worksheet: StudentWorksheet) => {
        if (worksheet.isAbsent) {
            return;
        }

        if (!worksheet.worksheetNumber) {
            toast.error('Please enter a worksheet number');
            return;
        }

        
        if (!worksheet.page1File && !worksheet.page2File) {
            toast.error('Please upload at least one page image');
            return;
        }

        
        setStudentWorksheets(prev => prev.map(sw => 
            sw.studentId === worksheet.studentId ? { ...sw, isUploading: true } : sw
        ));        try {
            
            const formData = new FormData();
            
            
            formData.append('classId', selectedClass);
            formData.append('studentId', worksheet.studentId);
            formData.append('worksheetNumber', worksheet.worksheetNumber.toString());
            formData.append('submittedOn', submittedOn);
            
            
            formData.append('token_no', worksheet.tokenNumber);
            formData.append('worksheet_name', worksheet.worksheetNumber.toString());
            
            
            if (worksheet.page1File) {
                formData.append('files', worksheet.page1File);
            }
            if (worksheet.page2File) {
                formData.append('files', worksheet.page2File);
            }

            
            const API_URL = process.env.NEXT_PUBLIC_API_URL;
            const response = await fetch(`${API_URL}/worksheet-processing/process`, {
                method: 'POST',
                body: formData,
                headers: {
                    
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
              
            const grade = result.grade || result.totalScore || 0;
            
            // Store detailed grading information
            const gradingDetails: GradingDetails = {
                total_possible: result.total_possible || 0,
                grade_percentage: result.grade_percentage || 0,
                total_questions: result.total_questions || 0,
                correct_answers: result.correct_answers || 0,
                wrong_answers: result.wrong_answers || 0,
                unanswered: result.unanswered || 0,
                question_scores: result.question_scores || [],
                wrong_questions: result.wrong_questions || [],
                correct_questions: result.correct_questions || [],
                unanswered_questions: result.unanswered_questions || [],
                overall_feedback: result.overall_feedback || ''
            };
            
            // Auto-populate wrong question numbers from grading details
            const wrongNumbers = [...(result.wrong_questions || []).map((q: any) => q.question_number), 
                                  ...(result.unanswered_questions || []).map((q: any) => q.question_number)]
                                  .sort((a, b) => a - b);
            const wrongQuestionNumbers = wrongNumbers.length > 0 ? wrongNumbers.join(', ') : '';
            
            setStudentWorksheets(prev => prev.map(sw => 
                sw.studentId === worksheet.studentId 
                    ? { 
                        ...sw, 
                        grade: grade.toString(), 
                        isUploading: false,
                        gradingDetails: gradingDetails,
                        wrongQuestionNumbers: wrongQuestionNumbers, // Auto-populate from AI grading
                        // Clear uploaded files after processing
                        page1File: null,
                        page2File: null
                    } 
                    : sw
            ));
            
            toast.success(`Worksheet for ${worksheet.name} processed successfully! Grade: ${grade}`);
            return { success: true };
        } catch (error) {
            toast.error('Failed to upload or grade worksheet');
            
            
            setStudentWorksheets(prev => prev.map(sw => 
                sw.studentId === worksheet.studentId ? { ...sw, isUploading: false } : sw
            ));
            
            return { success: false };
        }
    };    
    const handleBatchProcess = async () => {
        // Use filtered worksheets when search is active, otherwise use all worksheets
        const worksheetsToProcess = searchTerm.trim() ? filteredStudentWorksheets : studentWorksheets;
        const studentsWithFiles = worksheetsToProcess.filter(sw => 
            !sw.isAbsent && (sw.page1File || sw.page2File) && sw.worksheetNumber
        );
          if (studentsWithFiles.length === 0) {
            toast.error('No worksheets to process. Please upload page images and assign worksheet numbers.');
            return;
        }
        
        
        setStudentWorksheets(prev => prev.map(sw => 
            studentsWithFiles.some(s => s.studentId === sw.studentId) 
                ? { ...sw, isUploading: true } 
                : sw
        ));
        
        try {
            
        const batchSize = 10; 
        let successful = 0;
        let failed = 0;            
            for (let i = 0; i < studentsWithFiles.length; i += batchSize) {
                const currentBatch = studentsWithFiles.slice(i, i + batchSize);
                const batchNumber = Math.floor(i / batchSize) + 1;
                const totalBatches = Math.ceil(studentsWithFiles.length / batchSize);
                
                const batchResults = await Promise.allSettled(
                    currentBatch.map(worksheet => handleUpload(worksheet))
                );
                
                
                batchResults.forEach((result, index) => {
                    if (result.status === 'fulfilled' && result.value && result.value.success) {
                        successful++;
                    } else {
                        failed++;
                    }
                });
                
                if (i + batchSize < studentsWithFiles.length) {
                    await new Promise(resolve => setTimeout(resolve, 1000)); 
                }
            }
            
            if (successful > 0) {
                toast.success(`Successfully processed ${successful} worksheet${successful !== 1 ? 's' : ''}!`);
            }
            
            if (failed > 0) {
                toast.error(`Failed to process ${failed} worksheet${failed !== 1 ? 's' : ''}.`);
            }
            
            if (successful === 0 && failed === 0) {
                toast.info('No worksheets were processed.');
            }
        } catch (error) {
            toast.error('Failed to process worksheets');
        }
    };

    
    const handleSaveStudent = async (worksheet: StudentWorksheet) => {
        if (!selectedClass) {
            toast.error('Please select a class first');
            return;
        }

        try {
            // Get the most up-to-date data for this student from the main state
            const currentStudentData = studentWorksheets.find(w => w.studentId === worksheet.studentId);
            if (!currentStudentData) {
                toast.error('Student data not found');
                return;
            }

            // Use the current state data instead of the passed worksheet parameter
            const worksheetNumber = currentStudentData.worksheetNumber;
            const gradeValue = typeof currentStudentData.grade === 'string' ? currentStudentData.grade.trim() : '';
            
            const isValidWorksheetNumber = worksheetNumber && worksheetNumber > 0;
            const isValidGrade = gradeValue !== '' && !isNaN(parseFloat(gradeValue));
            
            // Only use explicitly set absent status, never auto-mark as absent
            const isAbsent = currentStudentData.isAbsent;
            
            let shouldSave = false;
            let shouldDelete = false;
            
            // Determine what action to take based on the data state - using same logic as bulk save
            if (isAbsent) {
                // Student is marked as absent - always save this state
                shouldSave = true;
            } else if (isValidWorksheetNumber) {
                // For non-absent students, only require worksheet number (grade is optional)
                shouldSave = true;
            } else if (!isValidWorksheetNumber && !isValidGrade) {
                // Both fields are empty/invalid
                const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                    selectedClass,
                    currentStudentData.studentId,
                    submittedOn
                );
                
                if (existingWorksheet && existingWorksheet.id) {
                    // Delete existing record if both fields are cleared
                    shouldDelete = true;
                } else {
                    // For new records with no data, just inform and return
                    toast.info(`No changes to save for ${currentStudentData.name}.`);
                    return;
                }
            } else {
                // Incomplete data (no worksheet number but has grade) - warn but don't block
                toast.warning(`${currentStudentData.name} needs a worksheet number to save.`);
                return;
            }

            // Handle deletion case
            if (shouldDelete) {
                const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                    selectedClass,
                    currentStudentData.studentId,
                    submittedOn
                );
                
                if (existingWorksheet && existingWorksheet.id) {
                    await worksheetAPI.deleteGradedWorksheet(existingWorksheet.id);
                    toast.success(`Record for ${currentStudentData.name} removed successfully`);
                    
                    // Update local state to reflect deletion
                    setStudentWorksheets(prevWorksheets => prevWorksheets.map(w => {
                        if (w.studentId === currentStudentData.studentId) {
                            return {
                                ...w,
                                id: '',
                                worksheetNumber: 0,
                                grade: '',
                                existing: false,
                                isAbsent: false,
                                isRepeated: false
                            };
                        }
                        return w;
                    }));
                }
                return;
            }

            // Handle save case
            if (shouldSave) {
                if (isAbsent) {
                    // Save absent student
                    const data = {
                        classId: selectedClass,
                        studentId: currentStudentData.studentId,
                        worksheetNumber: 0, 
                        grade: 0, 
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: true,
                        isRepeated: false,
                        isCorrectGrade: false,
                        isIncorrectGrade: false,
                        notes: 'Student absent'
                    };

                    const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                        selectedClass, 
                        currentStudentData.studentId, 
                        submittedOn
                    );

                    if (existingWorksheet && existingWorksheet.id) {
                        await worksheetAPI.updateGradedWorksheet(existingWorksheet.id, data);
                    } else {
                        await worksheetAPI.createGradedWorksheet(data);
                    }

                    toast.success(`${currentStudentData.name} marked as absent and saved`);
                } else {
                    // Save non-absent student with worksheet number (grade is optional)
                    let gradeNumeric = 0;
                    if (isValidGrade) {
                        gradeNumeric = parseFloat(gradeValue);
                        if (gradeNumeric < 0 || gradeNumeric > 40) {
                            toast.error(`Grade for ${currentStudentData.name} must be between 0 and 40`);
                            return;
                        }
                    }

                    const data = {
                        classId: selectedClass,
                        studentId: currentStudentData.studentId,
                        worksheetNumber: currentStudentData.worksheetNumber,
                        grade: gradeNumeric,
                        submittedOn: new Date(submittedOn).toISOString(),
                        isAbsent: false,
                        isRepeated: currentStudentData.isRepeated || false,
                        isCorrectGrade: currentStudentData.isCorrectGrade || false,
                        isIncorrectGrade: currentStudentData.isIncorrectGrade || false,
                        gradingDetails: currentStudentData.gradingDetails || undefined,
                        wrongQuestionNumbers: currentStudentData.wrongQuestionNumbers || ''
                    };

                    const existingWorksheet = await worksheetAPI.getWorksheetByClassStudentDate(
                        selectedClass, 
                        currentStudentData.studentId, 
                        submittedOn
                    );

                    if (existingWorksheet && existingWorksheet.id) {
                        await worksheetAPI.updateGradedWorksheet(existingWorksheet.id, data);
                    } else {
                        await worksheetAPI.createGradedWorksheet(data);
                    }

                    // Track if a student with incorrect grade was saved individually
                    if (data.isIncorrectGrade) {
                        posthog.capture('incorrect_grade_student_saved', {
                            student_name: currentStudentData.name,
                            student_token: currentStudentData.tokenNumber,
                            worksheet_number: data.worksheetNumber,
                            grade: data.grade,
                            is_absent: data.isAbsent,
                            is_repeated: data.isRepeated,
                            action: existingWorksheet ? 'update' : 'create',
                            page: 'upload_worksheet_individual'
                        });
                    }

                    toast.success(`${currentStudentData.name}'s worksheet saved successfully`);
                }

                // Update local state to reflect the saved data
                setStudentWorksheets(prevWorksheets => prevWorksheets.map(w =>
                    w.studentId === currentStudentData.studentId ? { ...currentStudentData, existing: true } : w
                ));
            }

        } catch (error) {
            
            if (error instanceof Error) {
                if (error.message.includes('template')) {
                    toast.error(`Failed to save ${worksheet.name}: No template found for worksheet number ${worksheet.worksheetNumber}`);
                } else if (error.message.includes('grade')) {
                    toast.error(`Failed to save ${worksheet.name}: Invalid grade value`);
                } else {
                    toast.error(`Failed to save ${worksheet.name}: ${error.message}`);
                }
            } else {
                toast.error(`Failed to save ${worksheet.name}'s worksheet`);
            }
        }
    };

    
    const handleSaveAllChanges = async () => {
        setIsSaving(true);
        
        try {
            // Use filtered worksheets when search is active, otherwise use all worksheets
            const worksheetsToCheck = searchTerm.trim() ? filteredStudentWorksheets : studentWorksheets;
            // Filter students that can be saved
            const studentsToSave = worksheetsToCheck.filter(worksheet => {
                if (worksheet.isAbsent) {
                    return true; // Can always save absent students
                }
                
                // For non-absent students, require at least worksheet number
                return worksheet.worksheetNumber > 0;
            });

            if (studentsToSave.length === 0) {
                toast.error('No students to save. Please mark students as absent or assign worksheet numbers.');
                setIsSaving(false);
                return;
            }

            let savedCount = 0;
            let failedCount = 0;

            
            await Promise.all(studentsToSave.map(async (worksheet) => {
                try {
                    if (worksheet.isAbsent) {
                        
                        const data = {
                            classId: selectedClass,
                            studentId: worksheet.studentId,
                            worksheetNumber: 0, 
                            grade: 0, 
                            submittedOn: new Date(submittedOn).toISOString(),
                            isAbsent: true,
                            isRepeated: false,
                            isCorrectGrade: false,
                            isIncorrectGrade: false,
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
                        savedCount++;
                    } else {
                        
                        const gradeValue = parseFloat(worksheet.grade);
                        if (isNaN(gradeValue) || gradeValue < 0 || gradeValue > 40) {
                            failedCount++;
                            return;
                        }

                        
                        const data = {
                            classId: selectedClass,
                            studentId: worksheet.studentId,
                            worksheetNumber: worksheet.worksheetNumber,
                            grade: gradeValue,
                            submittedOn: new Date(submittedOn).toISOString(),
                            isAbsent: false,
                            isRepeated: worksheet.isRepeated || false,
                            isCorrectGrade: worksheet.isCorrectGrade || false,
                            isIncorrectGrade: worksheet.isIncorrectGrade || false
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
                        
                        // Track if a student with incorrect grade was saved in bulk
                        if (data.isIncorrectGrade) {
                            posthog.capture('incorrect_grade_student_saved', {
                                student_name: worksheet.name,
                                student_token: worksheet.tokenNumber,
                                worksheet_number: data.worksheetNumber,
                                grade: data.grade,
                                is_absent: data.isAbsent,
                                is_repeated: data.isRepeated,
                                action: existingWorksheet ? 'update' : 'create',
                                page: 'upload_worksheet_bulk'
                            });
                        }
                        
                        savedCount++;
                    }
                } catch (error) {
                    failedCount++;
                }
            }));
            
            
            // Inform user about the save results
            if (savedCount > 0) {
                let message = `Successfully saved ${savedCount} student${savedCount !== 1 ? 's' : ''}`;
                
                if (failedCount > 0) {
                    message += `. ${failedCount} failed to save`;
                }
                
                toast.success(message);
                
                // Track bulk save summary with incorrect grades count
                const incorrectGradeCount = studentsToSave.filter(w => w.isIncorrectGrade).length;
                if (incorrectGradeCount > 0) {
                    posthog.capture('incorrect_grade_bulk_save', {
                        total_students_saved: savedCount,
                        incorrect_grade_count: incorrectGradeCount,
                        total_failed: failedCount,
                        page: 'upload_worksheet_bulk'
                    });
                }
            }
            
            if (failedCount > 0 && savedCount === 0) {
                toast.error(`Failed to save ${failedCount} student${failedCount !== 1 ? 's' : ''}`);
            }
            
        } catch (error) {
            toast.error('Failed to save changes');
        } finally {
            setIsSaving(false);
        }
    };

    // Function to mark all students without grades as absent
    const handleMarkAllWithoutGradeAsAbsent = () => {
        // Use filtered worksheets when search is active, otherwise use all worksheets
        const worksheetsToCheck = searchTerm.trim() ? filteredStudentWorksheets : studentWorksheets;
        
        // Find students without grades (not absent and no grade - worksheet number doesn't matter)
        const studentsWithoutGrades = worksheetsToCheck.filter(worksheet => 
            !worksheet.isAbsent && 
            (!worksheet.grade || worksheet.grade.trim() === '')
        );

        if (studentsWithoutGrades.length === 0) {
            toast.info('No students without grades found to mark as absent.');
            return;
        }

        // Update state to mark these students as absent
        setStudentWorksheets(prev => prev.map(worksheet => {
            const shouldMarkAbsent = studentsWithoutGrades.some(s => s.studentId === worksheet.studentId);
            if (shouldMarkAbsent) {
                return {
                    ...worksheet,
                    isAbsent: true,
                    worksheetNumber: 0,
                    grade: '',
                    page1File: null,
                    page2File: null,
                    isRepeated: false,
                    isCorrectGrade: false,
                    isIncorrectGrade: false
                };
            }
            return worksheet;
        }));

        toast.success(`Marked ${studentsWithoutGrades.length} student${studentsWithoutGrades.length !== 1 ? 's' : ''} as absent.`);
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
                    <p className="text-sm text-gray-600">
                        Select class and date, then upload and grade worksheets for each student.
                    </p>
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
                    </div>

                    {selectedClass && !isFetchingTableData && sortedStudentWorksheets.length > 0 && (
                        <div className="space-y-2">
                            <div className="flex justify-between items-center">
                                <Label htmlFor="search" className="text-sm font-medium">Search Students</Label>
                                <Button
                                    onClick={handleMarkAllWithoutGradeAsAbsent}
                                    variant="outline"
                                    size="sm"
                                    className="text-xs"
                                    disabled={isSaving}
                                >
                                    Mark Ungraded as Absent
                                    {(() => {
                                        const worksheetsToCheck = searchTerm.trim() ? filteredStudentWorksheets : studentWorksheets;
                                        const ungradedCount = worksheetsToCheck.filter(worksheet => 
                                            !worksheet.isAbsent && 
                                            (!worksheet.grade || worksheet.grade.trim() === '')
                                        ).length;
                                        return ungradedCount > 0 ? ` (${ungradedCount})` : '';
                                    })()}
                                </Button>
                            </div>
                            <div className="relative">
                                <Input
                                    id="search"
                                    type="text"
                                    placeholder="Search by name or token number..."
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    className="h-9 py-1 pr-8"
                                />
                                {searchTerm && (
                                    <button
                                        onClick={() => setSearchTerm('')}
                                        className="absolute right-2 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-gray-600"
                                        type="button"
                                    >
                                        ✕
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    {selectedClass && isFetchingTableData && (
                        <div className="flex justify-center items-center h-40">
                            <p>Loading student data...</p>
                        </div>
                    )}

                    {selectedClass && !isFetchingTableData && sortedStudentWorksheets.length > 0 && (
                        <>
                            {/* Scrollable Student Grid */}
                            <div className="max-h-[70vh] overflow-y-auto">
                                {filteredStudentWorksheets.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 p-2 md:p-0">
                                        {filteredStudentWorksheets.map((worksheet) => {
                                            // Find the original index in the full sorted array for updates
                                            const originalSortedIndex = sortedStudentWorksheets.findIndex(w => w.studentId === worksheet.studentId);
                                            return (
                                                <StudentWorksheetCard 
                                                    key={worksheet.studentId}
                                                    worksheet={worksheet}
                                                    index={originalSortedIndex}
                                                    onUpdate={handleUpdateWorksheet}
                                                    onPageFileChange={handlePageFileChange}
                                                    onUpload={handleUpload}
                                                    onSave={handleSaveStudent}
                                                />
                                            );
                                        })}
                                    </div>
                                ) : (
                                    <div className="flex justify-center items-center h-40 text-gray-500">
                                        <p>No students found matching &quot;{searchTerm}&quot;</p>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-col md:flex-row justify-end mt-4 space-y-2 md:space-y-0 md:space-x-3 px-2 md:px-0">
                                <Button
                                    onClick={handleBatchProcess}
                                    disabled={isSaving || sortedStudentWorksheets.some(ws => ws.isUploading) || 
                                             !filteredStudentWorksheets.some(ws => !ws.isAbsent && (ws.page1File || ws.page2File) && ws.worksheetNumber)}
                                    className="w-full md:w-auto"
                                    variant="secondary"
                                >
                                    AI Grade All {searchTerm.trim() ? `(${filteredStudentWorksheets.length})` : ''}
                                </Button>
                                <Button
                                    onClick={handleSaveAllChanges}
                                    disabled={isSaving || sortedStudentWorksheets.some(ws => ws.isUploading)}
                                    className="w-full md:w-auto"
                                >
                                    {isSaving ? 'Saving Changes...' : `Save All Changes ${searchTerm.trim() ? `(${filteredStudentWorksheets.length})` : ''}`}
                                </Button>
                            </div>
                            
                            <div className="text-sm text-muted-foreground px-2 md:px-0">
                                {searchTerm.trim() ? (
                                    <>Showing {filteredStudentWorksheets.length} of {sortedStudentWorksheets.length} students</>
                                ) : (
                                    <>Showing {sortedStudentWorksheets.length} students</>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
