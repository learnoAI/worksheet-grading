'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { worksheetAPI } from '@/lib/api';
import { UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import Link from 'next/link';
import { ArrowLeft, Eye, ImageIcon, Check } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface WorksheetImagePreview {
    imageUrl: string;
    pageNumber: number;
}

interface IncorrectGradingWorksheet {
    id: string;
    worksheetNumber: number;
    grade: number;
    submittedOn: string;
    adminComments?: string;
    wrongQuestionNumbers?: string;
    student: {
        name: string;
        tokenNumber: string;
    };
    submittedBy: {
        name: string;
        username: string;
    };
    class: {
        name: string;
    };
    gradingDetails?: any;
    images?: WorksheetImagePreview[];
}

export default function IncorrectGradingPage() {
    const { user, isLoading } = useAuth();
    const router = useRouter();
    const [worksheets, setWorksheets] = useState<IncorrectGradingWorksheet[]>([]);
    const [loading, setLoading] = useState(true);
    const [comments, setComments] = useState<Record<string, string>>({});
    const [savingComments, setSavingComments] = useState<Record<string, boolean>>({});
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [total, setTotal] = useState(0);
    const [totalAiGraded, setTotalAiGraded] = useState<number>(0);
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>({});
    const [worksheetImages, setWorksheetImages] = useState<Record<string, string[]>>({});
    const [fetchingGradingDetails, setFetchingGradingDetails] = useState<Record<string, boolean>>({});
    const [gradingDetailsCache, setGradingDetailsCache] = useState<Record<string, any>>({});
    const [markingAsCorrect, setMarkingAsCorrect] = useState<Record<string, boolean>>({});

    useEffect(() => {
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('Access denied');
            router.push('/dashboard');
        }
    }, [user, isLoading, router]);

    const loadTotalAiGraded = async () => {
        try {
            const response = await worksheetAPI.getTotalAiGraded({
                startDate: startDate || undefined,
                endDate: endDate || undefined
            });
            setTotalAiGraded(response.total_ai_graded);
        } catch (error) {
            console.error('Error loading total AI graded count:', error);
        }
    };

    const loadIncorrectGradingWorksheets = async () => {
        try {
            setLoading(true);
            const { data, total, page: p, pageSize: ps } = await worksheetAPI.getIncorrectGradingWorksheets({ page, pageSize, startDate: startDate || undefined, endDate: endDate || undefined });
            const sorted = [...(data as any[])].sort((a, b) => {
                const aHasGradingDetails = a.gradingDetails ? 1 : 0;
                const bHasGradingDetails = b.gradingDetails ? 1 : 0;
                const gradingDetailsDiff = bHasGradingDetails - aHasGradingDetails;
                if (gradingDetailsDiff !== 0) return gradingDetailsDiff;
                
                const dateDiff = new Date(b.submittedOn).getTime() - new Date(a.submittedOn).getTime();
                if (dateDiff !== 0) return dateDiff;
                
                const aNum = (a.worksheetNumber ?? 0) as number;
                const bNum = (b.worksheetNumber ?? 0) as number;
                return aNum - bNum;
            });
            setWorksheets(sorted as any);
            setTotal(total);
            setPage(p);
            setPageSize(ps);
            
            const initialComments: Record<string, string> = {};
            (sorted as any[]).forEach((worksheet: IncorrectGradingWorksheet) => {
                initialComments[worksheet.id] = worksheet.adminComments || '';
            });
            setComments(initialComments);
        } catch (error) {
            console.error('Error loading incorrect grading worksheets:', error);
            toast.error('Failed to load worksheets');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            loadIncorrectGradingWorksheets();
            loadTotalAiGraded();
        }
    }, [isLoading, user?.role, page, pageSize, startDate, endDate]);

    const handleCommentChange = (worksheetId: string, comment: string) => {
        setComments(prev => ({
            ...prev,
            [worksheetId]: comment
        }));
    };

    const saveComment = async (worksheetId: string) => {
        try {
            setSavingComments(prev => ({ ...prev, [worksheetId]: true }));
            
            await worksheetAPI.updateWorksheetAdminComments(worksheetId, {
                adminComments: comments[worksheetId] || ''
            });
            
            toast.success('Comment saved successfully');
            
            setWorksheets(prev => prev.map(worksheet => 
                worksheet.id === worksheetId 
                    ? { ...worksheet, adminComments: comments[worksheetId] || '' }
                    : worksheet
            ));
        } catch (error) {
            console.error('Error saving comment:', error);
            toast.error('Failed to save comment');
        } finally {
            setSavingComments(prev => ({ ...prev, [worksheetId]: false }));
        }
    };

    const markAsCorrectlyGraded = async (worksheetId: string) => {
        try {
            setMarkingAsCorrect(prev => ({ ...prev, [worksheetId]: true }));
            
            await worksheetAPI.markWorksheetAsCorrectlyGraded(worksheetId);
            
            toast.success('Worksheet marked as correctly graded');
            
            // Remove the worksheet from the list since it's no longer incorrectly graded
            setWorksheets(prev => prev.filter(worksheet => worksheet.id !== worksheetId));
            
            // Update the total count
            setTotal(prev => Math.max(0, prev - 1));
            
            // Reload the count to ensure accuracy
            loadTotalAiGraded();
        } catch (error) {
            console.error('Error marking worksheet as correctly graded:', error);
            toast.error('Failed to mark worksheet as correctly graded');
        } finally {
            setMarkingAsCorrect(prev => ({ ...prev, [worksheetId]: false }));
        }
    };

    const loadWorksheetImages = async (worksheetId: string, tokenNo: string, worksheetNumber: number) => {
        const worksheetKey = worksheetId;
        
        if (loadingImages[worksheetKey] || worksheetImages[worksheetKey]) {
            return;
        }

        try {
            setLoadingImages(prev => ({ ...prev, [worksheetKey]: true }));
            
            const worksheetName = `${worksheetNumber}`;
            const images = await worksheetAPI.getWorksheetImages(tokenNo, worksheetName);
            
            setWorksheetImages(prev => ({
                ...prev,
                [worksheetKey]: images
            }));
        } catch (error) {
            console.error('Error loading worksheet images:', error);
            toast.error('Failed to load worksheet images');
        } finally {
            setLoadingImages(prev => ({ ...prev, [worksheetKey]: false }));
        }
    };

    const loadGradingDetails = async (worksheetId: string, tokenNo: string, worksheetNumber: number, overallScore?: number) => {
        const worksheetKey = worksheetId;
        
        if (fetchingGradingDetails[worksheetKey] || gradingDetailsCache[worksheetKey]) {
            return gradingDetailsCache[worksheetKey];
        }

        try {
            setFetchingGradingDetails(prev => ({ ...prev, [worksheetKey]: true }));
            
            const gradingDetails = await worksheetAPI.getStudentGradingDetails(tokenNo, worksheetNumber, overallScore);
            
            setGradingDetailsCache(prev => ({
                ...prev,
                [worksheetKey]: gradingDetails
            }));
            
            return gradingDetails;
        } catch (error) {
            console.error('Error loading grading details:', error);
            toast.error('Failed to load grading details');
            return null;
        } finally {
            setFetchingGradingDetails(prev => ({ ...prev, [worksheetKey]: false }));
        }
    };

    const parseWrongQuestionNumbers = (wrongQuestionNumbers?: string): number[] => {
        if (!wrongQuestionNumbers) return [];
        return wrongQuestionNumbers
            .split(',')
            .map((num) => Number.parseInt(num.trim(), 10))
            .filter((num) => Number.isFinite(num));
    };

    const getWrongCount = (worksheet: IncorrectGradingWorksheet): number | undefined => {
        const detailsWrong = computeStats(worksheet.gradingDetails).wrong;
        if (typeof detailsWrong === 'number') {
            return detailsWrong;
        }

        const parsedWrongNumbers = parseWrongQuestionNumbers(worksheet.wrongQuestionNumbers);
        return parsedWrongNumbers.length > 0 ? parsedWrongNumbers.length : undefined;
    };

    const getDbImageUrls = (worksheet: IncorrectGradingWorksheet): string[] => {
        if (!worksheet.images || worksheet.images.length === 0) {
            return [];
        }

        return [...worksheet.images]
            .sort((a, b) => a.pageNumber - b.pageNumber)
            .map((image) => image.imageUrl);
    };

    const computeStats = (gd?: any) => {
        if (!gd) return { total: undefined, correct: undefined, wrong: undefined, unanswered: undefined };
        
        if (gd.total_questions !== undefined) {
            return {
                total: gd.total_questions,
                correct: gd.correct_answers,
                wrong: gd.wrong_answers,
                unanswered: gd.unanswered || 0
            };
        }
        
        const total = gd.total_questions ?? gd.total_possible ?? gd.question_scores?.length ?? gd.wrong_questions?.length ?? undefined;
        const correct = gd.correct_answers ?? (Array.isArray(gd.question_scores) ? gd.question_scores.filter((q: any) => q.is_correct).length : undefined);
        const unanswered = gd.unanswered ?? 0;
        const wrong = gd.wrong_answers ?? (typeof total === 'number' && typeof correct === 'number' ? total - correct - unanswered : (Array.isArray(gd.wrong_questions) ? gd.wrong_questions.length : undefined));
        return { total, correct, wrong, unanswered };
    };

    if (isLoading || loading) {
        return (
            <div className="space-y-6">
                <div className="flex items-center space-x-3">
                    <Skeleton className="h-8 w-8" />
                    <Skeleton className="h-8 w-64" />
                </div>
                <div className="space-y-4">
                    {[...Array(5)].map((_, idx) => (
                        <div key={idx} className="border rounded-lg p-6">
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                <div className="space-y-3">
                                    <Skeleton className="h-4 w-32" />
                                    <Skeleton className="h-4 w-48" />
                                    <Skeleton className="h-4 w-40" />
                                    <Skeleton className="h-4 w-36" />
                                </div>
                                <div className="space-y-3">
                                    <Skeleton className="h-4 w-28" />
                                    <Skeleton className="h-20 w-full" />
                                    <Skeleton className="h-8 w-24" />
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        );
    }

    if (!user || user.role !== UserRole.SUPERADMIN) {
        return null;
    }

    return (
        <div className="space-y-6">
            <div className="flex items-center space-x-3">
                <Button variant="outline" size="sm" asChild>
                    <Link href="/dashboard/superadmin">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back to Dashboard
                    </Link>
                </Button>
                <h1 className="text-2xl font-bold">Incorrect AI Grading Review</h1>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Worksheets Flagged as Incorrectly Graded</CardTitle>
                    <CardDescription>
                        These worksheets have been marked by SRs as having incorrect AI grades.
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="mb-6 space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="border rounded-md p-4 bg-muted/30">
                                <div className="text-sm text-muted-foreground">Total Incorrectly Graded</div>
                                <div className="text-2xl font-semibold">{total}</div>
                            </div>
                            <div className="border rounded-md p-4 bg-muted/30">
                                <div className="text-sm text-muted-foreground">Total AI Graded</div>
                                <div className="text-2xl font-semibold">{totalAiGraded.toLocaleString()}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                            <div className="md:col-span-2">
                                <Label className="text-sm">Start date</Label>
                                <Input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => {
                                        setStartDate(e.target.value);
                                        setPage(1);
                                    }}
                                />
                            </div>
                            <div className="md:col-span-2">
                                <Label className="text-sm">End date</Label>
                                <Input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => {
                                        setEndDate(e.target.value);
                                        setPage(1);
                                    }}
                                />
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    variant="secondary"
                                    onClick={() => {
                                        setStartDate('');
                                        setEndDate('');
                                        setPage(1);
                                    }}
                                >
                                    Reset
                                </Button>
                            </div>
                        </div>
                    </div>

                    {worksheets.length === 0 ? (
                        <div className="text-center py-8">
                            <p className="text-gray-500">No worksheets flagged as incorrectly graded.</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {worksheets.map((worksheet) => (
                                <Card key={worksheet.id}>
                                    <CardContent className="pt-6">
                                        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                            <div className="space-y-4">
                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <Label className="text-sm font-medium text-gray-600">Worksheet Number</Label>
                                                        <p className="text-lg font-semibold">{worksheet.worksheetNumber}</p>
                                                    </div>
                                                    <div>
                                                        <Label className="text-sm font-medium text-gray-600">AI Grade</Label>
                                                        <p className="text-lg font-semibold">{worksheet.grade}/40</p>
                                                    </div>
                                                </div>

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <Label className="text-sm font-medium text-gray-600">Student</Label>
                                                        <p className="font-medium">{worksheet.student.name}</p>
                                                        <p className="text-sm text-gray-500">Token: {worksheet.student.tokenNumber}</p>
                                                    </div>
                                                    <div>
                                                        <Label className="text-sm font-medium text-gray-600">Class</Label>
                                                        <p className="font-medium">{worksheet.class.name}</p>
                                                    </div>
                                                </div>

                                                {(() => {
                                                    const wrongCount = getWrongCount(worksheet);
                                                    if (wrongCount === undefined) {
                                                        return null;
                                                    }

                                                    return (
                                                        <div>
                                                            <Label className="text-sm font-medium text-gray-600">Incorrect Questions</Label>
                                                            <p className="text-lg font-semibold">{wrongCount}</p>
                                                        </div>
                                                    );
                                                })()}

                                                <div className="grid grid-cols-2 gap-4">
                                                    <div>
                                                        <Label className="text-sm font-medium text-gray-600">Graded By</Label>
                                                        <p className="font-medium">{worksheet.submittedBy.name}</p>
                                                        <p className="text-sm text-gray-500">@{worksheet.submittedBy.username}</p>
                                                    </div>
                                                    <div>
                                                        <Label className="text-sm font-medium text-gray-600">Submitted On</Label>
                                                        <p className="font-medium">
                                                            {new Date(worksheet.submittedOn).toLocaleDateString('en-IN', {
                                                                day: '2-digit',
                                                                month: '2-digit',
                                                                year: 'numeric'
                                                            })}
                                                        </p>
                                                    </div>
                                                </div>
                                            </div>

                                            <div className="space-y-4">
                                                <div className="grid grid-cols-1 gap-2">
                                                    <Dialog>
                                                        <DialogTrigger asChild>
                                                            <Button 
                                                                type="button" 
                                                                variant="outline" 
                                                                className="w-full"
                                                                onClick={() => {
                                                                    if (!worksheet.gradingDetails && !gradingDetailsCache[worksheet.id] && !fetchingGradingDetails[worksheet.id]) {
                                                                        loadGradingDetails(worksheet.id, worksheet.student.tokenNumber, worksheet.worksheetNumber, worksheet.grade);
                                                                    }
                                                                }}
                                                            >
                                                                <Eye className="h-4 w-4 mr-2" />
                                                                View Grading Details
                                                            </Button>
                                                        </DialogTrigger>
                                                        <DialogContent className="sm:max-w-4xl">
                                                            <DialogHeader>
                                                                <DialogTitle>Worksheet #{worksheet.worksheetNumber} - Grading Details</DialogTitle>
                                                                <DialogDescription>
                                                                    Student: {worksheet.student.name} (Token: {worksheet.student.tokenNumber})
                                                                </DialogDescription>
                                                            </DialogHeader>
                                                            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                                                                {(() => {
                                                                    const worksheetKey = worksheet.id;
                                                                    const isLoading = fetchingGradingDetails[worksheetKey];
                                                                    const pythonGradingDetails = gradingDetailsCache[worksheetKey];
                                                                    const wrongQuestionNumbers = parseWrongQuestionNumbers(worksheet.wrongQuestionNumbers);
                                                                    
                                                                    const gradingDetails = worksheet.gradingDetails || pythonGradingDetails;

                                                                    if (isLoading) {
                                                                        return (
                                                                            <div className="flex items-center justify-center py-8">
                                                                                <div className="text-center">
                                                                                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                                                                                    <p className="mt-2 text-sm text-muted-foreground">Loading grading details...</p>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    }

                                                                    if (!gradingDetails) {
                                                                        return (
                                                                            <div className="text-center py-8">
                                                                                <p className="text-muted-foreground">No detailed per-question grading data found for this worksheet.</p>
                                                                                {wrongQuestionNumbers.length > 0 && (
                                                                                    <div className="mt-4 border rounded-md p-4 bg-yellow-50 text-left">
                                                                                        <p className="text-sm font-medium text-yellow-900">Wrong/Unanswered Questions</p>
                                                                                        <p className="text-sm text-yellow-800 mt-1">{wrongQuestionNumbers.join(', ')}</p>
                                                                                    </div>
                                                                                )}
                                                                                <Button 
                                                                                    className="mt-4"
                                                                                    onClick={() => loadGradingDetails(worksheet.id, worksheet.student.tokenNumber, worksheet.worksheetNumber, worksheet.grade)}
                                                                                    disabled={isLoading}
                                                                                >
                                                                                    {isLoading ? 'Loading...' : 'Retry'}
                                                                                </Button>
                                                                            </div>
                                                                        );
                                                                    }

                                                                    const s = computeStats(gradingDetails);

                                                                    return (
                                                                        <>

                                                                            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                                                                                <div className="border rounded-md p-3 bg-muted/30">
                                                                                    <div className="text-xs text-muted-foreground">Overall Score</div>
                                                                                    <div className="text-base font-semibold">{s.correct ?? 'N/A'}/{s.total ?? 'N/A'}</div>
                                                                                </div>
                                                                                <div className="border rounded-md p-3 bg-muted/30">
                                                                                    <div className="text-xs text-muted-foreground">Percentage</div>
                                                                                    <div className="text-base font-semibold">{gradingDetails.grade_percentage ?? (s.total && s.correct ? Math.round((s.correct / s.total) * 100) : 'N/A')}%</div>
                                                                                </div>
                                                                                <div className="border rounded-md p-3 bg-green-50">
                                                                                    <div className="text-xs text-muted-foreground">Correct</div>
                                                                                    <div className="text-base font-semibold text-green-700">{s.correct ?? 'N/A'}</div>
                                                                                </div>
                                                                                <div className="border rounded-md p-3 bg-red-50">
                                                                                    <div className="text-xs text-muted-foreground">Wrong</div>
                                                                                    <div className="text-base font-semibold text-red-700">{s.wrong ?? 'N/A'}</div>
                                                                                </div>
                                                                                <div className="border rounded-md p-3 bg-gray-50">
                                                                                    <div className="text-xs text-muted-foreground">Unanswered</div>
                                                                                    <div className="text-base font-semibold text-gray-700">{s.unanswered ?? 'N/A'}</div>
                                                                                </div>
                                                                            </div>

                                                                            {gradingDetails.overall_feedback && (
                                                                                <div className="border rounded-md p-4 bg-blue-50">
                                                                                    <div className="text-sm font-medium text-blue-900 mb-2">Overall Feedback</div>
                                                                                    <div className="text-sm text-blue-800">{gradingDetails.overall_feedback}</div>
                                                                                </div>
                                                                            )}

                                                                            {(gradingDetails.question_scores || gradingDetails.wrong_questions) && (
                                                                                <div className="border rounded-md">
                                                                                    <div className="p-3 border-b font-medium bg-gray-50">
                                                                                        All Questions ({(gradingDetails.question_scores ?? gradingDetails.wrong_questions ?? []).length})
                                                                                    </div>
                                                                                    <div className="divide-y max-h-96 overflow-y-auto">
                                                                                        {(gradingDetails.question_scores ?? gradingDetails.wrong_questions ?? []).map((q: any, idx: number) => (
                                                                                            <div key={q.question_number ?? idx} className="p-3">
                                                                                                <div className="flex items-center justify-between mb-2">
                                                                                                    <div className="font-medium">
                                                                                                        Q{q.question_number ?? (idx + 1)}: {q.question?.replace(/^Q\d+\.\s*/, '') || 'No question text'}
                                                                                                    </div>
                                                                                                    <div className="flex items-center gap-2">
                                                                                                        {q.points_earned !== undefined && q.max_points !== undefined && (
                                                                                                            <div className="text-xs px-2 py-1 rounded bg-gray-100">
                                                                                                                {q.points_earned}/{q.max_points} pts
                                                                                                            </div>
                                                                                                        )}
                                                                                                        <div className={`text-xs px-2 py-1 rounded ${q.is_correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                                                            {q.is_correct ? '✓ Correct' : '✗ Wrong'}
                                                                                                        </div>
                                                                                                    </div>
                                                                                                </div>
                                                                                                <div className="grid grid-cols-2 gap-4 text-sm mb-2">
                                                                                                    <div className="border rounded p-2 bg-blue-50">
                                                                                                        <div className="text-xs text-blue-600 font-medium">Student Answer</div>
                                                                                                        <div className="font-medium">{q.student_answer || '-'}</div>
                                                                                                    </div>
                                                                                                    <div className="border rounded p-2 bg-green-50">
                                                                                                        <div className="text-xs text-green-600 font-medium">Correct Answer</div>
                                                                                                        <div className="font-medium">{q.correct_answer || '-'}</div>
                                                                                                    </div>
                                                                                                </div>
                                                                                                {q.feedback && (
                                                                                                    <div className="text-xs text-muted-foreground bg-gray-50 p-2 rounded">
                                                                                                        <span className="font-medium">Feedback:</span> {q.feedback}
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        ))}
                                                                                    </div>
                                                                                </div>
                                                                            )}
                                                                        </>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </DialogContent>
                                                    </Dialog>

                                                    <Dialog>
                                                        <DialogTrigger asChild>
                                                            <Button 
                                                                type="button" 
                                                                variant="outline" 
                                                                className="w-full"
                                                                onClick={() => {
                                                                    if (getDbImageUrls(worksheet).length === 0) {
                                                                        loadWorksheetImages(worksheet.id, worksheet.student.tokenNumber, worksheet.worksheetNumber);
                                                                    }
                                                                }}
                                                            >
                                                                <ImageIcon className="h-4 w-4 mr-2" />
                                                                View Worksheet Images
                                                            </Button>
                                                        </DialogTrigger>
                                                        <DialogContent className="sm:max-w-4xl">
                                                            <DialogHeader>
                                                                <DialogTitle>Worksheet #{worksheet.worksheetNumber} - Images</DialogTitle>
                                                                <DialogDescription>
                                                                    Student: {worksheet.student.name} (Token: {worksheet.student.tokenNumber})
                                                                </DialogDescription>
                                                            </DialogHeader>
                                                            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                                                                {(() => {
                                                                    const worksheetKey = worksheet.id;
                                                                    const isLoading = loadingImages[worksheetKey];
                                                                    const dbImages = getDbImageUrls(worksheet);
                                                                    const images = worksheetImages[worksheetKey] || dbImages;

                                                                    if (isLoading) {
                                                                        return (
                                                                            <div className="flex items-center justify-center py-8">
                                                                                <div className="text-center">
                                                                                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-gray-900"></div>
                                                                                    <p className="mt-2 text-sm text-muted-foreground">Loading images...</p>
                                                                                </div>
                                                                            </div>
                                                                        );
                                                                    }

                                                                    if (!images || images.length === 0) {
                                                                        return (
                                                                            <div className="text-center py-8">
                                                                                <p className="text-muted-foreground">No images found for this worksheet.</p>
                                                                            </div>
                                                                        );
                                                                    }

                                                                    return (
                                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                                                            {images.map((imageUrl, index) => (
                                                                                <div key={index} className="border rounded-lg overflow-hidden">
                                                                                    <div className="bg-muted px-3 py-2 text-sm font-medium">
                                                                                        Page {index + 1}
                                                                                    </div>
                                                                                    <div className="p-2">
                                                                                        <img 
                                                                                            src={imageUrl} 
                                                                                            alt={`Worksheet page ${index + 1}`}
                                                                                            className="w-full h-auto rounded border"
                                                                                            onError={(e) => {
                                                                                                const target = e.target as HTMLImageElement;
                                                                                                target.style.display = 'none';
                                                                                                const errorDiv = document.createElement('div');
                                                                                                errorDiv.className = 'flex items-center justify-center h-32 bg-muted text-muted-foreground text-sm';
                                                                                                errorDiv.textContent = 'Failed to load image';
                                                                                                target.parentNode?.appendChild(errorDiv);
                                                                                            }}
                                                                                        />
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    );
                                                                })()}
                                                            </div>
                                                        </DialogContent>
                                                    </Dialog>
                                                </div>

                                                <div>
                                                    <Label htmlFor={`comment-${worksheet.id}`} className="text-sm font-medium">
                                                        Comments
                                                    </Label>
                                                    <Textarea
                                                        id={`comment-${worksheet.id}`}
                                                        placeholder="Add your comments about this incorrect grading..."
                                                        value={comments[worksheet.id] || ''}
                                                        onChange={(e) => handleCommentChange(worksheet.id, e.target.value)}
                                                        className="mt-2 min-h-[100px]"
                                                    />
                                                </div>
                                                <div className="space-y-2">
                                                    <Button
                                                        onClick={() => markAsCorrectlyGraded(worksheet.id)}
                                                        disabled={markingAsCorrect[worksheet.id]}
                                                        variant="outline"
                                                        className="w-full border-green-200 text-green-700 hover:bg-green-50"
                                                    >
                                                        {markingAsCorrect[worksheet.id] ? (
                                                            'Marking as Correct...'
                                                        ) : (
                                                            <>
                                                                <Check className="h-4 w-4 mr-2" />
                                                                AI did correct grading
                                                            </>
                                                        )}
                                                    </Button>
                                                    <Button
                                                        onClick={() => saveComment(worksheet.id)}
                                                        disabled={savingComments[worksheet.id]}
                                                        className="w-full"
                                                    >
                                                        {savingComments[worksheet.id] ? (
                                                            'Saving...'
                                                        ) : (
                                                            <>
                                                                Save Comment
                                                            </>
                                                        )}
                                                    </Button>
                                                </div>
                                            </div>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}

                            <div className="flex items-center justify-between pt-2">
                                <div className="text-sm text-muted-foreground">
                                    Showing {(total === 0) ? 0 : ((page - 1) * pageSize + 1)}–{Math.min(page * pageSize, total)} of {total}
                                </div>
                                <div className="flex items-center gap-2">
                                    <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>Previous</Button>
                                    <Button variant="outline" size="sm" disabled={page * pageSize >= total} onClick={() => setPage(p => p + 1)}>Next</Button>
                                    <div className="flex items-center gap-2">
                                        <Label className="text-sm">Page size</Label>
                                        <select
                                            className="h-9 rounded-md border px-2 text-sm"
                                            value={pageSize}
                                            onChange={(e) => { setPageSize(parseInt(e.target.value)); setPage(1); }}
                                        >
                                            {[10, 20, 50, 100].map(s => (
                                                <option key={s} value={s}>{s}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
}
