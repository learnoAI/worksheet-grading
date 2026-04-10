'use client';

import { useState, useEffect, useMemo } from 'react';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { classAPI, worksheetAPI, worksheetProcessingAPI } from '@/lib/api';
import { gradingJobsAPI } from '@/lib/api/gradingJobs';
import { GradingJobsStatus } from '@/components/GradingJobsStatus';
import { StudentWorksheetCard } from './student-worksheet-card';
import { usePostHog } from 'posthog-js/react';

// Stats from API response - no longer computed on frontend
interface WorksheetStats {
    totalStudents: number;
    studentsWithWorksheets: number;
    gradedCount: number;
    absentCount: number;
    pendingCount: number;
}

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
    worksheetEntryId: string; // Unique per entry (e.g., "student123-0")
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
    page1Url?: string; // Image URL from database
    page2Url?: string; // Image URL from database
    gradingDetails?: GradingDetails;
    wrongQuestionNumbers?: string;
    id?: string;
    existing?: boolean;
    jobId?: string;
    jobStatus?: 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
    isAdditional?: boolean; // True for manually added worksheet entries
    isNew?: boolean;
}

const DIRECT_UPLOAD_DEFAULT_CONCURRENCY = 4;
const DIRECT_UPLOAD_MIN_CONCURRENCY = 2;
const DIRECT_UPLOAD_MAX_ATTEMPTS = 3;

type BrowserNetworkInformation = {
    effectiveType?: string;
    saveData?: boolean;
};

function getBrowserConnection(): BrowserNetworkInformation | undefined {
    if (typeof navigator === 'undefined') {
        return undefined;
    }

    const navigatorWithConnection = navigator as Navigator & {
        connection?: BrowserNetworkInformation;
        mozConnection?: BrowserNetworkInformation;
        webkitConnection?: BrowserNetworkInformation;
        deviceMemory?: number;
    };

    return navigatorWithConnection.connection
        || navigatorWithConnection.mozConnection
        || navigatorWithConnection.webkitConnection;
}

function getDirectUploadConcurrency(): number {
    if (typeof navigator === 'undefined') {
        return 3;
    }

    const connection = getBrowserConnection();
    if (connection?.saveData) {
        return DIRECT_UPLOAD_MIN_CONCURRENCY;
    }

    if (connection?.effectiveType === 'slow-2g' || connection?.effectiveType === '2g') {
        return DIRECT_UPLOAD_MIN_CONCURRENCY;
    }

    if (connection?.effectiveType === '3g') {
        return 3;
    }

    const navigatorWithDeviceMemory = navigator as Navigator & { deviceMemory?: number };
    if (navigatorWithDeviceMemory.deviceMemory && navigatorWithDeviceMemory.deviceMemory <= 2) {
        return 3;
    }

    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
        return 3;
    }

    return DIRECT_UPLOAD_DEFAULT_CONCURRENCY;
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function shouldRetryUploadStatus(status: number): boolean {
    return status === 408 || status === 429 || status >= 500;
}

function getUploadRetryDelayMs(attempt: number): number {
    return 750 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 250);
}

async function uploadFileWithRetry(
    uploadUrl: string,
    file: File,
    contentType: string,
    pageNumber: number
): Promise<void> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= DIRECT_UPLOAD_MAX_ATTEMPTS; attempt += 1) {
        let response: Response;

        try {
            response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': contentType
                },
                body: file
            });
        } catch (error) {
            lastError = error;

            if (attempt < DIRECT_UPLOAD_MAX_ATTEMPTS) {
                await sleep(getUploadRetryDelayMs(attempt));
            }

            continue;
        }

        if (response.ok) {
            return;
        }

        lastError = new Error(`Storage upload failed for page ${pageNumber} (${response.status})`);
        if (!shouldRetryUploadStatus(response.status)) {
            throw lastError;
        }

        if (attempt < DIRECT_UPLOAD_MAX_ATTEMPTS) {
            await sleep(getUploadRetryDelayMs(attempt));
        }
    }

    throw lastError instanceof Error
        ? lastError
        : new Error(`Storage upload failed for page ${pageNumber}`);
}

async function runWithConcurrency<T, R>(
    items: T[],
    limit: number,
    worker: (item: T, index: number) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
    const results: PromiseSettledResult<R>[] = new Array(items.length);
    let nextIndex = 0;

    async function runNext() {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;

            try {
                results[currentIndex] = {
                    status: 'fulfilled',
                    value: await worker(items[currentIndex], currentIndex)
                };
            } catch (reason) {
                results[currentIndex] = {
                    status: 'rejected',
                    reason
                };
            }
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(limit, items.length) }, () => runNext())
    );

    return results;
}

function getWorksheetUploadKey(worksheet: Pick<StudentWorksheet, 'studentId' | 'worksheetNumber'>): string {
    return `${worksheet.studentId}:${worksheet.worksheetNumber}`;
}

function getUploadSessionStorageKey(classId: string, submittedOn: string): string {
    return `worksheet-upload-session:${classId}:${submittedOn}`;
}

