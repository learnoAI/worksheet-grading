'use client';

import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { classAPI } from '@/lib/api/class';
import { worksheetAPI } from '@/lib/api/worksheet';
import { worksheetProcessingAPI } from '@/lib/api/worksheetProcessing';
import { gradingJobsAPI, type GradingJob } from '@/lib/api/gradingJobs';
import type {
    DirectUploadItem,
    DirectUploadFileSlot,
    DirectUploadSession,
    FinalizeDirectUploadSessionResponse
} from '@/lib/api/worksheetProcessing';
import { GradingJobsStatus } from '@/components/GradingJobsStatus';
import { StudentWorksheetCard } from './student-worksheet-card';
import { usePostHog } from 'posthog-js/react';

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

type StudentWorksheetUpdateField =
    | 'isAbsent'
    | 'isIncorrectGrade'
    | 'worksheetNumber'
    | 'grade'
    | 'wrongQuestionNumbers'
    | 'page1File'
    | 'page2File';

type StudentWorksheetUpdateValue = StudentWorksheet[StudentWorksheetUpdateField];

const DIRECT_UPLOAD_DEFAULT_CONCURRENCY = 4;
const DIRECT_UPLOAD_MIN_CONCURRENCY = 2;
const DIRECT_UPLOAD_MAX_ATTEMPTS = 3;
const DIRECT_UPLOAD_ATTEMPT_TIMEOUT_MS = parseNumberEnv(
    process.env.NEXT_PUBLIC_DIRECT_UPLOAD_ATTEMPT_TIMEOUT_MS,
    20_000
);
const DIRECT_UPLOAD_IMAGE_COMPRESSION_ENABLED = process.env.NEXT_PUBLIC_DIRECT_UPLOAD_IMAGE_COMPRESSION !== 'false';
const DIRECT_UPLOAD_IMAGE_MAX_LONG_EDGE = parseNumberEnv(process.env.NEXT_PUBLIC_DIRECT_UPLOAD_IMAGE_MAX_LONG_EDGE, 1800);
const DIRECT_UPLOAD_IMAGE_COMPRESSION_MIN_BYTES = parseNumberEnv(
    process.env.NEXT_PUBLIC_DIRECT_UPLOAD_IMAGE_COMPRESSION_MIN_BYTES,
    750 * 1024
);
const DIRECT_UPLOAD_WEBP_QUALITY = parseNumberEnv(process.env.NEXT_PUBLIC_DIRECT_UPLOAD_WEBP_QUALITY, 0.82);
const DIRECT_UPLOAD_JPEG_FALLBACK_QUALITY = parseNumberEnv(
    process.env.NEXT_PUBLIC_DIRECT_UPLOAD_JPEG_FALLBACK_QUALITY,
    0.84
);

type BrowserNetworkInformation = {
    effectiveType?: string;
    saveData?: boolean;
};

type DirectUploadCompressionMethod = 'skipped' | 'webp' | 'jpeg_fallback' | 'original_fallback';

interface PreparedDirectUploadFile {
    file: File;
    fileName: string;
    mimeType: string;
    fileSize: number;
    originalFileName: string;
    originalMimeType: string;
    originalFileSize: number;
    method: DirectUploadCompressionMethod;
    compressionMs: number;
    width?: number;
    height?: number;
    outputWidth?: number;
    outputHeight?: number;
    fallbackReason?: string;
}

interface DirectUploadPreparationTask {
    worksheetKey: string;
    pageNumber: number;
    file: File;
}

interface DirectUploadTask {
    item: DirectUploadItem;
    slot: DirectUploadFileSlot;
    file?: PreparedDirectUploadFile;
}

type ClassWorksheetsForDateData = Awaited<ReturnType<typeof worksheetAPI.getClassWorksheetsForDate>>;
type ClassJobsForDateData = Awaited<ReturnType<typeof gradingJobsAPI.getJobsByClassAndDate>>;

interface TeacherWorksheetLoadData {
    batchData: ClassWorksheetsForDateData;
    jobsResponse: ClassJobsForDateData | null;
    uploadSession: DirectUploadSession | null;
}

interface GradingJobPollingTarget {
    jobId: string;
    studentId?: string | null;
    studentName?: string | null;
    worksheetNumber: number;
    worksheetEntryId?: string;
    showSuccessToast?: boolean;
    showFailureToast?: boolean;
}

interface LoadedImageElement {
    image: HTMLImageElement;
    release: () => void;
}

