'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { classAPI, worksheetAPI } from '@/lib/api';
import { gradingJobsAPI } from '@/lib/api/gradingJobs';
import { StudentWorksheetCard } from './student-worksheet-card';
import { AIGradingStatusBar } from '@/components/grading-jobs/AIGradingStatusBar';
import { usePostHog } from 'posthog-js/react';

const PROGRESSION_THRESHOLD = 32;

interface Class {
    id: string;
    name: string;
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
    wrongQuestionNumbers?: string;
    id?: string;
    existing?: boolean;
    jobId?: string;
    gradingStatus?: 'idle' | 'uploading' | 'queued' | 'pending' | 'processing' | 'completed' | 'failed';
    gradingError?: string;
    // Multi-worksheet support
    worksheetEntryId: string; // Unique identifier for this worksheet entry
    worksheetEntryIndex: number; // 0 for first worksheet, 1 for second, etc.
}


const sortStudentsByTokenNumber = <T extends { tokenNumber: string; worksheetEntryIndex?: number }>(students: T[]): T[] => {
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
            if (aParsed.number !== bParsed.number) {
                return aParsed.number - bParsed.number;
            }
        } else if (aParsed.type === 'yearS' && bParsed.type === 'yearS') {
            if (aParsed.year !== bParsed.year) {
                return aParsed.year - bParsed.year;
            }
            if (aParsed.number !== bParsed.number) {
                return aParsed.number - bParsed.number;
            }
        } else {
            const strCompare = aParsed.original.localeCompare(bParsed.original);
            if (strCompare !== 0) return strCompare;
        }

        // If same student (same token), sort by worksheetEntryIndex
        return (a.worksheetEntryIndex || 0) - (b.worksheetEntryIndex || 0);
    });
};

// Helper to generate unique worksheet entry IDs
const generateWorksheetEntryId = (studentId: string, index: number): string => {
    return `${studentId}-entry-${index}`;
};