function isLikelyConnectivityError(error: unknown): boolean {
    const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();

    return (
        message.includes('failed to fetch') ||
        message.includes('fetch failed') ||
        message.includes('networkerror') ||
        message.includes('network request failed') ||
        message.includes('load failed') ||
        message.includes('polling timeout') ||
        message.includes('polling interrupted')
    );
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
    const posthog = usePostHog();
    const [classes, setClasses] = useState<Class[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isSaving, setIsSaving] = useState(false);
    const [isFetchingTableData, setIsFetchingTableData] = useState(false);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [submittedOn, setSubmittedOn] = useState<string>(new Date().toISOString().split('T')[0]);
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [isOnline, setIsOnline] = useState(true);
    const [studentWorksheets, setStudentWorksheets] = useState<StudentWorksheet[]>([]);
    const [worksheetStats, setWorksheetStats] = useState<WorksheetStats | null>(null);


    const sortedStudentWorksheets = useMemo(() => {
        return sortStudentsByTokenNumber(studentWorksheets);
    }, [studentWorksheets]);

    // Count unique students who have at least one graded worksheet
    const gradedCount = useMemo(() => {
        const gradedStudentIds = new Set<string>();
        for (const sw of studentWorksheets) {
            if (!sw.isAbsent && sw.worksheetNumber > 0 && sw.grade !== '' && sw.grade !== undefined && sw.grade !== null) {
                gradedStudentIds.add(sw.studentId);
            }
        }
        return gradedStudentIds.size;
    }, [studentWorksheets]);

    // Group worksheets by studentId for carousel display
    const groupedStudentWorksheets = useMemo(() => {
        const groups = new Map<string, { studentId: string; studentName: string; tokenNumber: string; worksheets: StudentWorksheet[] }>();

        for (const ws of sortedStudentWorksheets) {
            if (!groups.has(ws.studentId)) {
                groups.set(ws.studentId, {
                    studentId: ws.studentId,
                    studentName: ws.name,
                    tokenNumber: ws.tokenNumber,
                    worksheets: []
                });
            }
            groups.get(ws.studentId)!.worksheets.push(ws);
        }

        return Array.from(groups.values());
    }, [sortedStudentWorksheets]);

    const totalStudents = useMemo(() => {
        const uniqueStudentIds = new Set<string>();
        for (const sw of studentWorksheets) {
            uniqueStudentIds.add(sw.studentId);
        }
        return uniqueStudentIds.size;
    }, [studentWorksheets]);

    const totalGradedWorksheets = useMemo(() => {
        return studentWorksheets.filter(sw =>
            !sw.isAbsent && sw.worksheetNumber > 0 && sw.grade !== '' && sw.grade !== undefined && sw.grade !== null
        ).length;
    }, [studentWorksheets]);

    const absentCount = useMemo(() => {
        const absentStudentIds = new Set<string>();
        for (const sw of studentWorksheets) {
            if (sw.isAbsent) {
                absentStudentIds.add(sw.studentId);
            }
        }
        return absentStudentIds.size;
    }, [studentWorksheets]);

    const filteredGroupedStudentWorksheets = useMemo(() => {
        if (!searchTerm.trim()) {
            return groupedStudentWorksheets;
        }

        const lowercaseSearch = searchTerm.toLowerCase().trim();
        return groupedStudentWorksheets.filter(group =>
            group.studentName.toLowerCase().includes(lowercaseSearch) ||
            group.tokenNumber.toLowerCase().includes(lowercaseSearch)
        );
    }, [groupedStudentWorksheets, searchTerm]);


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
        const updateOnlineStatus = () => setIsOnline(window.navigator.onLine);

        updateOnlineStatus();
        window.addEventListener('online', updateOnlineStatus);
        window.addEventListener('offline', updateOnlineStatus);

        return () => {
            window.removeEventListener('online', updateOnlineStatus);
            window.removeEventListener('offline', updateOnlineStatus);
        };
    }, []);

    useEffect(() => {
        const fetchStudentsAndWorksheets = async () => {
            if (!selectedClass) {
                setStudentWorksheets([]);
                return;
            }

            try {
                setIsFetchingTableData(true);

                // Use batch endpoint to fetch all data in 1-2 API calls
                const batchData = await worksheetAPI.getClassWorksheetsForDate(selectedClass, submittedOn);
                const { students, worksheetsByStudent, studentSummaries, stats } = batchData;

                // Store stats from API for initial display
                setWorksheetStats(stats);

                const sortedStudents = sortStudentsByTokenNumber(students);

                // Process the batch data for each student
                const worksheetArrays: StudentWorksheet[][] = sortedStudents.map((student) => {
                    const worksheetsOnDate = worksheetsByStudent[student.id] || [];

                    // If worksheets exist for this date, return them all (sorted by worksheet number ascending)
                    if (worksheetsOnDate.length > 0) {
                        const sortedWorksheets = [...worksheetsOnDate].sort((a: any, b: any) => {
                            const wsNumA = a.template?.worksheetNumber || 0;
                            const wsNumB = b.template?.worksheetNumber || 0;
                            return wsNumA - wsNumB;
                        });

                        return sortedWorksheets.map((worksheet: any, index: number) => {
                            const images = worksheet.images || [];
                            const page1 = images.find((img: any) => img.pageNumber === 1);
                            const page2 = images.find((img: any) => img.pageNumber === 2);
                            const existingWorksheetNumber = worksheet.worksheetNumber > 0
                                ? worksheet.worksheetNumber
                                : (worksheet.template?.worksheetNumber || 0);

                            return {
                                worksheetEntryId: `${student.id}-${index}`,
                                studentId: student.id,
                                name: student.name,
                                tokenNumber: student.tokenNumber,
                                id: worksheet.id || '',
                                worksheetNumber: worksheet.isAbsent ? 0 : existingWorksheetNumber,
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
                                page1Url: page1?.imageUrl,
                                page2Url: page2?.imageUrl,
                                gradingDetails: worksheet.gradingDetails || undefined,
                                wrongQuestionNumbers: worksheet.wrongQuestionNumbers || '',
                                isAdditional: index > 0
                            };
                        });
                    }

                    // No worksheets for today - use backend recommendation
                    const summary = studentSummaries[student.id];
                    const hasHistory = summary && summary.lastWorksheetNumber !== null;

                    // Use recommendation from backend (calculated server-side)
                    const recommendedWorksheetNumber = summary?.recommendedWorksheetNumber ?? 1;
                    const isRepeatedWorksheet = summary?.isRecommendedRepeated ?? false;

                    return [{
                        worksheetEntryId: `${student.id}-0`,
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
                        page2File: null
                    }];
                });

                // Flatten the array of arrays into a single array
                let worksheets = worksheetArrays.flat();

                // Check for active grading jobs for this class and date
                try {
                    const jobsResponse = await gradingJobsAPI.getJobsByClassAndDate(selectedClass, submittedOn);
                    const activeJobs = jobsResponse.jobs.filter(j =>
                        j.status === 'QUEUED' || j.status === 'PROCESSING'
                    );

                    if (activeJobs.length > 0) {
                        // Match jobs to worksheets by studentId + worksheetNumber
                        const matchedJobIds = new Set<string>();

                        worksheets = worksheets.map(ws => {
                            const matchingJob = activeJobs.find(job =>
                                job.studentId === ws.studentId &&
                                job.worksheetNumber === ws.worksheetNumber
                            );

                            if (matchingJob) {
                                matchedJobIds.add(matchingJob.id);
                                return {
                                    ...ws,
                                    isUploading: true,
                                    jobId: matchingJob.id,
                                    jobStatus: matchingJob.status
                                };
                            }
                            return ws;
                        });

                        // Create worksheet entries for unmatched jobs (e.g., plus worksheets that were processing)
                        const unmatchedJobs = activeJobs.filter(job => !matchedJobIds.has(job.id));

                        for (const job of unmatchedJobs) {
                            // Find any worksheet for this student to get base info
                            const baseWorksheet = worksheets.find(ws => ws.studentId === job.studentId);
                            if (baseWorksheet) {
                                // Count existing entries for this student to generate unique ID
                                const existingCount = worksheets.filter(ws => ws.studentId === job.studentId).length;

                                // Create a new entry for this processing worksheet
                                const newEntry: StudentWorksheet = {
                                    worksheetEntryId: `${job.studentId}-${existingCount}`,
                                    studentId: job.studentId!,
                                    name: job.studentName || baseWorksheet.name,
                                    tokenNumber: baseWorksheet.tokenNumber,
                                    id: '',
                                    worksheetNumber: job.worksheetNumber,
                                    grade: '',
                                    isAbsent: false,
                                    isUploading: true,
                                    existing: false,
                                    isAdditional: true,
                                    isRepeated: false,
                                    isCorrectGrade: false,
                                    isIncorrectGrade: false,
                                    isNew: false,
                                    page1File: null,
                                    page2File: null,
                                    jobId: job.id,
                                    jobStatus: job.status
                                };
                                worksheets.push(newEntry as any);
                            }
                        }

                        // Start polling for active jobs
                        activeJobs.forEach(job => {
                            gradingJobsAPI.pollJobStatus(
                                job.id,
                                (updatedJob) => {
                                    setStudentWorksheets(prev => prev.map(sw => {
                                        if (sw.jobId === job.id) {
                                            return {
                                                ...sw,
                                                jobStatus: updatedJob.status,
                                                isUploading: updatedJob.status === 'QUEUED' || updatedJob.status === 'PROCESSING'
                                            };
                                        }
                                        return sw;
                                    }));

                                    // If completed, fetch the graded worksheet data (grade + wrong answers).
                                    if (updatedJob.status === 'COMPLETED') {
                                        (async () => {
                                            let gradedWs: any | null = null;

                                            if (updatedJob.worksheetId) {
                                                gradedWs = await worksheetAPI.getWorksheetById(updatedJob.worksheetId);
                                            } else if (job.studentId) {
                                                // Fallback: job completed but worksheetId wasn't persisted on the job yet.
                                                const all = await worksheetAPI.getAllWorksheetsByClassStudentDate(selectedClass, job.studentId, submittedOn);
                                                gradedWs =
                                                    all.find((ws: any) => {
                                                        const num = ws.worksheetNumber ?? ws.template?.worksheetNumber ?? 0;
                                                        return num === job.worksheetNumber;
                                                    }) || null;
                                            }

                                            if (!gradedWs) {
                                                return;
                                            }

                                            const images = gradedWs.images || [];
                                            const page1 = images.find((img: any) => img.pageNumber === 1);
                                            const page2 = images.find((img: any) => img.pageNumber === 2);

                                            setStudentWorksheets(prev =>
                                                prev.map(sw => {
                                                    if (sw.jobId === job.id) {
                                                        return {
                                                            ...sw,
                                                            grade: gradedWs.grade?.toString() || '',
                                                            id: gradedWs.id || sw.id,
                                                            existing: true,
                                                            isUploading: false,
                                                            gradingDetails: gradedWs.gradingDetails,
                                                            wrongQuestionNumbers: gradedWs.wrongQuestionNumbers || sw.wrongQuestionNumbers,
                                                            page1Url: page1?.imageUrl ?? sw.page1Url,
                                                            page2Url: page2?.imageUrl ?? sw.page2Url
                                                        };
                                                    }
                                                    return sw;
                                                })
                                            );
                                        })().catch(() => { });
                                    }
                                }
                            ).catch((pollError) => {
                                console.warn('Background job polling interrupted', {
                                    jobId: job.id,
                                    error: pollError instanceof Error ? pollError.message : String(pollError)
                                });
                                // Keep current row state untouched; refresh-on-resume and periodic page reload can resync.
                            });
                        });
                    }
                } catch (error) {
                    // Failed to fetch jobs, continue without processing state
                }

                try {
                    const storedSession = window.localStorage.getItem(getUploadSessionStorageKey(selectedClass, submittedOn));
                    const storedBatchId = storedSession ? JSON.parse(storedSession).batchId : null;

                    if (typeof storedBatchId === 'string' && storedBatchId.length > 0) {
                        const session = await worksheetProcessingAPI.getDirectUploadSession(storedBatchId);
                        const queuedItems = session.items.filter((item) => item.status === 'QUEUED' && item.jobId);

                        if (queuedItems.length > 0) {
                            const queuedByWorksheet = new Map(
                                queuedItems.map((item) => [`${item.studentId}:${item.worksheetNumber}`, item])
                            );

                            worksheets = worksheets.map((ws) => {
                                const queued = queuedByWorksheet.get(getWorksheetUploadKey(ws));
                                if (!queued) {
                                    return ws;
                                }

                                return {
                                    ...ws,
                                    isUploading: true,
                                    jobId: queued.jobId || ws.jobId,
                                    jobStatus: 'QUEUED'
                                };
                            });
                        }

                        if (session.status === 'FINALIZED') {
                            window.localStorage.removeItem(getUploadSessionStorageKey(selectedClass, submittedOn));
                        } else if (session.items.some((item) => item.status === 'PENDING')) {
                            toast.info('A previous upload was interrupted. Re-select the missing files and upload again.');
                        }
                    }
                } catch {
                    window.localStorage.removeItem(getUploadSessionStorageKey(selectedClass, submittedOn));
                }

                setStudentWorksheets(worksheets);
            } catch (error) {
                toast.error('Failed to load student data');
            } finally {
                setIsFetchingTableData(false);
            }
        };

        fetchStudentsAndWorksheets();
    }, [selectedClass, submittedOn]);

    const handlePageFileChange = (studentId: string, pageNumber: number, file: File | null, worksheetEntryId: string) => {
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
    };

    const handleAddWorksheet = (studentId: string, currentWorksheetNumber: number) => {
        // Find the student's existing worksheets to generate a unique entry ID
        const existingEntries = studentWorksheets.filter(sw => sw.studentId === studentId);
        const entryIndex = existingEntries.length;
        const baseWorksheet = existingEntries[0];

        if (!baseWorksheet) return;
        const maxWorksheetNumber = Math.max(...existingEntries.map(e => e.worksheetNumber || 0));

        const newWorksheet: StudentWorksheet = {
            worksheetEntryId: `${studentId}-${entryIndex}`,
            studentId: studentId,
            name: baseWorksheet.name,
            tokenNumber: baseWorksheet.tokenNumber,
            worksheetNumber: maxWorksheetNumber + 1,
            grade: '',
            isAbsent: false,
            isUploading: false,
            page1File: null,
            page2File: null,
            existing: false,
            isAdditional: true,
            isRepeated: false
        };

        // Insert after the last entry for this student
        setStudentWorksheets(prev => {
            const lastIndex = prev.findLastIndex(sw => sw.studentId === studentId);
            const newList = [...prev];
            newList.splice(lastIndex + 1, 0, newWorksheet);
            return newList;
        });
    };

    const handleRemoveWorksheet = async (worksheetEntryId: string) => {
        const worksheet = studentWorksheets.find(sw => sw.worksheetEntryId === worksheetEntryId);

        if (!worksheet) return;

        // If worksheet exists in DB (has an ID), delete it
        if (worksheet.id && worksheet.existing) {
            try {
                await worksheetAPI.deleteGradedWorksheet(worksheet.id);
                toast.success(`Worksheet deleted for ${worksheet.name}`);
            } catch (error) {
                console.error('Failed to delete worksheet:', error);
                toast.error(`Failed to delete worksheet for ${worksheet.name}`);
                return; // Don't remove from UI if DB delete failed
            }
        }

        // Remove from local state
        setStudentWorksheets(prev => prev.filter(sw => sw.worksheetEntryId !== worksheetEntryId));
    };

    const handleUpdateWorksheet = async (worksheetEntryId: string, field: string, value: any) => {

        const originalIndex = studentWorksheets.findIndex(w => w.worksheetEntryId === worksheetEntryId);


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
                    // Use the backend checkIsRepeated endpoint
                    const result = await worksheetAPI.checkIsRepeated(
                        selectedClass,
                        studentWorksheets[originalIndex].studentId,
                        newWorksheetNumber,
                        submittedOn
                    );
                    isRepeated = result.isRepeated;
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
    }; const handleUpload = async (worksheet: StudentWorksheet) => {
        if (!isOnline) {
            toast.error('You are offline. Reconnect to submit grading.');
            return { success: false };
        }

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
            sw.worksheetEntryId === worksheet.worksheetEntryId ? { ...sw, isUploading: true } : sw
        )); try {

            const formData = new FormData();


            formData.append('classId', selectedClass);
            formData.append('studentId', worksheet.studentId);
            formData.append('studentName', worksheet.name); // For GradingJob display
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
            // Get token from cookie (matching fetchAPI pattern)
            const token = document.cookie
                .split('; ')
                .find(row => row.startsWith('token='))
                ?.split('=')[1];

            const response = await fetch(`${API_URL}/worksheet-processing/process`, {
                method: 'POST',
                body: formData,
                headers: {
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {})
                }
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || errorData.message || 'Failed to process worksheet');
            }

            const result = await response.json();

            if (!result.success) {
                throw new Error(result.error || 'Error processing worksheet');
            }

            // New async job flow - get jobId and start polling
            if (result.jobId) {
                // Update card to show queued status
                setStudentWorksheets(prev => prev.map(sw =>
                    sw.worksheetEntryId === worksheet.worksheetEntryId
                        ? {
                            ...sw,
                            isUploading: true,
                            jobId: result.jobId,
                            jobStatus: 'QUEUED'
                        }
                        : sw
                ));

                // Start polling for job completion
                try {
                    const completedJob = await gradingJobsAPI.pollJobStatus(
                        result.jobId,
                        (job) => {
                            // Update status as it changes
                            setStudentWorksheets(prev => prev.map(sw =>
                                sw.worksheetEntryId === worksheet.worksheetEntryId
                                    ? { ...sw, jobStatus: job.status }
                                    : sw
                            ));
                        }
                    );

                    if (completedJob.status === 'COMPLETED') {
                        // Fetch the actual worksheet data to get grade.
                        // (Sometimes the job is marked COMPLETED before worksheetId is attached; handle that too.)
                        let wsData: any | null = null;

                        if (completedJob.worksheetId) {
                            wsData = await worksheetAPI.getWorksheetById(completedJob.worksheetId);
                        } else {
                            for (let attempt = 0; attempt < 3 && !wsData; attempt++) {
                                const all = await worksheetAPI.getAllWorksheetsByClassStudentDate(selectedClass, worksheet.studentId, submittedOn);
                                wsData =
                                    all.find((ws: any) => {
                                        const num = ws.worksheetNumber ?? ws.template?.worksheetNumber ?? 0;
                                        return num === worksheet.worksheetNumber;
                                    }) || null;

                                if (!wsData) {
                                    await new Promise((resolve) => setTimeout(resolve, 1000));
                                }
                            }
                        }

                        if (!wsData) {
                            throw new Error('Grading completed but worksheet could not be fetched yet');
                        }

                        const grade = wsData.grade || 0;
                        const gradingDetails = wsData.gradingDetails as GradingDetails;
                        // Use wrongQuestionNumbers from API (already calculated by backend)
                        const wrongQuestionNumbers = wsData.wrongQuestionNumbers || '';
                        const images = wsData.images || [];
                        const page1 = images.find((img: any) => img.pageNumber === 1);
                        const page2 = images.find((img: any) => img.pageNumber === 2);

                        setStudentWorksheets(prev => prev.map(sw =>
                            sw.worksheetEntryId === worksheet.worksheetEntryId
                                ? {
                                    ...sw,
                                    grade: grade.toString(),
                                    isUploading: false,
                                    jobStatus: 'COMPLETED',
                                    gradingDetails,
                                    wrongQuestionNumbers,
                                    page1Url: page1?.imageUrl ?? sw.page1Url,
                                    page2Url: page2?.imageUrl ?? sw.page2Url,
                                    page1File: null,
                                    page2File: null,
                                    existing: true,
                                    id: wsData.id || completedJob.worksheetId
                                }
                                : sw
                        ));

                        toast.success(`Worksheet for ${worksheet.name} graded! Score: ${grade}`);
                    } else if (completedJob.status === 'FAILED') {
                        throw new Error(completedJob.errorMessage || 'Grading failed');
                    }
                } catch (pollError) {
                    console.error('Polling error:', pollError);
                    const message = pollError instanceof Error ? pollError.message : 'Grading status tracking interrupted';
                    const likelyConnectivityError = isLikelyConnectivityError(pollError);

                    if (likelyConnectivityError) {
                        // Do not mark the job FAILED on client polling/network issues.
                        // Job continues on backend/queue and will resync on next refresh/focus.
                        setStudentWorksheets(prev => prev.map(sw =>
                            sw.worksheetEntryId === worksheet.worksheetEntryId
                                ? { ...sw, isUploading: true, jobStatus: sw.jobStatus || 'QUEUED' }
                                : sw
                        ));
                        toast.info(`Connection interrupted for ${worksheet.name}. Grading continues in background.`);
                        return { success: true, pending: true };
                    }

                    setStudentWorksheets(prev => prev.map(sw =>
                        sw.worksheetEntryId === worksheet.worksheetEntryId
                            ? { ...sw, isUploading: false }
                            : sw
                    ));
                    toast.error(`Could not track grading for ${worksheet.name}: ${message}`);
                    return { success: false };
                }

                return { success: true };
            }

            // Fallback for immediate response (shouldn't happen with new backend)
            const grade = result.grade || result.totalScore || 0;
            const roundedGrade = Math.max(0, Math.min(40, Math.round(grade)));

            setStudentWorksheets(prev => prev.map(sw =>
                sw.worksheetEntryId === worksheet.worksheetEntryId
                    ? {
                        ...sw,
                        grade: roundedGrade.toString(),
                        isUploading: false,
                        page1File: null,
                        page2File: null
                    }
                    : sw
            ));

            toast.success(`Worksheet for ${worksheet.name} processed! Grade: ${roundedGrade}`);
            return { success: true };
        } catch (error) {
            console.error('Upload error:', error);
            toast.error(`Failed to grade worksheet for ${worksheet.name}`);

            setStudentWorksheets(prev => prev.map(sw =>
                sw.worksheetEntryId === worksheet.worksheetEntryId
                    ? { ...sw, isUploading: false, jobStatus: undefined }
                    : sw
            ));

            return { success: false };
        }
    };
    const handleBatchProcess = async () => {
        if (!isOnline) {
            toast.error('You are offline. Reconnect to submit grading.');
            return;
        }

        const studentsWithFiles = studentWorksheets.filter(sw =>
            !sw.isAbsent && (sw.page1File || sw.page2File) && sw.worksheetNumber
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
            toast.info(`Uploading ${studentsWithFiles.length} worksheet${studentsWithFiles.length !== 1 ? 's' : ''} directly to storage`);

            const fileLookup = new Map<string, Map<number, File>>();
            const uploadRequest = studentsWithFiles.map((worksheet) => {
                const files: { pageNumber: number; fileName: string; mimeType: string; fileSize: number }[] = [];
                const pageFiles = new Map<number, File>();

                if (worksheet.page1File) {
                    files.push({
                        pageNumber: 1,
                        fileName: worksheet.page1File.name,
                        mimeType: worksheet.page1File.type || 'image/jpeg',
                        fileSize: worksheet.page1File.size
                    });
                    pageFiles.set(1, worksheet.page1File);
                }

                if (worksheet.page2File) {
                    files.push({
                        pageNumber: 2,
                        fileName: worksheet.page2File.name,
                        mimeType: worksheet.page2File.type || 'image/jpeg',
                        fileSize: worksheet.page2File.size
                    });
                    pageFiles.set(2, worksheet.page2File);
                }

                fileLookup.set(getWorksheetUploadKey(worksheet), pageFiles);

                return {
                    studentId: worksheet.studentId,
                    studentName: worksheet.name,
                    tokenNo: worksheet.tokenNumber,
                    worksheetNumber: worksheet.worksheetNumber,
                    worksheetName: worksheet.worksheetNumber.toString(),
                    isRepeated: !!worksheet.isRepeated,
                    files
                };
            });

            const session = await worksheetProcessingAPI.createDirectUploadSession(
                selectedClass,
                submittedOn,
                uploadRequest
            );

            window.localStorage.setItem(
                getUploadSessionStorageKey(selectedClass, submittedOn),
                JSON.stringify({ batchId: session.batchId, createdAt: new Date().toISOString() })
            );

            const uploadTasks = session.items.flatMap((item) =>
                item.files.map((slot) => ({
                    item,
                    slot,
                    file: fileLookup.get(`${item.studentId}:${item.worksheetNumber}`)?.get(slot.pageNumber)
                }))
            );

            const uploadConcurrency = getDirectUploadConcurrency();
            const uploadResults = await runWithConcurrency(
                uploadTasks,
                uploadConcurrency,
                async ({ slot, file }) => {
                    if (!file) {
                        throw new Error(`Missing local file for page ${slot.pageNumber}`);
                    }

                    if (!slot.uploadUrl) {
                        throw new Error(`Missing upload URL for page ${slot.pageNumber}`);
                    }

                    await uploadFileWithRetry(
                        slot.uploadUrl,
                        file,
                        file.type || slot.mimeType || 'image/jpeg',
                        slot.pageNumber
                    );

                    return slot.imageId;
                }
            );

            const uploadedImageIds = uploadResults
                .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
                .map((result) => result.value);
            const uploadFailures = uploadResults.filter((result) => result.status === 'rejected').length;

            const finalized = await worksheetProcessingAPI.finalizeDirectUploadSession(
                session.batchId,
                uploadedImageIds
            );

            const queuedByWorksheet = new Map(
                finalized.queued
                    .filter((item) => item.jobId)
                    .map((item) => [`${item.studentId}:${item.worksheetNumber}`, item])
            );

            setStudentWorksheets(prev => prev.map(sw => {
                const queued = queuedByWorksheet.get(getWorksheetUploadKey(sw));
                if (queued) {
                    return {
                        ...sw,
                        isUploading: true,
                        jobId: queued.jobId || sw.jobId,
                        jobStatus: 'QUEUED',
                        page1File: null,
                        page2File: null
                    };
                }

                if (studentsWithFiles.some((candidate) => candidate.worksheetEntryId === sw.worksheetEntryId)) {
                    return {
                        ...sw,
                        isUploading: false
                    };
                }

                return sw;
            }));

            if (finalized.status === 'FINALIZED') {
                window.localStorage.removeItem(getUploadSessionStorageKey(selectedClass, submittedOn));
            }

            if (finalized.queued.length > 0) {
                toast.success(
                    `Queued ${finalized.queued.length} worksheet${finalized.queued.length !== 1 ? 's' : ''}. Grading will continue in the background.`
                );
            }

            if (finalized.pending.length > 0 || uploadFailures > 0) {
                toast.error(
                    `${finalized.pending.length || uploadFailures} worksheet${(finalized.pending.length || uploadFailures) !== 1 ? 's' : ''} did not finish uploading. Keep the page open and retry.`
                );
            }

            if (finalized.failed.length > 0) {
                toast.error(`Failed to queue ${finalized.failed.length} worksheet${finalized.failed.length !== 1 ? 's' : ''}.`);
            }

            posthog.capture('direct_class_upload_queued', {
                classId: selectedClass,
                submittedOn,
                worksheetsCount: studentsWithFiles.length,
                queuedCount: finalized.queued.length,
                pendingCount: finalized.pending.length,
                failedCount: finalized.failed.length,
                uploadFailures,
                uploadConcurrency
            });
        } catch (error) {
            console.error('Direct batch upload failed:', error);
            setStudentWorksheets(prev => prev.map(sw =>
                studentsWithFiles.some(s => s.worksheetEntryId === sw.worksheetEntryId)
                    ? { ...sw, isUploading: false }
                    : sw
            ));
            toast.error('Failed to process worksheets');
        }
    };


    const handleSaveStudent = async (worksheet: StudentWorksheet) => {
        if (!isOnline) {
            toast.error('You are offline. Reconnect to save changes.');
            return;
        }

        if (!selectedClass) {
            toast.error('Please select a class first');
            return;
        }

        try {
            // Get the most up-to-date data for this specific worksheet entry from the main state
            const currentStudentData = studentWorksheets.find(w => w.worksheetEntryId === worksheet.worksheetEntryId);
            if (!currentStudentData) {
                toast.error('Worksheet data not found');
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

                    // Check if this specific worksheet already exists in DB (has an ID)
                    // This allows multiple worksheets per student per date
                    if (currentStudentData.id && currentStudentData.existing) {
                        // Update existing worksheet
                        await worksheetAPI.updateGradedWorksheet(currentStudentData.id, data);
                    } else {
                        // Create new worksheet
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
                            action: (currentStudentData.id && currentStudentData.existing) ? 'update' : 'create',
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
        if (!isOnline) {
            toast.error('You are offline. Reconnect to save changes.');
            return;
        }

        setIsSaving(true);

        try {
            const studentsToSave = studentWorksheets.filter(worksheet => {
                if (worksheet.isAbsent) {
                    return true;
                }

                const gradeValue = typeof worksheet.grade === 'string' ? worksheet.grade.trim() : '';
                const hasValidGrade = gradeValue !== '' && !isNaN(parseFloat(gradeValue));

                return worksheet.worksheetNumber > 0 && hasValidGrade;
            });

            if (studentsToSave.length === 0) {
                toast.error('No students to save. Please mark students as absent or assign worksheet numbers with grades.');
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

                        if (worksheet.id && worksheet.existing) {
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

                        if (worksheet.id && worksheet.existing) {
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
                                action: (worksheet.id && worksheet.existing) ? 'update' : 'create',
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
                let message = `Successfully saved ${savedCount} student${savedCount !== 1 ? 's' : ''}`;

                if (failedCount > 0) {
                    message += `. ${failedCount} failed to save`;
                }

                toast.success(message);

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

    const handleMarkAllWithoutGradeAsAbsent = () => {
        // Use flat list for marking absent - filter by search if needed
        const worksheetsToCheck = searchTerm.trim()
            ? sortedStudentWorksheets.filter(ws =>
                ws.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                ws.tokenNumber.toLowerCase().includes(searchTerm.toLowerCase()))
            : studentWorksheets;
        const studentsWithoutGrades = worksheetsToCheck.filter(worksheet =>
            !worksheet.isAbsent &&
            (!worksheet.grade || worksheet.grade.trim() === '')
        );

        if (studentsWithoutGrades.length === 0) {
            toast.info('No students without grades found to mark as absent.');
            return;
        }

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
    }

    return (
        <div className="bg-white rounded-lg shadow-sm">
            <div className="p-4 md:p-6">
                <h2 className="text-lg font-semibold mb-1">Upload Worksheet Images</h2>
                <p className="text-sm text-gray-600 mb-4">
                    Select class and date, then upload and grade worksheets for each student.
                </p>

                {/* Grading Jobs Status Dashboard */}
                <GradingJobsStatus className="mb-6" />
                {!isOnline && (
                    <div className="mb-6 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
                        You are offline. Upload, AI Grade, and Save actions are disabled until connection is restored.
                    </div>
                )}
                {selectedClass && (
                    <div className="mb-6 space-y-3 md:space-y-0 md:flex md:items-center md:space-x-6 text-sm">
                        <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 md:justify-start md:space-x-2">
                            <span className="font-medium">Students Graded:</span>
                            <span className="font-semibold text-blue-600">{gradedCount} / {totalStudents}</span>
                        </div>
                        <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 md:justify-start md:space-x-2">
                            <span className="font-medium">Worksheets Graded:</span>
                            <span className="font-semibold text-purple-600">{totalGradedWorksheets}</span>
                        </div>
                        <div className="flex items-center justify-between bg-gray-50 rounded-md px-3 py-2 md:justify-start md:space-x-2">
                            <span className="font-medium">Absent:</span>
                            <span className="font-semibold text-orange-600">{absentCount}</span>
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
                                        const worksheetsToCheck = searchTerm.trim()
                                            ? sortedStudentWorksheets.filter(ws =>
                                                ws.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                                                ws.tokenNumber.toLowerCase().includes(searchTerm.toLowerCase()))
                                            : studentWorksheets;
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
                                {filteredGroupedStudentWorksheets.length > 0 ? (
                                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 p-2 md:p-0">
                                        {filteredGroupedStudentWorksheets.map((group) => (
                                            <StudentWorksheetCard
                                                key={group.studentId}
                                                worksheets={group.worksheets}
                                                studentId={group.studentId}
                                                studentName={group.studentName}
                                                tokenNumber={group.tokenNumber}
                                                onUpdate={handleUpdateWorksheet}
                                                onPageFileChange={handlePageFileChange}
                                                onUpload={handleUpload}
                                                onSave={handleSaveStudent}
                                                onAddWorksheet={handleAddWorksheet}
                                                onRemoveWorksheet={handleRemoveWorksheet}
                                                isOffline={!isOnline}
                                            />
                                        ))}
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
                                    disabled={!isOnline || isSaving || sortedStudentWorksheets.some(ws => ws.isUploading) ||
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
                                    disabled={!isOnline || isSaving || sortedStudentWorksheets.some(ws => ws.isUploading)}
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
                                            disabled={!isOnline || isSaving || sortedStudentWorksheets.some(ws => ws.isUploading) ||
                                                !studentWorksheets.some(ws => !ws.isAbsent && (ws.page1File || ws.page2File) && ws.worksheetNumber)}
                                            className="flex-1 h-12 text-sm font-medium"
                                            variant="secondary"
                                        >
                                            AI Grade All
                                        </Button>
                                        <Button
                                            onClick={handleSaveAllChanges}
                                            disabled={!isOnline || isSaving || sortedStudentWorksheets.some(ws => ws.isUploading)}
                                            className="flex-1 h-12 text-sm font-medium"
                                        >
                                            {isSaving ? 'Saving...' : 'Save All'}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            <div className="text-sm text-muted-foreground px-2 md:px-0">
                                {searchTerm.trim() ? (
                                    <>Showing {filteredGroupedStudentWorksheets.length} of {groupedStudentWorksheets.length} students</>
                                ) : (
                                    <>Showing {groupedStudentWorksheets.length} students</>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