function parseNumberEnv(value: string | undefined, fallback: number): number {
    if (!value) {
        return fallback;
    }

    const parsed = Number(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLocalDateInputValue(date = new Date()): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

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

function getDirectUploadImagePreparationConcurrency(): number {
    if (typeof navigator === 'undefined') {
        return 1;
    }

    const navigatorWithDeviceMemory = navigator as Navigator & { deviceMemory?: number };
    if (navigatorWithDeviceMemory.deviceMemory && navigatorWithDeviceMemory.deviceMemory <= 2) {
        return 1;
    }

    if (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4) {
        return 1;
    }

    return 2;
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

function getErrorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

function getUploadFailureSummary(results: PromiseSettledResult<unknown>[]): string {
    const firstRejected = results.find((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (!firstRejected) {
        return 'Unknown upload error';
    }

    return getErrorMessage(firstRejected.reason);
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
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;

        try {
            if (controller) {
                timeoutId = setTimeout(() => {
                    controller.abort();
                }, DIRECT_UPLOAD_ATTEMPT_TIMEOUT_MS);
            }

            response = await fetch(uploadUrl, {
                method: 'PUT',
                headers: {
                    'Content-Type': contentType
                },
                body: file,
                signal: controller?.signal
            });
        } catch (error) {
            const errorName = error instanceof Error ? error.name : '';
            lastError = errorName === 'AbortError'
                ? new Error(`Storage upload timed out for page ${pageNumber}`)
                : error;

            if (attempt < DIRECT_UPLOAD_MAX_ATTEMPTS) {
                await sleep(getUploadRetryDelayMs(attempt));
            }

            continue;
        } finally {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
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

function supportsClientImageCompression(): boolean {
    return (
        typeof window !== 'undefined' &&
        typeof document !== 'undefined' &&
        typeof File !== 'undefined' &&
        typeof URL !== 'undefined'
    );
}

function getUploadFileBaseName(fileName: string): string {
    const trimmed = fileName.trim() || 'worksheet-page';
    const lastDot = trimmed.lastIndexOf('.');
    return lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed;
}

function getCompressedFileName(fileName: string, mimeType: string): string {
    const extension = mimeType === 'image/webp' ? 'webp' : 'jpg';
    return `${getUploadFileBaseName(fileName)}.${extension}`;
}

function getScaledDimensions(width: number, height: number): { width: number; height: number } {
    const maxLongEdge = Math.max(1, DIRECT_UPLOAD_IMAGE_MAX_LONG_EDGE);
    const longEdge = Math.max(width, height);

    if (longEdge <= maxLongEdge) {
        return { width, height };
    }

    const scale = maxLongEdge / longEdge;
    return {
        width: Math.max(1, Math.round(width * scale)),
        height: Math.max(1, Math.round(height * scale))
    };
}

function canvasToBlob(canvas: HTMLCanvasElement, mimeType: string, quality: number): Promise<Blob | null> {
    return new Promise((resolve) => {
        canvas.toBlob(resolve, mimeType, quality);
    });
}

function getUploadNowMs(): number {
    return typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
}

async function loadImageElement(file: File): Promise<LoadedImageElement> {
    const objectUrl = URL.createObjectURL(file);

    const image = new Image();
    image.decoding = 'async';

    await new Promise<void>((resolve, reject) => {
        image.onload = () => resolve();
        image.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Browser could not decode image'));
        };
        image.src = objectUrl;
    });

    return {
        image,
        release: () => URL.revokeObjectURL(objectUrl)
    };
}

function originalUploadFile(file: File, method: DirectUploadCompressionMethod, startedAt: number, fallbackReason?: string): PreparedDirectUploadFile {
    return {
        file,
        fileName: file.name,
        mimeType: file.type || 'image/jpeg',
        fileSize: file.size,
        originalFileName: file.name,
        originalMimeType: file.type || 'application/octet-stream',
        originalFileSize: file.size,
        method,
        compressionMs: Math.max(0, Math.round(getUploadNowMs() - startedAt)),
        fallbackReason
    };
}

async function prepareImageForDirectUpload(file: File): Promise<PreparedDirectUploadFile> {
    const startedAt = getUploadNowMs();

    if (!DIRECT_UPLOAD_IMAGE_COMPRESSION_ENABLED) {
        return originalUploadFile(file, 'skipped', startedAt, 'disabled');
    }

    if (!supportsClientImageCompression()) {
        return originalUploadFile(file, 'original_fallback', startedAt, 'unsupported_browser');
    }

    if (!file.type.startsWith('image/')) {
        return originalUploadFile(file, 'original_fallback', startedAt, 'not_image');
    }

    if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
        return originalUploadFile(file, 'skipped', startedAt, 'unsupported_image_type');
    }

    if (file.size < DIRECT_UPLOAD_IMAGE_COMPRESSION_MIN_BYTES) {
        return originalUploadFile(file, 'skipped', startedAt, 'below_size_threshold');
    }

    try {
        const loadedImage = await loadImageElement(file);
        const image = loadedImage.image;
        const sourceWidth = image.naturalWidth || image.width;
        const sourceHeight = image.naturalHeight || image.height;

        try {
            if (!sourceWidth || !sourceHeight) {
                return originalUploadFile(file, 'original_fallback', startedAt, 'missing_dimensions');
            }

            const output = getScaledDimensions(sourceWidth, sourceHeight);
            const canvas = document.createElement('canvas');
            canvas.width = output.width;
            canvas.height = output.height;

            const context = canvas.getContext('2d', { alpha: false });
            if (!context) {
                return originalUploadFile(file, 'original_fallback', startedAt, 'canvas_context_unavailable');
            }

            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, output.width, output.height);
            context.drawImage(image, 0, 0, output.width, output.height);

            let blob = await canvasToBlob(canvas, 'image/webp', DIRECT_UPLOAD_WEBP_QUALITY);
            let mimeType = blob?.type === 'image/webp' ? 'image/webp' : '';
            let method: DirectUploadCompressionMethod = 'webp';

            if (!blob || mimeType !== 'image/webp') {
                blob = await canvasToBlob(canvas, 'image/jpeg', DIRECT_UPLOAD_JPEG_FALLBACK_QUALITY);
                mimeType = blob?.type === 'image/jpeg' ? 'image/jpeg' : '';
                method = 'jpeg_fallback';
            }

            if (!blob || !mimeType) {
                return originalUploadFile(file, 'original_fallback', startedAt, 'canvas_to_blob_failed');
            }

            const shouldKeepOriginal =
                blob.size >= file.size * 0.98 &&
                output.width === sourceWidth &&
                output.height === sourceHeight;

            if (shouldKeepOriginal) {
                return {
                    ...originalUploadFile(file, 'skipped', startedAt, 'compressed_not_smaller'),
                    width: sourceWidth,
                    height: sourceHeight,
                    outputWidth: output.width,
                    outputHeight: output.height
                };
            }

            const compressedFile = new File([blob], getCompressedFileName(file.name, mimeType), {
                type: mimeType,
                lastModified: file.lastModified
            });

            return {
                file: compressedFile,
                fileName: compressedFile.name,
                mimeType,
                fileSize: compressedFile.size,
                originalFileName: file.name,
                originalMimeType: file.type || 'application/octet-stream',
                originalFileSize: file.size,
                method,
                compressionMs: Math.max(0, Math.round(getUploadNowMs() - startedAt)),
                width: sourceWidth,
                height: sourceHeight,
                outputWidth: output.width,
                outputHeight: output.height
            };
        } finally {
            loadedImage.release();
        }
    } catch (error) {
        const fallbackReason = error instanceof Error ? error.message : 'compression_failed';
        return originalUploadFile(file, 'original_fallback', startedAt, fallbackReason);
    }
}

function summarizePreparedUploadFiles(preparedFiles: PreparedDirectUploadFile[]) {
    const originalBytes = preparedFiles.reduce((total, file) => total + file.originalFileSize, 0);
    const uploadBytes = preparedFiles.reduce((total, file) => total + file.fileSize, 0);
    const savedBytes = Math.max(0, originalBytes - uploadBytes);
    const compressionMs = preparedFiles.reduce((total, file) => total + file.compressionMs, 0);

    return {
        filesCount: preparedFiles.length,
        originalBytes,
        uploadBytes,
        savedBytes,
        savedPercent: originalBytes > 0 ? Math.round((savedBytes / originalBytes) * 100) : 0,
        webpCount: preparedFiles.filter((file) => file.method === 'webp').length,
        jpegFallbackCount: preparedFiles.filter((file) => file.method === 'jpeg_fallback').length,
        originalFallbackCount: preparedFiles.filter((file) => file.method === 'original_fallback').length,
        skippedCount: preparedFiles.filter((file) => file.method === 'skipped').length,
        compressionMs
    };
}

function formatUploadBytes(bytes: number): string {
    if (bytes >= 1024 * 1024) {
        return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    }

    return `${Math.round(bytes / 1024)} KB`;
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

function hasSubmittedWorksheet(worksheet: StudentWorksheet): boolean {
    return !worksheet.isAbsent && (
        !!worksheet.id ||
        !!worksheet.existing ||
        !!worksheet.jobId ||
        worksheet.isUploading ||
        !!worksheet.page1File ||
        !!worksheet.page2File ||
        !!worksheet.page1Url ||
        !!worksheet.page2Url ||
        (typeof worksheet.grade === 'string' && worksheet.grade.trim() !== '')
    );
}

function getUploadSessionStorageKey(classId: string, submittedOn: string): string {
    return `worksheet-upload-session:${classId}:${submittedOn}`;
}

function getStoredUploadBatchId(classId: string, submittedOn: string): string | null {
    if (typeof window === 'undefined') {
        return null;
    }

    const storageKey = getUploadSessionStorageKey(classId, submittedOn);

    try {
        const storedSession = window.localStorage.getItem(storageKey);
        const storedBatchId = storedSession ? JSON.parse(storedSession).batchId : null;
        return typeof storedBatchId === 'string' && storedBatchId.length > 0 ? storedBatchId : null;
    } catch {
        window.localStorage.removeItem(storageKey);
        return null;
    }
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
    const queryClient = useQueryClient();
    const [isSaving, setIsSaving] = useState(false);
    const [selectedClass, setSelectedClass] = useState<string>('');
    const [submittedOn, setSubmittedOn] = useState<string>(() => getLocalDateInputValue());
    const [searchTerm, setSearchTerm] = useState<string>('');
    const [isOnline, setIsOnline] = useState(true);
    const [isBatchUploading, setIsBatchUploading] = useState(false);
    const [studentWorksheets, setStudentWorksheets] = useState<StudentWorksheet[]>([]);
    const [activeJobTargets, setActiveJobTargets] = useState<GradingJobPollingTarget[]>([]);
    const handledTerminalJobIdsRef = useRef(new Set<string>());

    const classesQuery = useQuery({
        queryKey: ['teacherClasses', user?.id],
        enabled: !!user?.id,
        queryFn: () => classAPI.getTeacherClasses(user!.id),
        staleTime: 5 * 60 * 1000
    });

    const classDateQuery = useQuery<TeacherWorksheetLoadData>({
        queryKey: ['teacherWorksheetUpload', selectedClass, submittedOn],
        enabled: !!selectedClass,
        queryFn: async () => {
            const storedBatchId = getStoredUploadBatchId(selectedClass, submittedOn);
            const storageKey = getUploadSessionStorageKey(selectedClass, submittedOn);

            const [batchData, jobsResponse, uploadSession] = await Promise.all([
                worksheetAPI.getClassWorksheetsForDate(selectedClass, submittedOn),
                gradingJobsAPI.getJobsByClassAndDate(selectedClass, submittedOn).catch(() => null),
                storedBatchId
                    ? worksheetProcessingAPI.getDirectUploadSession(storedBatchId).catch(() => {
                        window.localStorage.removeItem(storageKey);
                        return null;
                    })
                    : Promise.resolve(null)
            ]);

            return { batchData, jobsResponse, uploadSession };
        },
        staleTime: 60 * 1000,
        refetchOnReconnect: false,
        refetchOnWindowFocus: false
    });

    const classes = classesQuery.data || [];
    const isLoading = classesQuery.isLoading;
    const isFetchingTableData = !!selectedClass && classDateQuery.isLoading;


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

    const hasUploadingWorksheet = useMemo(() => (
        sortedStudentWorksheets.some(ws => ws.isUploading)
    ), [sortedStudentWorksheets]);

    const eligibleUploadCount = useMemo(() => (
        studentWorksheets.filter(ws =>
            !ws.isAbsent && (ws.page1File || ws.page2File) && ws.worksheetNumber
        ).length
    ), [studentWorksheets]);

    const ungradedWithoutGradeCount = useMemo(() => {
        const worksheetsToCheck = searchTerm.trim()
            ? sortedStudentWorksheets.filter(ws =>
                ws.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
                ws.tokenNumber.toLowerCase().includes(searchTerm.toLowerCase()))
            : studentWorksheets;
        const studentsWithSubmittedWorksheets = new Set(
            studentWorksheets
                .filter(hasSubmittedWorksheet)
                .map(worksheet => worksheet.studentId)
        );

        return new Set(worksheetsToCheck.filter(worksheet =>
            !worksheet.isAbsent &&
            !studentsWithSubmittedWorksheets.has(worksheet.studentId) &&
            (!worksheet.grade || worksheet.grade.trim() === '')
        ).map(worksheet => worksheet.studentId)).size;
    }, [searchTerm, sortedStudentWorksheets, studentWorksheets]);

    const activeJobIds = useMemo(() => (
        activeJobTargets.map((target) => target.jobId).sort()
    ), [activeJobTargets]);

    const activeJobTargetsById = useMemo(() => (
        new Map(activeJobTargets.map((target) => [target.jobId, target]))
    ), [activeJobTargets]);

    const trackGradingJobs = useCallback((targets: GradingJobPollingTarget[]) => {
        if (targets.length === 0) {
            return;
        }

        setActiveJobTargets(prev => {
            const targetByJobId = new Map(prev.map((target) => [target.jobId, target]));

            for (const target of targets) {
                handledTerminalJobIdsRef.current.delete(target.jobId);
                targetByJobId.set(target.jobId, {
                    ...targetByJobId.get(target.jobId),
                    ...target
                });
            }

            return Array.from(targetByJobId.values());
        });
    }, []);

    const removeTrackedJobs = useCallback((jobIds: string[]) => {
        if (jobIds.length === 0) {
            return;
        }

        const jobIdSet = new Set(jobIds);
        setActiveJobTargets(prev => prev.filter((target) => !jobIdSet.has(target.jobId)));
    }, []);

    const activeJobStatusQuery = useQuery({
        queryKey: ['gradingJobs', 'batchStatus', activeJobIds],
        enabled: activeJobIds.length > 0,
        queryFn: () => gradingJobsAPI.getBatchJobStatus(activeJobIds),
        refetchInterval: activeJobIds.length > 0 ? 3000 : false,
        staleTime: 0,
        retry: 3
    });

    const updatePollingTarget = useCallback((
        target: GradingJobPollingTarget,
        updater: (worksheet: StudentWorksheet) => StudentWorksheet
    ) => {
        const targetKey = target.studentId
            ? `${target.studentId}:${target.worksheetNumber}`
            : null;

        setStudentWorksheets(prev => prev.map(sw => {
            const matchesTarget =
                sw.jobId === target.jobId ||
                (!!target.worksheetEntryId && sw.worksheetEntryId === target.worksheetEntryId) ||
                (!!targetKey && getWorksheetUploadKey(sw) === targetKey);

            return matchesTarget ? updater(sw) : sw;
        }));
    }, []);

    const fetchCompletedWorksheetForJob = useCallback(async (
        completedJob: GradingJob,
        target: GradingJobPollingTarget
    ): Promise<any | null> => {
        if (completedJob.worksheetId) {
            return worksheetAPI.getWorksheetById(completedJob.worksheetId);
        }

        const studentId = completedJob.studentId || target.studentId;
        const worksheetNumber = completedJob.worksheetNumber || target.worksheetNumber;
        if (!studentId || !worksheetNumber) {
            return null;
        }

        for (let attempt = 0; attempt < 3; attempt += 1) {
            const all = await worksheetAPI.getAllWorksheetsByClassStudentDate(selectedClass, studentId, submittedOn);
            const gradedWs =
                all.find((ws: any) => {
                    const num = ws.worksheetNumber ?? ws.template?.worksheetNumber ?? 0;
                    return num === worksheetNumber;
                }) || null;

            if (gradedWs) {
                return gradedWs;
            }

            await sleep(1000);
        }

        return null;
    }, [selectedClass, submittedOn]);

    const handleCompletedGradingJob = useCallback(async (
        completedJob: GradingJob,
        target: GradingJobPollingTarget
    ) => {
        try {
            const gradedWs = await fetchCompletedWorksheetForJob(completedJob, target);

            if (!gradedWs) {
                updatePollingTarget(target, (worksheet) => ({
                    ...worksheet,
                    isUploading: false,
                    jobStatus: 'COMPLETED'
                }));
                removeTrackedJobs([target.jobId]);
                return;
            }

            const grade = gradedWs.grade ?? 0;
            const gradingDetails = gradedWs.gradingDetails as GradingDetails;
            const wrongQuestionNumbers = gradedWs.wrongQuestionNumbers || '';
            const images = gradedWs.images || [];
            const page1 = images.find((img: any) => img.pageNumber === 1);
            const page2 = images.find((img: any) => img.pageNumber === 2);

            updatePollingTarget(target, (worksheet) => ({
                ...worksheet,
                grade: grade.toString(),
                isUploading: false,
                jobStatus: 'COMPLETED',
                gradingDetails,
                wrongQuestionNumbers,
                page1Url: page1?.imageUrl ?? worksheet.page1Url,
                page2Url: page2?.imageUrl ?? worksheet.page2Url,
                page1File: null,
                page2File: null,
                existing: true,
                id: gradedWs.id || completedJob.worksheetId || worksheet.id
            }));

            if (target.showSuccessToast) {
                toast.success(`Worksheet for ${target.studentName || 'student'} graded! Score: ${grade}`);
            }
        } catch (error) {
            console.error('Completed grading job hydration failed:', error);
            updatePollingTarget(target, (worksheet) => ({
                ...worksheet,
                isUploading: false,
                jobStatus: 'COMPLETED'
            }));
        } finally {
            removeTrackedJobs([target.jobId]);
            queryClient.invalidateQueries({ queryKey: ['teacherJobsToday'] });
        }
    }, [fetchCompletedWorksheetForJob, queryClient, removeTrackedJobs, updatePollingTarget]);

    useEffect(() => {
        const jobs = activeJobStatusQuery.data?.jobs;
        if (!jobs?.length) {
            return;
        }

        for (const job of jobs) {
            const target = activeJobTargetsById.get(job.id);
            if (!target) {
                continue;
            }

            if (job.status === 'QUEUED' || job.status === 'PROCESSING') {
                updatePollingTarget(target, (worksheet) => ({
                    ...worksheet,
                    jobId: target.jobId,
                    jobStatus: job.status,
                    isUploading: true
                }));
                continue;
            }

            if (handledTerminalJobIdsRef.current.has(job.id)) {
                continue;
            }
            handledTerminalJobIdsRef.current.add(job.id);

            if (job.status === 'COMPLETED') {
                void handleCompletedGradingJob(job, target);
                continue;
            }

            if (job.status === 'FAILED') {
                updatePollingTarget(target, (worksheet) => ({
                    ...worksheet,
                    isUploading: false,
                    jobStatus: 'FAILED'
                }));

                if (target.showFailureToast) {
                    toast.error(`Could not track grading for ${target.studentName || 'student'}: ${job.errorMessage || 'Grading failed'}`);
                }

                removeTrackedJobs([job.id]);
                queryClient.invalidateQueries({ queryKey: ['teacherJobsToday'] });
            }
        }
    }, [
        activeJobStatusQuery.data?.jobs,
        activeJobTargetsById,
        handleCompletedGradingJob,
        queryClient,
        removeTrackedJobs,
        updatePollingTarget
    ]);

    useEffect(() => {
        if (!activeJobStatusQuery.error) {
            return;
        }

        const likelyConnectivityError = isLikelyConnectivityError(activeJobStatusQuery.error);
        if (!likelyConnectivityError) {
            console.error('Batch grading status polling error:', activeJobStatusQuery.error);
        }
    }, [activeJobStatusQuery.error]);


    useEffect(() => {
        if (classesQuery.error) {
            toast.error('Failed to load initial data');
        }
    }, [classesQuery.error]);

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
        setActiveJobTargets([]);
        handledTerminalJobIdsRef.current.clear();

        if (!selectedClass) {
            setStudentWorksheets([]);
        }
    }, [selectedClass, submittedOn]);

    useEffect(() => {
        if (classDateQuery.error) {
            toast.error('Failed to load student data');
        }
    }, [classDateQuery.error]);

    useEffect(() => {
        if (!selectedClass || !classDateQuery.data) {
            return;
        }

        const { batchData, jobsResponse, uploadSession } = classDateQuery.data;
        const { students, worksheetsByStudent, studentSummaries } = batchData;
        const sortedStudents = sortStudentsByTokenNumber(students);
        const newActiveJobTargets: GradingJobPollingTarget[] = [];

        const worksheetArrays: StudentWorksheet[][] = sortedStudents.map((student) => {
            const worksheetsOnDate = worksheetsByStudent[student.id] || [];

            if (worksheetsOnDate.length > 0) {
                const sortedWorksheets = [...worksheetsOnDate].sort((a: any, b: any) => {
                    const wsNumA = (a.worksheetNumber > 0 ? a.worksheetNumber : a.template?.worksheetNumber) || 0;
                    const wsNumB = (b.worksheetNumber > 0 ? b.worksheetNumber : b.template?.worksheetNumber) || 0;
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

            const summary = studentSummaries[student.id];
            const hasHistory = summary && summary.lastWorksheetNumber !== null;
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

        let worksheets = worksheetArrays.flat();

        const activeJobs = (jobsResponse?.jobs || []).filter(j =>
            j.status === 'QUEUED' || j.status === 'PROCESSING'
        );

        if (activeJobs.length > 0) {
            const matchedJobIds = new Set<string>();
            const activeJobByWorksheet = new Map(
                activeJobs
                    .filter((job) => job.studentId)
                    .map((job) => [`${job.studentId}:${job.worksheetNumber}`, job])
            );

            worksheets = worksheets.map(ws => {
                const matchingJob = activeJobByWorksheet.get(getWorksheetUploadKey(ws));
                if (!matchingJob) {
                    return ws;
                }

                matchedJobIds.add(matchingJob.id);
                newActiveJobTargets.push({
                    jobId: matchingJob.id,
                    studentId: matchingJob.studentId,
                    studentName: matchingJob.studentName,
                    worksheetNumber: matchingJob.worksheetNumber
                });

                return {
                    ...ws,
                    isUploading: true,
                    jobId: matchingJob.id,
                    jobStatus: matchingJob.status
                };
            });

            const baseWorksheetByStudent = new Map<string, StudentWorksheet>();
            const worksheetCountByStudent = new Map<string, number>();
            for (const worksheet of worksheets) {
                if (!baseWorksheetByStudent.has(worksheet.studentId)) {
                    baseWorksheetByStudent.set(worksheet.studentId, worksheet);
                }
                worksheetCountByStudent.set(
                    worksheet.studentId,
                    (worksheetCountByStudent.get(worksheet.studentId) || 0) + 1
                );
            }

            for (const job of activeJobs) {
                if (matchedJobIds.has(job.id)) {
                    continue;
                }

                const baseWorksheet = job.studentId ? baseWorksheetByStudent.get(job.studentId) : null;
                if (!baseWorksheet || !job.studentId) {
                    continue;
                }

                const existingCount = worksheetCountByStudent.get(job.studentId) || 0;
                worksheetCountByStudent.set(job.studentId, existingCount + 1);
                newActiveJobTargets.push({
                    jobId: job.id,
                    studentId: job.studentId,
                    studentName: job.studentName,
                    worksheetNumber: job.worksheetNumber
                });

                worksheets.push({
                    worksheetEntryId: `${job.studentId}-${existingCount}`,
                    studentId: job.studentId,
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
                });
            }
        }

        if (uploadSession) {
            const queuedItems = uploadSession.items.filter((item) => item.status === 'QUEUED' && item.jobId);

            if (queuedItems.length > 0) {
                const queuedByWorksheet = new Map(
                    queuedItems.map((item) => [`${item.studentId}:${item.worksheetNumber}`, item])
                );

                worksheets = worksheets.map((ws) => {
                    const queued = queuedByWorksheet.get(getWorksheetUploadKey(ws));
                    if (!queued) {
                        return ws;
                    }

                    if (queued.jobId) {
                        newActiveJobTargets.push({
                            jobId: queued.jobId,
                            studentId: queued.studentId,
                            studentName: queued.studentName,
                            worksheetNumber: queued.worksheetNumber
                        });
                    }

                    return {
                        ...ws,
                        isUploading: true,
                        jobId: queued.jobId || ws.jobId,
                        jobStatus: 'QUEUED'
                    };
                });
            }

            if (uploadSession.status === 'FINALIZED') {
                window.localStorage.removeItem(getUploadSessionStorageKey(selectedClass, submittedOn));
            } else if (uploadSession.items.some((item) => item.status === 'PENDING')) {
                toast.info('A previous upload was interrupted. Re-select the missing files and upload again.');
            }
        }

        setStudentWorksheets(worksheets);
        trackGradingJobs(newActiveJobTargets);
    }, [classDateQuery.data, selectedClass, submittedOn, trackGradingJobs]);

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

    const handleAddWorksheet = (studentId: string) => {
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

    const handleUpdateWorksheet = async (
        worksheetEntryId: string,
        field: StudentWorksheetUpdateField,
        value: StudentWorksheetUpdateValue
    ) => {
        const originalWorksheet = studentWorksheets.find(w => w.worksheetEntryId === worksheetEntryId);

        if (!originalWorksheet) return;

        if (field === "isAbsent" && value === true) {
            setStudentWorksheets(prev => prev.map(worksheet =>
                worksheet.worksheetEntryId === worksheetEntryId
                    ? {
                        ...worksheet,
                        isAbsent: true,
                        worksheetNumber: 0,
                        grade: '',
                        page1File: null,
                        page2File: null,
                        isRepeated: false,
                        isIncorrectGrade: false
                    }
                    : worksheet
            ));
            return;
        } else if (field === "worksheetNumber") {
            const newWorksheetNumber = typeof value === 'number' ? value : Number(value) || 0;
            let isRepeated = false;

            setStudentWorksheets(prev => prev.map(worksheet =>
                worksheet.worksheetEntryId === worksheetEntryId
                    ? {
                        ...worksheet,
                        worksheetNumber: newWorksheetNumber,
                        isRepeated: false,
                        isAbsent: false
                    }
                    : worksheet
            ));

            if (newWorksheetNumber <= 0) {
                return;
            }

            if (newWorksheetNumber > 0) {
                try {
                    // Use the backend checkIsRepeated endpoint
                    const result = await worksheetAPI.checkIsRepeated(
                        selectedClass,
                        originalWorksheet.studentId,
                        newWorksheetNumber,
                        submittedOn
                    );
                    isRepeated = result.isRepeated;
                } catch (error) {
                    console.error('Error checking if worksheet is repeated:', error);
                }
            }

            setStudentWorksheets(prev => prev.map(worksheet =>
                worksheet.worksheetEntryId === worksheetEntryId && worksheet.worksheetNumber === newWorksheetNumber
                    ? {
                        ...worksheet,
                        isRepeated: !!isRepeated
                    }
                    : worksheet
            ));
        } else {
            setStudentWorksheets(prev => prev.map(worksheet => {
                if (worksheet.worksheetEntryId !== worksheetEntryId) {
                    return worksheet;
                }

                return {
                    ...worksheet,
                    [field]: value,
                    isAbsent: field === "isAbsent"
                        ? Boolean(value)
                        : field === "page1File" || field === "page2File" || (field === "grade" && value)
                            ? false
                            : worksheet.isAbsent
                };
            }));
        }
    };

    const handleUpload = async (worksheet: StudentWorksheet) => {
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


            const preparedSingleFiles = await Promise.all(
                [worksheet.page1File, worksheet.page2File]
                    .filter((file): file is File => !!file)
                    .map((file) => prepareImageForDirectUpload(file))
            );
            const singleCompressionSummary = summarizePreparedUploadFiles(preparedSingleFiles);

            if (singleCompressionSummary.savedBytes > 256 * 1024) {
                toast.info(`Optimized image upload by ${formatUploadBytes(singleCompressionSummary.savedBytes)}`);
            }

            posthog.capture('individual_upload_images_prepared', {
                classId: selectedClass,
                submittedOn,
                worksheetNumber: worksheet.worksheetNumber,
                ...singleCompressionSummary,
                compressionEnabled: DIRECT_UPLOAD_IMAGE_COMPRESSION_ENABLED
            });

            for (const preparedFile of preparedSingleFiles) {
                formData.append('files', preparedFile.file, preparedFile.fileName);
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

                trackGradingJobs([{
                    jobId: result.jobId,
                    studentId: worksheet.studentId,
                    studentName: worksheet.name,
                    worksheetNumber: worksheet.worksheetNumber,
                    worksheetEntryId: worksheet.worksheetEntryId,
                    showSuccessToast: true,
                    showFailureToast: true
                }]);
                queryClient.invalidateQueries({ queryKey: ['teacherJobsToday'] });

                return { success: true, pending: true };
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
        if (isBatchUploading) {
            return;
        }

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

        const uploadWorksheetEntryIds = new Set(studentsWithFiles.map((student) => student.worksheetEntryId));
        const uploadWorksheetKeys = new Set(studentsWithFiles.map(getWorksheetUploadKey));

        setStudentWorksheets(prev => prev.map(sw =>
            uploadWorksheetEntryIds.has(sw.worksheetEntryId)
                ? { ...sw, isUploading: true }
                : sw
        ));

        setIsBatchUploading(true);

        try {
            const preparationTasks: DirectUploadPreparationTask[] = studentsWithFiles.flatMap((worksheet) => {
                const worksheetKey = getWorksheetUploadKey(worksheet);
                const tasks: DirectUploadPreparationTask[] = [];

                if (worksheet.page1File) {
                    tasks.push({
                        worksheetKey,
                        pageNumber: 1,
                        file: worksheet.page1File
                    });
                }

                if (worksheet.page2File) {
                    tasks.push({
                        worksheetKey,
                        pageNumber: 2,
                        file: worksheet.page2File
                    });
                }

                return tasks;
            });

            toast.info(`Preparing ${preparationTasks.length} image${preparationTasks.length !== 1 ? 's' : ''} for faster upload`);

            const preparedResults = await runWithConcurrency(
                preparationTasks,
                getDirectUploadImagePreparationConcurrency(),
                async (task) => ({
                    ...task,
                    preparedFile: await prepareImageForDirectUpload(task.file)
                })
            );

            const failedPreparation = preparedResults.find((result) => result.status === 'rejected');
            if (failedPreparation?.status === 'rejected') {
                throw failedPreparation.reason instanceof Error
                    ? failedPreparation.reason
                    : new Error('Failed to prepare one or more images');
            }

            const preparedUploads = preparedResults
                .filter((result): result is PromiseFulfilledResult<DirectUploadPreparationTask & { preparedFile: PreparedDirectUploadFile }> => result.status === 'fulfilled')
                .map((result) => result.value);

            const fileLookup = new Map<string, Map<number, PreparedDirectUploadFile>>();
            for (const upload of preparedUploads) {
                const pageFiles = fileLookup.get(upload.worksheetKey) || new Map<number, PreparedDirectUploadFile>();
                pageFiles.set(upload.pageNumber, upload.preparedFile);
                fileLookup.set(upload.worksheetKey, pageFiles);
            }

            const compressionSummary = summarizePreparedUploadFiles(
                preparedUploads.map((upload) => upload.preparedFile)
            );

            if (compressionSummary.savedBytes > 256 * 1024) {
                toast.info(`Optimized images by ${formatUploadBytes(compressionSummary.savedBytes)} before upload`);
            }

            posthog.capture('direct_class_upload_images_prepared', {
                classId: selectedClass,
                submittedOn,
                worksheetsCount: studentsWithFiles.length,
                compressionEnabled: DIRECT_UPLOAD_IMAGE_COMPRESSION_ENABLED,
                preparationConcurrency: getDirectUploadImagePreparationConcurrency(),
                ...compressionSummary
            });

            toast.info(`Uploading ${studentsWithFiles.length} worksheet${studentsWithFiles.length !== 1 ? 's' : ''} directly to storage`);

            const uploadRequest = studentsWithFiles.map((worksheet) => {
                const files: { pageNumber: number; fileName: string; mimeType: string; fileSize: number }[] = [];
                const pageFiles = fileLookup.get(getWorksheetUploadKey(worksheet));

                const page1File = pageFiles?.get(1);
                if (page1File) {
                    files.push({
                        pageNumber: 1,
                        fileName: page1File.fileName,
                        mimeType: page1File.mimeType,
                        fileSize: page1File.fileSize
                    });
                }

                const page2File = pageFiles?.get(2);
                if (page2File) {
                    files.push({
                        pageNumber: 2,
                        fileName: page2File.fileName,
                        mimeType: page2File.mimeType,
                        fileSize: page2File.fileSize
                    });
                }

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

            const uploadTasks: DirectUploadTask[] = session.items.flatMap((item) =>
                item.files.map((slot) => ({
                    item,
                    slot,
                    file: fileLookup.get(`${item.studentId}:${item.worksheetNumber}`)?.get(slot.pageNumber)
                }))
            );

            const uploadConcurrency = getDirectUploadConcurrency();
            const uploadedImageIdsByItem = new Map<string, Set<string>>();
            const expectedImageCountByItem = new Map(
                session.items.map((item) => [item.itemId, item.files.length])
            );
            const queuedJobIds = new Set<string>();
            const queuedItemIds = new Set<string>();
            const failedItemIds = new Set<string>();
            const uploadFailedItemIds = new Set<string>();
            const finalizePromises: Promise<void>[] = [];
            let finalizeFailures = 0;
            let firstQueuedAfterMs: number | null = null;
            const uploadStartedAt = getUploadNowMs();

            const applyFinalizeResponse = (finalized: FinalizeDirectUploadSessionResponse) => {
                const newlyQueued = finalized.queued.filter((item) => item.jobId && !queuedJobIds.has(item.jobId));

                newlyQueued.forEach((item) => {
                    if (item.jobId) {
                        queuedJobIds.add(item.jobId);
                    }
                    queuedItemIds.add(item.itemId);
                });

                finalized.failed.forEach((item) => {
                    failedItemIds.add(item.itemId);
                });

                if (newlyQueued.length > 0 && firstQueuedAfterMs === null) {
                    firstQueuedAfterMs = Math.max(0, Math.round(getUploadNowMs() - uploadStartedAt));
                    toast.success('First worksheet queued. Remaining uploads continue in the background.');
                }

                if (newlyQueued.length > 0 || finalized.failed.length > 0) {
                    const queuedByWorksheet = new Map(
                        newlyQueued.map((item) => [`${item.studentId}:${item.worksheetNumber}`, item])
                    );
                    const failedByWorksheet = new Map(
                        finalized.failed.map((item) => [`${item.studentId}:${item.worksheetNumber}`, item])
                    );

                    setStudentWorksheets(prev => prev.map(sw => {
                        const worksheetKey = getWorksheetUploadKey(sw);
                        const queued = queuedByWorksheet.get(worksheetKey);
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

                        if (failedByWorksheet.has(worksheetKey)) {
                            return {
                                ...sw,
                                isUploading: false
                            };
                        }

                        return sw;
                    }));

                    const queuedTargets = newlyQueued.flatMap((item): GradingJobPollingTarget[] => (
                        item.jobId
                            ? [{
                                jobId: item.jobId,
                                studentId: item.studentId,
                                worksheetNumber: item.worksheetNumber
                            }]
                            : []
                    ));

                    trackGradingJobs(queuedTargets);
                    if (queuedTargets.length > 0) {
                        queryClient.invalidateQueries({ queryKey: ['teacherJobsToday'] });
                    }
                }

                if (finalized.status === 'FINALIZED') {
                    window.localStorage.removeItem(getUploadSessionStorageKey(selectedClass, submittedOn));
                }
            };

            const finalizeUploadedItem = (item: DirectUploadItem, imageIds: string[]) => {
                const finalizePromise = worksheetProcessingAPI
                    .finalizeDirectUploadSession(session.batchId, imageIds)
                    .then(applyFinalizeResponse)
                    .catch((error) => {
                        finalizeFailures += 1;
                        console.error('Direct upload item finalize failed:', error);
                    });

                finalizePromises.push(finalizePromise);
            };

            const uploadResults = await runWithConcurrency(
                uploadTasks,
                uploadConcurrency,
                async ({ item, slot, file }) => {
                    try {
                        if (!file) {
                            throw new Error(`Missing local file for page ${slot.pageNumber}`);
                        }

                        if (!slot.uploadUrl) {
                            throw new Error(`Missing upload URL for page ${slot.pageNumber}`);
                        }

                        await uploadFileWithRetry(
                            slot.uploadUrl,
                            file.file,
                            file.mimeType || slot.mimeType || 'image/jpeg',
                            slot.pageNumber
                        );

                        const itemUploadedImageIds = uploadedImageIdsByItem.get(item.itemId) || new Set<string>();
                        itemUploadedImageIds.add(slot.imageId);
                        uploadedImageIdsByItem.set(item.itemId, itemUploadedImageIds);

                        if (itemUploadedImageIds.size === expectedImageCountByItem.get(item.itemId)) {
                            finalizeUploadedItem(item, Array.from(itemUploadedImageIds));
                        }

                        return slot.imageId;
                    } catch (error) {
                        uploadFailedItemIds.add(item.itemId);
                        throw error;
                    }
                }
            );

            const successfulUploadIds = uploadResults
                .filter((result): result is PromiseFulfilledResult<string> => result.status === 'fulfilled')
                .map((result) => result.value);
            const uploadFailures = uploadResults.filter((result) => result.status === 'rejected').length;

            if (successfulUploadIds.length === 0 && uploadTasks.length > 0) {
                const failureSummary = getUploadFailureSummary(uploadResults);
                window.localStorage.removeItem(getUploadSessionStorageKey(selectedClass, submittedOn));
                posthog.capture('direct_class_upload_all_files_failed', {
                    classId: selectedClass,
                    submittedOn,
                    worksheetsCount: studentsWithFiles.length,
                    attemptedUploadFilesCount: uploadTasks.length,
                    uploadFailures,
                    failureSummary,
                    uploadConcurrency,
                    compressionEnabled: DIRECT_UPLOAD_IMAGE_COMPRESSION_ENABLED,
                    ...compressionSummary
                });
                throw new Error(`No files reached storage. ${failureSummary}`);
            }

            const finalizeResults = await Promise.allSettled(finalizePromises);
            finalizeFailures += finalizeResults.filter((result) => result.status === 'rejected').length;

            const fullyUploadedItemIds = Array.from(uploadedImageIdsByItem.entries())
                .filter(([itemId, imageIds]) => imageIds.size === expectedImageCountByItem.get(itemId))
                .map(([itemId]) => itemId);
            const unqueuedFullyUploadedItems = fullyUploadedItemIds.filter((itemId) =>
                !queuedItemIds.has(itemId) && !failedItemIds.has(itemId)
            );

            if (unqueuedFullyUploadedItems.length > 0 && successfulUploadIds.length > 0) {
                try {
                    const recoveryFinalized = await worksheetProcessingAPI.finalizeDirectUploadSession(
                        session.batchId,
                        successfulUploadIds
                    );
                    applyFinalizeResponse(recoveryFinalized);
                } catch (error) {
                    finalizeFailures += 1;
                    console.error('Direct upload recovery finalize failed:', error);
                }
            }

            const unresolvedFinalizeFailures = fullyUploadedItemIds.some((itemId) =>
                !queuedItemIds.has(itemId) && !failedItemIds.has(itemId)
            )
                ? finalizeFailures
                : 0;
            const pendingUploadItemIds = session.items
                .filter((item) => {
                    const uploadedIds = uploadedImageIdsByItem.get(item.itemId);
                    return (uploadedIds?.size || 0) < item.files.length;
                })
                .map((item) => item.itemId);

            setStudentWorksheets(prev => prev.map(sw => {
                const worksheetKey = getWorksheetUploadKey(sw);
                if (!uploadWorksheetKeys.has(worksheetKey)) {
                    return sw;
                }

                const sessionItem = session.items.find((item) =>
                    `${item.studentId}:${item.worksheetNumber}` === worksheetKey
                );

                if (!sessionItem) {
                    return sw;
                }

                if (queuedItemIds.has(sessionItem.itemId)) {
                    return sw;
                }

                return {
                    ...sw,
                    isUploading: false
                };
            }));

            const queuedCount = queuedJobIds.size;
            if (queuedCount > 0) {
                toast.success(
                    `Queued ${queuedCount} worksheet${queuedCount !== 1 ? 's' : ''}. Grading will continue in the background.`
                );
            }

            const unfinishedCount = pendingUploadItemIds.length || uploadFailedItemIds.size || unresolvedFinalizeFailures;
            if (unfinishedCount > 0) {
                toast.error(
                    `${unfinishedCount} worksheet${unfinishedCount !== 1 ? 's' : ''} did not finish uploading. Keep the page open and retry.`
                );
            }

            if (failedItemIds.size > 0) {
                toast.error(`Failed to queue ${failedItemIds.size} worksheet${failedItemIds.size !== 1 ? 's' : ''}.`);
            }

            posthog.capture('direct_class_upload_queued', {
                classId: selectedClass,
                submittedOn,
                worksheetsCount: studentsWithFiles.length,
                queuedCount,
                pendingCount: pendingUploadItemIds.length,
                failedCount: failedItemIds.size,
                uploadFailures,
                finalizeFailures: unresolvedFinalizeFailures,
                uploadConcurrency,
                timeToFirstQueuedMs: firstQueuedAfterMs,
                uploadAndFinalizeMs: Math.max(0, Math.round(getUploadNowMs() - uploadStartedAt)),
                compressionEnabled: DIRECT_UPLOAD_IMAGE_COMPRESSION_ENABLED,
                ...compressionSummary
            });
        } catch (error) {
            console.error('Direct batch upload failed:', error);
            setStudentWorksheets(prev => prev.map(sw =>
                uploadWorksheetEntryIds.has(sw.worksheetEntryId)
                    ? { ...sw, isUploading: false }
                    : sw
            ));
            toast.error(getErrorMessage(error) || 'Failed to process worksheets');
        } finally {
            setIsBatchUploading(false);
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
                                isRepeated: false,
                                isCorrectGrade: false,
                                isIncorrectGrade: false,
                                page1File: null,
                                page2File: null,
                                page1Url: undefined,
                                page2Url: undefined,
                                gradingDetails: undefined,
                                wrongQuestionNumbers: ''
                            };
                        }
                        return w;
                    }));
                }
                return;
            }

            // Handle save case
            if (shouldSave) {
                let savedWorksheetId = currentStudentData.id;

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

                    if (currentStudentData.id && currentStudentData.existing) {
                        const savedWorksheet = await worksheetAPI.updateGradedWorksheet(currentStudentData.id, data);
                        savedWorksheetId = savedWorksheet.id || savedWorksheetId;
                    } else {
                        const savedWorksheet = await worksheetAPI.createGradedWorksheet(data);
                        savedWorksheetId = savedWorksheet.id || savedWorksheetId;
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
                        const savedWorksheet = await worksheetAPI.updateGradedWorksheet(currentStudentData.id, data);
                        savedWorksheetId = savedWorksheet.id || savedWorksheetId;
                    } else {
                        // Create new worksheet
                        const savedWorksheet = await worksheetAPI.createGradedWorksheet(data);
                        savedWorksheetId = savedWorksheet.id || savedWorksheetId;
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
                    w.worksheetEntryId === currentStudentData.worksheetEntryId
                        ? { ...w, id: savedWorksheetId, existing: true }
                        : w
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
                } catch {
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

        } catch {
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

        const studentsWithSubmittedWorksheets = new Set(
            studentWorksheets
                .filter(hasSubmittedWorksheet)
                .map(worksheet => worksheet.studentId)
        );
        const studentsWithoutGrades = worksheetsToCheck.filter(worksheet =>
            !worksheet.isAbsent &&
            !studentsWithSubmittedWorksheets.has(worksheet.studentId) &&
            (!worksheet.grade || worksheet.grade.trim() === '')
        );

        if (studentsWithoutGrades.length === 0) {
            toast.info('No students without grades found to mark as absent.');
            return;
        }

        const studentIdsWithoutGrades = new Set(studentsWithoutGrades.map((student) => student.studentId));

        setStudentWorksheets(prev => prev.map(worksheet => {
            const shouldMarkAbsent = studentIdsWithoutGrades.has(worksheet.studentId);
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

        toast.success(`Marked ${studentIdsWithoutGrades.size} student${studentIdsWithoutGrades.size !== 1 ? 's' : ''} as absent.`);
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
                                    {ungradedWithoutGradeCount > 0 ? ` (${ungradedWithoutGradeCount})` : ''}
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
                                            <div
                                                key={group.studentId}
                                                className="[content-visibility:auto] [contain-intrinsic-size:420px]"
                                            >
                                                <StudentWorksheetCard
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
                                            </div>
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
                                    disabled={!isOnline || isSaving || isBatchUploading || hasUploadingWorksheet || eligibleUploadCount === 0}
                                    variant="secondary"
                                >
                                    {isBatchUploading ? 'Uploading...' : 'AI Grade All'} {eligibleUploadCount > 0 ? `(${eligibleUploadCount})` : ''}
                                </Button>
                                <Button
                                    onClick={handleSaveAllChanges}
                                    disabled={!isOnline || isSaving || hasUploadingWorksheet}
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
                                            disabled={!isOnline || isSaving || isBatchUploading || hasUploadingWorksheet || eligibleUploadCount === 0}
                                            className="flex-1 h-12 text-sm font-medium"
                                            variant="secondary"
                                        >
                                            {isBatchUploading ? 'Uploading...' : 'AI Grade All'}
                                        </Button>
                                        <Button
                                            onClick={handleSaveAllChanges}
                                            disabled={!isOnline || isSaving || hasUploadingWorksheet}
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