export default function UploadWorksheetPage() {
    const { user } = useAuth();
    const posthog = usePostHog();
    const [classes, setClasses] = useState<Class[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingTableData, setIsFetchingTableData] = useState(false);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [submittedOn, setSubmittedOn] = useState<string>(new Date().toISOString().split('T')[0]);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [studentWorksheets, setStudentWorksheets] = useState<StudentWorksheet[]>([]);
    const [jobStatusKey, setJobStatusKey] = useState(0);


    const sortedStudentWorksheets = useMemo(() => {
        return sortStudentsByTokenNumber(studentWorksheets);
    }, [studentWorksheets]);

    const gradedCount = useMemo(() => {
        return studentWorksheets.filter(sw => !sw.isAbsent && sw.worksheetNumber > 0 && sw.grade !== '' && sw.grade !== undefined && sw.grade !== null).length;
    }, [studentWorksheets]);

    const totalStudents = studentWorksheets.length;

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

    // Memoized index map for O(1) lookup instead of O(n) findIndex
    const worksheetIndexMap = useMemo(() => {
        const map = new Map<string, number>();
        sortedStudentWorksheets.forEach((w, idx) => {
            map.set(w.worksheetEntryId, idx);
        });
        return map;
    }, [sortedStudentWorksheets]);

    // Memoized grouped worksheets by student
    const groupedWorksheetData = useMemo(() => {
        const groupedByStudent: Record<string, StudentWorksheet[]> = {};
        const seenStudents = new Set<string>();
        const uniqueStudentIds: string[] = [];

        filteredStudentWorksheets.forEach(worksheet => {
            if (!groupedByStudent[worksheet.studentId]) {
                groupedByStudent[worksheet.studentId] = [];
            }
            groupedByStudent[worksheet.studentId].push(worksheet);

            if (!seenStudents.has(worksheet.studentId)) {
                seenStudents.add(worksheet.studentId);
                uniqueStudentIds.push(worksheet.studentId);
            }
        });

        // Sort each group by entry index
        Object.values(groupedByStudent).forEach(group => {
            group.sort((a, b) => a.worksheetEntryIndex - b.worksheetEntryIndex);
        });

        return { groupedByStudent, uniqueStudentIds };
    }, [filteredStudentWorksheets]);


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
                setStudentWorksheets([]);
                return;
            }

            try {
                setIsFetchingTableData(true);

                // Fetch students and pending jobs in parallel
                const [studentsData, pendingJobsResponse] = await Promise.all([
                    classAPI.getClassStudents(selectedClass),
                    gradingJobsAPI.getJobsByClass(selectedClass, submittedOn).catch(() => ({ jobs: [] }))
                ]);

                // Create a map of pending/processing jobs by studentId+worksheetNumber
                const pendingJobsMap = new Map<string, { jobId: string; status: 'pending' | 'processing' | 'completed' | 'failed'; worksheetNumber: number }>();
                for (const job of (pendingJobsResponse.jobs || [])) {
                    if (job.status === 'pending' || job.status === 'processing') {
                        const key = `${job.studentId}-${job.worksheetNumber}`;
                        pendingJobsMap.set(key, {
                            jobId: job.jobId,
                            status: job.status,
                            worksheetNumber: job.worksheetNumber
                        });
                    }
                }

                const sortedStudents = sortStudentsByTokenNumber(studentsData);

                const selectedDate = new Date(submittedOn);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                selectedDate.setHours(0, 0, 0, 0);

                const studentsWithHistory = new Map<string, boolean>();

                // Use flatMap to handle multiple worksheets per student
                const worksheets: StudentWorksheet[] = (await Promise.all(sortedStudents.map(async (student) => {
                    try {
                        // Get ALL worksheets for this student on this date
                        const existingWorksheets = await worksheetAPI.getAllWorksheetsByClassStudentDate(
                            selectedClass,
                            student.id,
                            submittedOn
                        );

                        if (existingWorksheets && existingWorksheets.length > 0) {
                            // Return all existing worksheets as separate entries
                            return existingWorksheets.map((worksheet, idx) => {
                                const wsNumber = worksheet.isAbsent ? 0 : (worksheet.template?.worksheetNumber || 0);
                                const pendingJobKey = `${student.id}-${wsNumber}`;
                                const pendingJob = pendingJobsMap.get(pendingJobKey);

                                return {
                                    studentId: student.id,
                                    name: student.name,
                                    tokenNumber: student.tokenNumber,
                                    id: worksheet.id || '',
                                    worksheetNumber: wsNumber,
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
                                    gradingDetails: worksheet.gradingDetails || undefined,
                                    wrongQuestionNumbers: worksheet.wrongQuestionNumbers || undefined,
                                    worksheetEntryId: generateWorksheetEntryId(student.id, idx),
                                    worksheetEntryIndex: idx,
                                    // Set job status if there's a pending/processing job
                                    jobId: pendingJob?.jobId,
                                    gradingStatus: pendingJob?.status as 'pending' | 'processing' | undefined
                                };
                            });
                        }

                        // Get all worksheets up to the selected date (not a future date)
                        const endDate = new Date(submittedOn);
                        endDate.setHours(23, 59, 59, 999); // End of the selected day

                        const allWorksheets = await worksheetAPI.getPreviousWorksheets(
                            selectedClass,
                            student.id,
                            endDate.toISOString().split('T')[0]
                        );

                        const hasHistory = allWorksheets && allWorksheets.length > 0;
                        studentsWithHistory.set(student.id, hasHistory);

                        // Sort worksheets by date (most recent first)
                        const sortedWorksheets = allWorksheets?.sort((a, b) => {
                            const dateA = new Date(a.submittedOn || '').getTime();
                            const dateB = new Date(b.submittedOn || '').getTime();
                            return dateB - dateA;
                        }) || [];

                        // Find the most recent valid worksheet BEFORE the selected date
                        const selectedDateObj = new Date(submittedOn);
                        selectedDateObj.setHours(0, 0, 0, 0);

                        const latestValidWorksheetBeforeDate = sortedWorksheets.find(ws => {
                            const worksheetDate = new Date(ws.submittedOn || '');
                            worksheetDate.setHours(0, 0, 0, 0);

                            return !ws.isAbsent &&
                                ws.grade !== null &&
                                ws.grade !== undefined &&
                                ws.grade !== 0 &&
                                worksheetDate < selectedDateObj;
                        });

                        let recommendedWorksheetNumber = 0;
                        let isRepeatedWorksheet = false;

                        if (latestValidWorksheetBeforeDate) {
                            const score = latestValidWorksheetBeforeDate.grade || 0;
                            const worksheetNumber = latestValidWorksheetBeforeDate.template?.worksheetNumber || 0;

                            if (score >= PROGRESSION_THRESHOLD) {
                                // Student passed, increment to next worksheet
                                recommendedWorksheetNumber = worksheetNumber + 1;

                                // Check if this new worksheet number has been attempted before the selected date
                                isRepeatedWorksheet = allWorksheets && allWorksheets.some(pw => {
                                    const pwDate = new Date(pw.submittedOn || '');
                                    pwDate.setHours(0, 0, 0, 0);

                                    return !pw.isAbsent &&
                                        pw.template?.worksheetNumber === recommendedWorksheetNumber &&
                                        pwDate < selectedDateObj;
                                });
                            } else {
                                // Student didn't pass, repeat the same worksheet
                                recommendedWorksheetNumber = worksheetNumber;

                                // This is definitely a repeat since we found a previous attempt
                                isRepeatedWorksheet = true;
                            }
                        } else {
                            if (hasHistory) {
                                recommendedWorksheetNumber = 1;
                                isRepeatedWorksheet = false;
                            } else {
                                // Completely new student with no history
                                recommendedWorksheetNumber = 1;
                                isRepeatedWorksheet = false;
                            }
                        }

                        // Check if there's a pending job for this student
                        const pendingJobKey = `${student.id}-${recommendedWorksheetNumber}`;
                        const pendingJob = pendingJobsMap.get(pendingJobKey);

                        // Return single worksheet entry for new student
                        return [{
                            studentId: student.id,
                            name: student.name,
                            tokenNumber: student.tokenNumber,
                            id: '',
                            worksheetNumber: recommendedWorksheetNumber,
                            grade: '',
                            existing: false,
                            isAbsent: false,
                            isRepeated: isRepeatedWorksheet,
                            isCorrectGrade: false,
                            isIncorrectGrade: false,
                            isNew: !hasHistory,
                            isUploading: false,
                            page1File: null,
                            page2File: null,
                            worksheetEntryId: generateWorksheetEntryId(student.id, 0),
                            worksheetEntryIndex: 0,
                            // Set job status if there's a pending/processing job
                            jobId: pendingJob?.jobId,
                            gradingStatus: pendingJob?.status as 'pending' | 'processing' | undefined
                        }];
                    } catch (error) {
                        return [{
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
                            page2File: null,
                            worksheetEntryId: generateWorksheetEntryId(student.id, 0),
                            worksheetEntryIndex: 0
                        }];
                    }
                }))).flat();

                setStudentWorksheets(worksheets);
            } catch (error) {
                toast.error('Failed to load student data');
            } finally {
                setIsFetchingTableData(false);
            }
        };

        fetchStudentsAndWorksheets();
    }, [selectedClass, submittedOn]);

    // Handler for adding a new worksheet entry for a student
    const handleAddWorksheetEntry = (studentId: string) => {
        setStudentWorksheets(prev => {
            // Find all existing entries for this student
            const studentEntries = prev.filter(w => w.studentId === studentId);
            const maxIndex = Math.max(...studentEntries.map(e => e.worksheetEntryIndex), -1);
            const newIndex = maxIndex + 1;

            // Get the student's info from first entry
            const firstEntry = studentEntries[0];
            if (!firstEntry) return prev;

            // Get the last entry to auto-increment worksheet number
            const lastEntry = studentEntries[studentEntries.length - 1];
            const nextWorksheetNumber = lastEntry && lastEntry.worksheetNumber > 0
                ? lastEntry.worksheetNumber + 1
                : 0;

            // Create new empty worksheet entry with incremented worksheet number
            const newEntry: StudentWorksheet = {
                studentId: firstEntry.studentId,
                name: firstEntry.name,
                tokenNumber: firstEntry.tokenNumber,
                id: '',
                worksheetNumber: nextWorksheetNumber,
                grade: '',
                existing: false,
                isAbsent: false,
                isRepeated: false,
                isCorrectGrade: false,
                isIncorrectGrade: false,
                isUploading: false,
                page1File: null,
                page2File: null,
                worksheetEntryId: generateWorksheetEntryId(studentId, newIndex),
                worksheetEntryIndex: newIndex
            };

            // Insert after the last entry for this student
            const lastStudentEntryIndex = prev.findIndex(w => w.worksheetEntryId === studentEntries[studentEntries.length - 1].worksheetEntryId);
            const newWorksheets = [...prev];
            newWorksheets.splice(lastStudentEntryIndex + 1, 0, newEntry);

            return newWorksheets;
        });

        toast.success('Added new worksheet entry');
    };

    const handleRemoveWorksheetEntry = async (worksheetEntryId: string) => {
        const worksheet = studentWorksheets.find(w => w.worksheetEntryId === worksheetEntryId);
        if (!worksheet) return;

        if (worksheet.worksheetEntryIndex === 0) {
            toast.error('Cannot remove the primary worksheet entry');
            return;
        }

        if (worksheet.id && worksheet.existing) {
            try {
                await worksheetAPI.deleteGradedWorksheet(worksheet.id);
                toast.success('Worksheet removed');
            } catch (error) {
                toast.error('Failed to remove worksheet');
                return;
            }
        }

        setStudentWorksheets(prev => prev.filter(w => w.worksheetEntryId !== worksheetEntryId));
    };

    const handlePageFileChange = (worksheetEntryId: string, pageNumber: number, file: File | null) => {
        setStudentWorksheets(prev => prev.map(sw => {
            if (sw.worksheetEntryId === worksheetEntryId) {
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
    }; const handleUpdateWorksheet = async (sortedIndex: number, field: string, value: any) => {

        const sortedWorksheet = sortedStudentWorksheets[sortedIndex];
        const originalIndex = studentWorksheets.findIndex(w => w.worksheetEntryId === sortedWorksheet.worksheetEntryId);

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
            const newWorksheetNumber = value;
            let isRepeated = false;

            if (newWorksheetNumber > 0) {
                try {
                    // Get all worksheets up to the selected date
                    const endDate = new Date(submittedOn);
                    endDate.setHours(23, 59, 59, 999); // End of the selected day

                    const allWorksheets = await worksheetAPI.getPreviousWorksheets(
                        selectedClass,
                        sortedWorksheet.studentId,
                        endDate.toISOString().split('T')[0]
                    );

                    // Check if this worksheet number has been attempted before the selected date
                    const selectedDateObj = new Date(submittedOn);
                    selectedDateObj.setHours(0, 0, 0, 0);

                    isRepeated = allWorksheets && allWorksheets.some(pw => {
                        const worksheetDate = new Date(pw.submittedOn || '');
                        worksheetDate.setHours(0, 0, 0, 0);

                        return !pw.isAbsent &&
                            pw.template?.worksheetNumber === newWorksheetNumber &&
                            worksheetDate < selectedDateObj; // Only check dates before the selected date
                    });

                    if (!isRepeated) {
                        const otherEntriesWithSameNumber = newWorksheets.filter(w =>
                            w.studentId === sortedWorksheet.studentId &&
                            w.worksheetEntryId !== sortedWorksheet.worksheetEntryId &&
                            w.worksheetNumber === newWorksheetNumber &&
                            !w.isAbsent
                        );
                        if (otherEntriesWithSameNumber.length > 0) {
                            isRepeated = true;
                        }
                    }
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
    }; const handleUpload = async (worksheet: StudentWorksheet): Promise<{ success: boolean; skipped?: boolean; reason?: string }> => {
        if (worksheet.gradingStatus === 'queued' || worksheet.gradingStatus === 'processing' || worksheet.gradingStatus === 'uploading') {
            return { success: false, skipped: true, reason: 'already_processing' };
        }

        if (worksheet.isAbsent) {
            return { success: false, skipped: true, reason: 'absent' };
        }

        if (!worksheet.worksheetNumber) {
            toast.error(`${worksheet.name}: Please enter a worksheet number`);
            return { success: false, reason: 'missing_worksheet_number' };
        }


        if (!worksheet.page1File && !worksheet.page2File) {
            toast.error(`${worksheet.name}: Please upload at least one page image`);
            return { success: false, reason: 'missing_files' };
        }

        // Pre-duplicate check: Skip if worksheet already exists in DB
        try {
            const existsCheck = await worksheetAPI.checkExistsForGrading(
                selectedClass,
                worksheet.studentId,
                worksheet.worksheetNumber,
                submittedOn
            );
            if (existsCheck.exists) {
                console.log(`⏭️ Skipping ${worksheet.name} WS#${worksheet.worksheetNumber} - already exists (grade: ${existsCheck.grade})`);
                // Update UI to show it's already graded
                setStudentWorksheets(prev => prev.map(sw =>
                    sw.worksheetEntryId === worksheet.worksheetEntryId
                        ? {
                            ...sw,
                            id: existsCheck.worksheetId,
                            grade: existsCheck.grade?.toString() || '',
                            existing: true,
                            gradingStatus: 'completed',
                            page1File: null,
                            page2File: null
                        }
                        : sw
                ));
                toast.info(`${worksheet.name} WS#${worksheet.worksheetNumber} already graded (${existsCheck.grade})`);
                return { success: false, skipped: true, reason: 'already_exists' };
            }
        } catch (error) {
            // If check fails, continue with upload
            console.warn('Pre-duplicate check failed, proceeding with upload:', error);
        }


        setStudentWorksheets(prev => prev.map(sw =>
            sw.worksheetEntryId === worksheet.worksheetEntryId
                ? { ...sw, isUploading: true, gradingStatus: 'uploading' }
                : sw
        ));
        try {
            const formData = new FormData();

            formData.append('tokenNo', worksheet.tokenNumber);
            formData.append('worksheetName', worksheet.worksheetNumber.toString());
            formData.append('studentId', worksheet.studentId);
            formData.append('studentName', worksheet.name);
            formData.append('worksheetNumber', worksheet.worksheetNumber.toString());
            formData.append('isRepeated', worksheet.isRepeated ? 'true' : 'false');
            formData.append('classId', selectedClass);
            formData.append('submittedOn', submittedOn);

            if (worksheet.isCorrectGrade) formData.append('isCorrectGrade', 'true');
            if (worksheet.isIncorrectGrade) formData.append('isIncorrectGrade', 'true');

            if (worksheet.page1File) {
                formData.append('files', worksheet.page1File);
            }
            if (worksheet.page2File) {
                formData.append('files', worksheet.page2File);
            }

            const response = await gradingJobsAPI.createJob(formData);

            if (!response.success) {
                throw new Error('Failed to create grading job');
            }

            setStudentWorksheets(prev => prev.map(sw =>
                sw.worksheetEntryId === worksheet.worksheetEntryId
                    ? {
                        ...sw,
                        isUploading: false,
                        gradingStatus: 'queued',
                        jobId: response.jobId,
                        page1File: null,
                        page2File: null
                    }
                    : sw
            ));

            toast.success(`Worksheet #${worksheet.worksheetNumber} for ${worksheet.name} queued for grading`);

            gradingJobsAPI.pollJobStatus(
                response.jobId,
                (job) => {
                    // Update job status header
                    setJobStatusKey(prev => prev + 1);

                    setStudentWorksheets(prev => prev.map(sw => {
                        if (sw.worksheetEntryId !== worksheet.worksheetEntryId) return sw;

                        // Update status
                        if (job.status === 'processing') {
                            return { ...sw, gradingStatus: 'processing' };
                        }

                        if (job.status === 'completed' && job.result) {
                            const grade = job.result.grade || 0;
                            const roundedGrade = Math.max(0, Math.min(40, Math.round(grade)));

                            const gradingDetails: GradingDetails = {
                                total_possible: job.result.total_possible || 0,
                                grade_percentage: job.result.grade_percentage || 0,
                                total_questions: job.result.total_questions || 0,
                                correct_answers: job.result.correct_answers || 0,
                                wrong_answers: job.result.wrong_answers || 0,
                                unanswered: job.result.unanswered || 0,
                                question_scores: job.result.question_scores || [],
                                wrong_questions: job.result.wrong_questions || [],
                                correct_questions: job.result.correct_questions || [],
                                unanswered_questions: job.result.unanswered_questions || [],
                                overall_feedback: job.result.overall_feedback || ''
                            };

                            const wrongNumbers = [
                                ...(job.result.wrong_questions || []).map((q: any) => q.question_number),
                                ...(job.result.unanswered_questions || []).map((q: any) => q.question_number)
                            ].sort((a, b) => a - b);

                            const wrongQuestionNumbers = wrongNumbers.length > 0 ? wrongNumbers.join(', ') : '';

                            toast.success(`Worksheet #${worksheet.worksheetNumber} for ${worksheet.name} graded! Score: ${roundedGrade}`);

                            return {
                                ...sw,
                                id: job.postgresId,
                                grade: roundedGrade.toString(),
                                gradingStatus: 'completed',
                                gradingDetails,
                                wrongQuestionNumbers,
                                existing: true
                            };
                        }

                        if (job.status === 'failed') {
                            toast.error(`Grading failed for ${worksheet.name} (WS #${worksheet.worksheetNumber}): ${job.error || 'Unknown error'}`);
                            return {
                                ...sw,
                                gradingStatus: 'failed',
                                gradingError: job.error
                            };
                        }

                        return sw;
                    }));
                },
                120,
                5000
            ).catch(error => {
                console.error('Polling error:', error);
                const errorMsg = error instanceof Error ? error.message : 'Connection lost';
                toast.error(`Failed to track grading status for ${worksheet.name} (WS #${worksheet.worksheetNumber}): ${errorMsg}`);

                setStudentWorksheets(prev => prev.map(sw =>
                    sw.worksheetEntryId === worksheet.worksheetEntryId
                        ? {
                            ...sw,
                            gradingStatus: 'failed',
                            gradingError: `Polling failed: ${errorMsg}`
                        }
                        : sw
                ));
            });

            return { success: true };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            toast.error(`Failed to queue ${worksheet.name} (WS #${worksheet.worksheetNumber}): ${errorMessage}`);


            setStudentWorksheets(prev => prev.map(sw =>
                sw.worksheetEntryId === worksheet.worksheetEntryId
                    ? { ...sw, isUploading: false, gradingStatus: 'failed', gradingError: errorMessage }
                    : sw
            ));

            return { success: false, reason: errorMessage };
        }
    };
    const handleBatchProcess = async () => {
        const studentsWithFiles = studentWorksheets.filter(sw =>
            !sw.isAbsent &&
            (sw.page1File || sw.page2File) &&
            sw.worksheetNumber &&
            sw.gradingStatus !== 'queued' &&
            sw.gradingStatus !== 'pending' &&
            sw.gradingStatus !== 'processing' &&
            sw.gradingStatus !== 'uploading'
        );

        if (studentsWithFiles.length === 0) {
            toast.error('No worksheets to process. Please upload page images and assign worksheet numbers.');
            return;
        }


        setStudentWorksheets(prev => prev.map(sw =>
            studentsWithFiles.some(s => s.worksheetEntryId === sw.worksheetEntryId)
                ? { ...sw, isUploading: true }
                : sw
        ));

        try {
            toast.info(`Queuing ${studentsWithFiles.length} worksheet${studentsWithFiles.length !== 1 ? 's' : ''} for AI grading...`);
            const results = await Promise.allSettled(
                studentsWithFiles.map(worksheet => handleUpload(worksheet))
            );

            let queued = 0;
            let failed = 0;
            let skipped = 0;

            results.forEach((result, index) => {
                if (result.status === 'fulfilled') {
                    const value = result.value;
                    if (value?.success) {
                        queued++;
                    } else if (value?.skipped) {
                        skipped++;
                    } else {
                        failed++;
                        const worksheet = studentsWithFiles[index];
                        console.error(`Error processing worksheet for ${worksheet.name}:`, value?.reason || 'Unknown error');
                    }
                } else {
                    failed++;
                    const worksheet = studentsWithFiles[index];
                    console.error(`Error processing worksheet for ${worksheet.name}:`, result.reason);
                }
            });

            if (queued > 0) {
                toast.success(`${queued} worksheet${queued !== 1 ? 's' : ''} queued for grading!`);
            }

            if (failed > 0) {
                toast.error(`Failed to queue ${failed} worksheet${failed !== 1 ? 's' : ''}.`);
            }

            if (skipped > 0) {
                toast.info(`${skipped} worksheet${skipped !== 1 ? 's' : ''} skipped (already processing or absent).`);
            }

            if (queued === 0 && failed === 0 && skipped === 0) {
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
            // Get the most up-to-date data for this worksheet entry from the main state
            const currentStudentData = studentWorksheets.find(w => w.worksheetEntryId === worksheet.worksheetEntryId);
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
                if (currentStudentData.id && currentStudentData.existing) {
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
                // For multi-worksheet support, we use the existing worksheet id if available
                if (currentStudentData.id) {
                    await worksheetAPI.deleteGradedWorksheet(currentStudentData.id);
                    toast.success(`Record for ${currentStudentData.name} removed successfully`);

                    // Update local state to reflect deletion
                    setStudentWorksheets(prevWorksheets => prevWorksheets.map(w => {
                        if (w.worksheetEntryId === currentStudentData.worksheetEntryId) {
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
                } else {
                    // No existing worksheet to delete
                    toast.info(`No existing record found for ${currentStudentData.name}`);
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

                    // Use existing worksheet id if available
                    if (currentStudentData.id) {
                        await worksheetAPI.updateGradedWorksheet(currentStudentData.id, data);
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

                    // Use existing worksheet id if available
                    if (currentStudentData.id) {
                        await worksheetAPI.updateGradedWorksheet(currentStudentData.id, data);
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
                            action: currentStudentData.id ? 'update' : 'create',
                            page: 'upload_worksheet_individual'
                        });
                    }

                    toast.success(`${currentStudentData.name}'s worksheet saved successfully`);
                }

                // Update local state to reflect the saved data
                setStudentWorksheets(prevWorksheets => prevWorksheets.map(w =>
                    w.worksheetEntryId === currentStudentData.worksheetEntryId ? { ...currentStudentData, existing: true } : w
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


    const scrollToTop = () => {
        window.scrollTo({
            top: 0,
            behavior: 'smooth'
        });
    };

    const handleSaveAllChanges = async () => {
        setIsSaving(true);

        try {
            const worksheetsToSave = studentWorksheets.filter(worksheet => {
                if (worksheet.isAbsent) {
                    return true;
                }

                const gradeValue = typeof worksheet.grade === 'string' ? worksheet.grade.trim() : '';
                const hasValidGrade = gradeValue !== '' && !isNaN(parseFloat(gradeValue));

                return worksheet.worksheetNumber > 0 && hasValidGrade;
            });

            if (worksheetsToSave.length === 0) {
                toast.error('No worksheets to save. Please mark students as absent or assign worksheet numbers with grades.');
                setIsSaving(false);
                return;
            }

            let savedCount = 0;
            let failedCount = 0;


            await Promise.all(worksheetsToSave.map(async (worksheet) => {
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

                        // Use existing worksheet id if available
                        if (worksheet.id) {
                            await worksheetAPI.updateGradedWorksheet(worksheet.id, data);
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

                        // Use existing worksheet id if available
                        if (worksheet.id) {
                            await worksheetAPI.updateGradedWorksheet(worksheet.id, data);
                        } else {
                            await worksheetAPI.createGradedWorksheet(data);
                        }

                        if (data.isIncorrectGrade) {
                            posthog.capture('incorrect_grade_student_saved', {
                                student_name: worksheet.name,
                                student_token: worksheet.tokenNumber,
                                worksheet_number: data.worksheetNumber,
                                grade: data.grade,
                                is_absent: data.isAbsent,
                                is_repeated: data.isRepeated,
                                action: worksheet.id ? 'update' : 'create',
                                page: 'upload_worksheet_bulk'
                            });
                        }

                        savedCount++;
                    }
                } catch (error) {
                    failedCount++;
                }
            }));

            if (savedCount > 0) {
                let message = `Successfully saved ${savedCount} worksheet${savedCount !== 1 ? 's' : ''}`;

                if (failedCount > 0) {
                    message += `. ${failedCount} failed to save`;
                }

                toast.success(message);

                const incorrectGradeCount = worksheetsToSave.filter(w => w.isIncorrectGrade).length;
                if (incorrectGradeCount > 0) {
                    posthog.capture('incorrect_grade_bulk_save', {
                        total_worksheets_saved: savedCount,
                        incorrect_grade_count: incorrectGradeCount,
                        total_failed: failedCount,
                        page: 'upload_worksheet_bulk'
                    });
                }
            }

            if (failedCount > 0 && savedCount === 0) {
                toast.error(`Failed to save ${failedCount} worksheet${failedCount !== 1 ? 's' : ''}`);
            }

        } catch (error) {
            toast.error('Failed to save changes');
        } finally {
            setIsSaving(false);
        }
    };

    const handleMarkAllWithoutGradeAsAbsent = () => {
        const worksheetsToCheck = searchTerm.trim() ? filteredStudentWorksheets : studentWorksheets;
        const worksheetsWithoutGrades = worksheetsToCheck.filter(worksheet =>
            !worksheet.isAbsent &&
            (!worksheet.grade || worksheet.grade.trim() === '')
        );

        if (worksheetsWithoutGrades.length === 0) {
            toast.info('No worksheets without grades found to mark as absent.');
            return;
        }

        setStudentWorksheets(prev => prev.map(worksheet => {
            const shouldMarkAbsent = worksheetsWithoutGrades.some(w => w.worksheetEntryId === worksheet.worksheetEntryId);
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

        toast.success(`Marked ${worksheetsWithoutGrades.length} worksheet${worksheetsWithoutGrades.length !== 1 ? 's' : ''} as absent.`);
    };


    if (isLoading) {
        return <div className="flex items-center justify-center min-h-[60vh]">Loading...</div>;
    }

    return (
        <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 md:p-6">
                <h2 className="text-lg font-semibold mb-1">Upload Worksheet Images</h2>
                <p className="text-sm text-gray-600 mb-4">
                    Select class and date, then upload and grade worksheets for each student.
                </p>

                <AIGradingStatusBar
                    refreshKey={jobStatusKey}
                    onRefresh={() => {
                        setJobStatusKey(prev => prev + 1);
                    }}
                />

                {selectedClass && (
                    <div className="mb-6 space-y-3 md:space-y-0 md:flex md:items-center md:space-x-6 text-sm">
                        <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 md:justify-start md:space-x-2">
                            <span className="font-medium">Graded Today:</span>
                            <span className="font-semibold text-blue-600">{gradedCount} / {totalStudents}</span>
                        </div>
                        <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 md:justify-start md:space-x-2">
                            <span className="font-medium">Completion:</span>
                            <span className="font-semibold text-green-600">{totalStudents ? Math.round((gradedCount / totalStudents) * 100) : 0}%</span>
                        </div>
                        <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 md:justify-start md:space-x-2">
                            <span className="font-medium">Date:</span>
                            <span className="font-semibold">{submittedOn}</span>
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="class" className="text-sm font-medium">Class</Label>
                            <select
                                id="class"
                                value={selectedClass}
                                onChange={(e) => setSelectedClass(e.target.value)}
                                className="flex h-9 w-full rounded-md border-1 bg-gray-50 px-3 py-1 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
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
                                className="h-9 py-1 border-1 bg-gray-50 focus-visible:ring-1"
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
                                    className="h-9 py-1 pr-8 border-0 bg-gray-50 focus-visible:ring-1"
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
                            <div>
                                {filteredStudentWorksheets.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 p-2 md:p-0">
                                        {groupedWorksheetData.uniqueStudentIds.map(studentId => {
                                            const studentWorksheetsList = groupedWorksheetData.groupedByStudent[studentId];

                                            const indices = studentWorksheetsList.map(w =>
                                                worksheetIndexMap.get(w.worksheetEntryId) ?? -1
                                            );

                                            return (
                                                <StudentWorksheetCard
                                                    key={studentId}
                                                    worksheets={studentWorksheetsList}
                                                    indices={indices}
                                                    onUpdate={handleUpdateWorksheet}
                                                    onPageFileChange={handlePageFileChange}
                                                    onUpload={handleUpload}
                                                    onSave={handleSaveStudent}
                                                    onAddWorksheet={handleAddWorksheetEntry}
                                                    onRemoveWorksheet={handleRemoveWorksheetEntry}
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

                            <div className="hidden md:flex justify-end mt-4 space-x-3">
                                <Button
                                    onClick={handleBatchProcess}
                                    disabled={isSaving || sortedStudentWorksheets.some(ws => ws.isUploading) ||
                                        !studentWorksheets.some(ws => !ws.isAbsent && (ws.page1File || ws.page2File) && ws.worksheetNumber)}
                                    variant="secondary"
                                >
                                    AI Grade All {(() => {
                                        const eligibleCount = studentWorksheets.filter(ws =>
                                            !ws.isAbsent && (ws.page1File || ws.page2File) && ws.worksheetNumber
                                        ).length;
                                        return eligibleCount > 0 ? `(${eligibleCount})` : '';
                                    })()}
                                </Button>
                                <Button
                                    onClick={handleSaveAllChanges}
                                    disabled={isSaving || sortedStudentWorksheets.some(ws => ws.isUploading)}
                                >
                                    {isSaving ? 'Saving Changes...' : 'Save All Changes'}
                                </Button>
                            </div>

                            <div className="md:hidden fixed bottom-0 left-0 right-0 z-50 mb-0">
                                <div className="bg-white border-t border-gray-100 p-4">
                                    <div className="flex space-x-3">
                                        <Button
                                            onClick={scrollToTop}
                                            className="h-12 w-12 p-0"
                                            variant="outline"
                                        >
                                            ↑
                                        </Button>
                                        <Button
                                            onClick={handleBatchProcess}
                                            disabled={isSaving || sortedStudentWorksheets.some(ws => ws.isUploading) ||
                                                !studentWorksheets.some(ws => !ws.isAbsent && (ws.page1File || ws.page2File) && ws.worksheetNumber)}
                                            className="flex-1 h-12 text-sm font-medium"
                                            variant="secondary"
                                        >
                                            AI Grade All
                                        </Button>
                                        <Button
                                            onClick={handleSaveAllChanges}
                                            disabled={isSaving || sortedStudentWorksheets.some(ws => ws.isUploading)}
                                            className="flex-1 h-12 text-sm font-medium"
                                        >
                                            {isSaving ? 'Saving...' : 'Save All'}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="text-sm text-muted-foreground px-2 md:px-0">
                                {(() => {
                                    const uniqueStudentCount = new Set(sortedStudentWorksheets.map(w => w.studentId)).size;
                                    const totalWorksheets = sortedStudentWorksheets.length;
                                    const filteredUniqueCount = new Set(filteredStudentWorksheets.map(w => w.studentId)).size;

                                    if (searchTerm.trim()) {
                                        return <>Showing {filteredUniqueCount} of {uniqueStudentCount} students ({totalWorksheets} worksheets)</>;
                                    }
                                    return <>Showing {uniqueStudentCount} students ({totalWorksheets} worksheets)</>;
                                })()}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
