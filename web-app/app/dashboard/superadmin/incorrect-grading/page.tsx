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
import { ArrowLeft, Save, Eye, ImageIcon } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

interface IncorrectGradingWorksheet {
    id: string;
    worksheetNumber: number;
    grade: number;
    submittedOn: string;
    adminComments?: string;
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
    const [startDate, setStartDate] = useState<string>('');
    const [endDate, setEndDate] = useState<string>('');
    const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>({});
    const [worksheetImages, setWorksheetImages] = useState<Record<string, string[]>>({});

    useEffect(() => {
        if (!isLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('Access denied');
            router.push('/dashboard');
        } else if (!isLoading && user?.role === UserRole.SUPERADMIN) {
            loadIncorrectGradingWorksheets();
        }
    }, [user, isLoading, router]);

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
        }
    }, [page, pageSize, startDate, endDate]);

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

    const loadWorksheetImages = async (tokenNo: string, worksheetNumber: number) => {
        const worksheetKey = `${tokenNo}-${worksheetNumber}`;
        
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

    const computeStats = (gd?: any) => {
        if (!gd) return { total: undefined, correct: undefined, wrong: undefined, unanswered: undefined };
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
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
                            <div className="md:col-span-2">
                                <Label className="text-sm">Start date</Label>
                                <Input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                            </div>
                            <div className="md:col-span-2">
                                <Label className="text-sm">End date</Label>
                                <Input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
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
                                                        <p className="text-lg font-semibold">#{worksheet.worksheetNumber}</p>
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

                                                {worksheet.gradingDetails && (
                                                    <div>
                                                        <Label className="text-sm font-medium text-gray-600">Incorrect Questions</Label>
                                                        <p className="text-lg font-semibold">{computeStats(worksheet.gradingDetails).wrong ?? 'N/A'}</p>
                                                    </div>
                                                )}

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
                                                            <Button type="button" variant="outline" className="w-full">
                                                                <Eye className="h-4 w-4 mr-2" />
                                                                View Grading Details
                                                            </Button>
                                                        </DialogTrigger>
                                                        <DialogContent className="sm:max-w-3xl">
                                                            <DialogHeader>
                                                                <DialogTitle>Worksheet #{worksheet.worksheetNumber} - Grading Details</DialogTitle>
                                                                <DialogDescription>AI grading breakdown for the submission.</DialogDescription>
                                                            </DialogHeader>
                                                            <div className="space-y-4 max-h-[70vh] overflow-y-auto">
                                                                {worksheet.gradingDetails ? (
                                                                    <>
                                                                        {(() => {
                                                                            const s = computeStats(worksheet.gradingDetails);
                                                                            return (
                                                                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                                                                    <div className="border rounded-md p-3 bg-muted/30">
                                                                                        <div className="text-xs text-muted-foreground">Total</div>
                                                                                        <div className="text-base font-semibold">{s.total ?? 'N/A'}</div>
                                                                                    </div>
                                                                                    <div className="border rounded-md p-3 bg-muted/30">
                                                                                        <div className="text-xs text-muted-foreground">Correct</div>
                                                                                        <div className="text-base font-semibold">{s.correct ?? 'N/A'}</div>
                                                                                    </div>
                                                                                    <div className="border rounded-md p-3 bg-muted/30">
                                                                                        <div className="text-xs text-muted-foreground">Wrong</div>
                                                                                        <div className="text-base font-semibold">{s.wrong ?? 'N/A'}</div>
                                                                                    </div>
                                                                                    <div className="border rounded-md p-3 bg-muted/30">
                                                                                        <div className="text-xs text-muted-foreground">Unanswered</div>
                                                                                        <div className="text-base font-semibold">{s.unanswered ?? 'N/A'}</div>
                                                                                    </div>
                                                                                </div>
                                                                            );
                                                                        })()}

                                                                        {worksheet.gradingDetails.overall_feedback && (
                                                                            <div className="text-sm text-muted-foreground">{worksheet.gradingDetails.overall_feedback}</div>
                                                                        )}

                                                                        <div className="border rounded-md">
                                                                            <div className="p-3 border-b font-medium">Questions</div>
                                                                            <div className="divide-y">
                                                                                {(worksheet.gradingDetails.question_scores ?? worksheet.gradingDetails.wrong_questions ?? []).map((q: any, idx: number) => (
                                                                                    <div key={q.question_number ?? idx} className="p-3">
                                                                                        <div className="flex items-center justify-between">
                                                                                            <div className="font-medium">
                                                                                                {typeof q.question_number === 'number' ? `Q${q.question_number}` : q.question?.split('.')[0] ?? 'Q'}
                                                                                                {q.question ? `: ${q.question.replace(/^Q\d+\.\s*/, '')}` : ''}
                                                                                            </div>
                                                                                            <div className={`text-xs px-2 py-0.5 rounded ${q.is_correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                                                                                {q.is_correct ? 'Correct' : 'Wrong'}
                                                                                            </div>
                                                                                        </div>
                                                                                        <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                                                                                            <div>Student: <span className="font-medium">{q.student_answer ?? '-'}</span></div>
                                                                                            <div>Correct: <span className="font-medium">{q.correct_answer ?? '-'}</span></div>
                                                                                        </div>
                                                                                        {q.feedback && (
                                                                                            <div className="mt-1 text-xs text-muted-foreground">{q.feedback}</div>
                                                                                        )}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    <p className="text-sm text-muted-foreground">No grading details available.</p>
                                                                )}
                                                            </div>
                                                        </DialogContent>
                                                    </Dialog>

                                                    <Dialog>
                                                        <DialogTrigger asChild>
                                                            <Button 
                                                                type="button" 
                                                                variant="outline" 
                                                                className="w-full"
                                                                onClick={() => loadWorksheetImages(worksheet.student.tokenNumber, worksheet.worksheetNumber)}
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
                                                                    const worksheetKey = `${worksheet.student.tokenNumber}-${worksheet.worksheetNumber}`;
                                                                    const isLoading = loadingImages[worksheetKey];
                                                                    const images = worksheetImages[worksheetKey];

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
