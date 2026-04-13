'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { analyticsAPI, School, Class } from '@/lib/api/analyticsAPI';
import { worksheetGenerationAPI, GeneratedWorksheet, WorksheetBatch } from '@/lib/api/worksheetGeneration';

const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    QUESTIONS_READY: 'bg-blue-100 text-blue-700',
    RENDERING: 'bg-yellow-100 text-yellow-700',
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700'
};

const BATCH_STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    GENERATING_QUESTIONS: 'bg-blue-100 text-blue-700',
    RENDERING_PDFS: 'bg-yellow-100 text-yellow-700',
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700'
};

const BATCH_STATUS_LABELS: Record<string, string> = {
    PENDING: 'Pending',
    GENERATING_QUESTIONS: 'Generating Questions',
    RENDERING_PDFS: 'Rendering PDFs',
    COMPLETED: 'Completed',
    FAILED: 'Failed'
};

export default function GenerateWorksheetsPage() {
    const [mode, setMode] = useState<'student' | 'class'>('student');

    // Filter state
    const [schools, setSchools] = useState<School[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);
    const [students, setStudents] = useState<{ id: string; name: string; tokenNumber: string | null }[]>([]);
    const [selectedSchoolId, setSelectedSchoolId] = useState('');
    const [selectedClassId, setSelectedClassId] = useState('');
    const [selectedStudentId, setSelectedStudentId] = useState('');

    // Generation params
    const [days, setDays] = useState('5');
    const [startDate, setStartDate] = useState(() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        return tomorrow.toISOString().split('T')[0];
    });

    // Student mode state
    const [isGenerating, setIsGenerating] = useState(false);
    const [worksheets, setWorksheets] = useState<GeneratedWorksheet[]>([]);
    const [isLoadingWorksheets, setIsLoadingWorksheets] = useState(false);

    // Class mode state
    const [batchStatus, setBatchStatus] = useState<WorksheetBatch | null>(null);
    const [isGeneratingClass, setIsGeneratingClass] = useState(false);
    const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

    // Load schools
    useEffect(() => {
        analyticsAPI.getAllSchools()
            .then(setSchools)
            .catch(() => toast.error('Failed to load schools'));
    }, []);

    // Load classes when school changes
    useEffect(() => {
        if (!selectedSchoolId) { setClasses([]); setSelectedClassId(''); return; }
        analyticsAPI.getClassesBySchool(selectedSchoolId)
            .then(data => { setClasses(data); setSelectedClassId(''); })
            .catch(() => toast.error('Failed to load classes'));
    }, [selectedSchoolId]);

    // Load students when class changes (only in student mode)
    useEffect(() => {
        if (!selectedClassId || mode !== 'student') { setStudents([]); setSelectedStudentId(''); return; }
        analyticsAPI.getStudentAnalytics({ classId: selectedClassId, pageSize: 200 })
            .then(res => {
                setStudents(res.students.map(s => ({ id: s.id, name: s.name, tokenNumber: s.tokenNumber })));
                setSelectedStudentId('');
            })
            .catch(() => toast.error('Failed to load students'));
    }, [selectedClassId, mode]);

    // Load existing worksheets when student changes
    useEffect(() => {
        if (!selectedStudentId) { setWorksheets([]); return; }
        setIsLoadingWorksheets(true);
        worksheetGenerationAPI.listForStudent(selectedStudentId)
            .then(res => setWorksheets(res.data))
            .catch(() => toast.error('Failed to load worksheets'))
            .finally(() => setIsLoadingWorksheets(false));
    }, [selectedStudentId]);

    // Cleanup polling on unmount
    useEffect(() => {
        return () => {
            if (pollRef.current) clearInterval(pollRef.current);
        };
    }, []);

    const startPolling = useCallback((batchId: string) => {
        if (pollRef.current) clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
            try {
                const res = await worksheetGenerationAPI.getBatchStatus(batchId);
                setBatchStatus(res.data);
                if (res.data.status === 'COMPLETED' || res.data.status === 'FAILED') {
                    if (pollRef.current) clearInterval(pollRef.current);
                    pollRef.current = null;
                }
            } catch {
                // Silently retry on next interval
            }
        }, 3000);
    }, []);

    const handleGenerate = async () => {
        if (!selectedStudentId) { toast.error('Select a student first'); return; }
        setIsGenerating(true);
        setBatchStatus(null);
        try {
            const res = await worksheetGenerationAPI.generate(selectedStudentId, parseInt(days), startDate);
            toast.success(`Queued ${res.data.totalWorksheets} worksheet(s), ${res.data.skillsToGenerate} skill(s) to generate`);
            if (res.data.errors.length > 0) {
                toast.warning(`Warnings: ${res.data.errors.join(', ')}`);
            }
            if (res.data.batchId) {
                const statusRes = await worksheetGenerationAPI.getBatchStatus(res.data.batchId);
                setBatchStatus(statusRes.data);
                startPolling(res.data.batchId);
            }
            const updated = await worksheetGenerationAPI.listForStudent(selectedStudentId);
            setWorksheets(updated.data);
        } catch (err) {
            toast.error(`Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsGenerating(false);
        }
    };

    const handleGenerateClass = async () => {
        if (!selectedClassId) { toast.error('Select a class first'); return; }
        setIsGeneratingClass(true);
        setBatchStatus(null);
        try {
            const res = await worksheetGenerationAPI.generateClass(selectedClassId, parseInt(days), startDate);
            toast.success(`Batch created: ${res.data.totalWorksheets} worksheet(s), ${res.data.skillsToGenerate} skill(s) to generate`);
            if (res.data.errors.length > 0) {
                toast.warning(`Warnings: ${res.data.errors.join(', ')}`);
            }
            if (res.data.batchId) {
                const statusRes = await worksheetGenerationAPI.getBatchStatus(res.data.batchId);
                setBatchStatus(statusRes.data);
                startPolling(res.data.batchId);
            }
        } catch (err) {
            toast.error(`Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsGeneratingClass(false);
        }
    };

    const refreshWorksheets = async () => {
        if (!selectedStudentId) return;
        setIsLoadingWorksheets(true);
        try {
            const res = await worksheetGenerationAPI.listForStudent(selectedStudentId);
            setWorksheets(res.data);
        } catch {
            toast.error('Failed to refresh');
        } finally {
            setIsLoadingWorksheets(false);
        }
    };

    const batchProgress = batchStatus
        ? batchStatus.totalWorksheets > 0
            ? Math.round(((batchStatus.completedWorksheets + batchStatus.failedWorksheets) / batchStatus.totalWorksheets) * 100)
            : 0
        : 0;

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold">Generate Worksheets</h2>
                <div className="flex gap-1 bg-gray-100 rounded-lg p-1">
                    <button
                        onClick={() => setMode('student')}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'student' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Student
                    </button>
                    <button
                        onClick={() => setMode('class')}
                        className={`px-4 py-1.5 rounded-md text-sm font-medium transition-colors ${mode === 'class' ? 'bg-white shadow-sm text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}
                    >
                        Class
                    </button>
                </div>
            </div>

            {/* Filters */}
            <Card>
                <CardHeader><CardTitle>{mode === 'student' ? 'Select Student' : 'Select Class'}</CardTitle></CardHeader>
                <CardContent>
                    <div className={`grid grid-cols-1 gap-4 ${mode === 'student' ? 'md:grid-cols-3' : 'md:grid-cols-2'}`}>
                        <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                            <SelectTrigger><SelectValue placeholder="Select School" /></SelectTrigger>
                            <SelectContent>
                                {schools.map(s => (
                                    <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        <Select value={selectedClassId} onValueChange={setSelectedClassId} disabled={!selectedSchoolId}>
                            <SelectTrigger><SelectValue placeholder="Select Class" /></SelectTrigger>
                            <SelectContent>
                                {classes.map(c => (
                                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                                ))}
                            </SelectContent>
                        </Select>

                        {mode === 'student' && (
                            <Select value={selectedStudentId} onValueChange={setSelectedStudentId} disabled={!selectedClassId}>
                                <SelectTrigger><SelectValue placeholder="Select Student" /></SelectTrigger>
                                <SelectContent>
                                    {students.map(s => (
                                        <SelectItem key={s.id} value={s.id}>
                                            {s.name}{s.tokenNumber ? ` (${s.tokenNumber})` : ''}
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Generation Form — Student mode */}
            {mode === 'student' && selectedStudentId && (
                <Card>
                    <CardHeader><CardTitle>Generate</CardTitle></CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap items-end gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Days</label>
                                <Select value={days} onValueChange={setDays}>
                                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">1</SelectItem>
                                        <SelectItem value="5">5</SelectItem>
                                        <SelectItem value="10">10</SelectItem>
                                        <SelectItem value="20">20</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    className="border rounded px-3 py-2 text-sm"
                                />
                            </div>
                            <Button onClick={handleGenerate} disabled={isGenerating}>
                                {isGenerating ? 'Generating...' : 'Generate Worksheets'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Generation Form — Class mode */}
            {mode === 'class' && selectedClassId && (
                <Card>
                    <CardHeader><CardTitle>Generate for Class</CardTitle></CardHeader>
                    <CardContent>
                        <div className="flex flex-wrap items-end gap-4">
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Days</label>
                                <Select value={days} onValueChange={setDays}>
                                    <SelectTrigger className="w-24"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="1">1</SelectItem>
                                        <SelectItem value="5">5</SelectItem>
                                        <SelectItem value="10">10</SelectItem>
                                        <SelectItem value="20">20</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div>
                                <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={e => setStartDate(e.target.value)}
                                    className="border rounded px-3 py-2 text-sm"
                                />
                            </div>
                            <Button onClick={handleGenerateClass} disabled={isGeneratingClass}>
                                {isGeneratingClass ? 'Generating...' : 'Generate for Class'}
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Batch Progress */}
            {batchStatus && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle>Batch Progress</CardTitle>
                            <Badge className={BATCH_STATUS_COLORS[batchStatus.status] ?? ''}>
                                {BATCH_STATUS_LABELS[batchStatus.status] ?? batchStatus.status}
                            </Badge>
                        </div>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            <div className="flex justify-between text-sm text-gray-600">
                                <span>{batchStatus.completedWorksheets + batchStatus.failedWorksheets} / {batchStatus.totalWorksheets} worksheets</span>
                                <span>{batchProgress}%</span>
                            </div>
                            <div className="w-full bg-gray-200 rounded-full h-3">
                                <div
                                    className="h-3 rounded-full transition-all duration-500 bg-green-500"
                                    style={{ width: `${batchProgress}%` }}
                                />
                            </div>
                            <div className="flex gap-4 text-xs text-gray-500">
                                <span>Completed: {batchStatus.completedWorksheets}</span>
                                {batchStatus.failedWorksheets > 0 && (
                                    <span className="text-red-500">Failed: {batchStatus.failedWorksheets}</span>
                                )}
                                {batchStatus.pendingSkills > 0 && (
                                    <span>Skills: {batchStatus.completedSkills}/{batchStatus.pendingSkills}</span>
                                )}
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Worksheets List — Student mode */}
            {mode === 'student' && selectedStudentId && (
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <CardTitle>Generated Worksheets</CardTitle>
                            <Button variant="outline" size="sm" onClick={refreshWorksheets} disabled={isLoadingWorksheets}>
                                Refresh
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent>
                        {isLoadingWorksheets ? (
                            <div className="space-y-2">
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                                <Skeleton className="h-10 w-full" />
                            </div>
                        ) : worksheets.length === 0 ? (
                            <p className="text-gray-500 text-sm">No worksheets generated yet.</p>
                        ) : (
                            <div className="overflow-x-auto">
                                <table className="w-full text-sm">
                                    <thead>
                                        <tr className="border-b text-left">
                                            <th className="py-2 pr-4">Date</th>
                                            <th className="py-2 pr-4">New Skill</th>
                                            <th className="py-2 pr-4">Review 1</th>
                                            <th className="py-2 pr-4">Review 2</th>
                                            <th className="py-2 pr-4">Status</th>
                                            <th className="py-2">PDF</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {worksheets.map(w => (
                                            <tr key={w.id} className="border-b">
                                                <td className="py-2 pr-4">{new Date(w.scheduledDate).toLocaleDateString()}</td>
                                                <td className="py-2 pr-4">{w.newSkillName ?? w.newSkillId.slice(0, 8)}</td>
                                                <td className="py-2 pr-4">{w.reviewSkill1Name ?? w.reviewSkill1Id.slice(0, 8)}</td>
                                                <td className="py-2 pr-4">{w.reviewSkill2Name ?? w.reviewSkill2Id.slice(0, 8)}</td>
                                                <td className="py-2 pr-4">
                                                    <Badge className={STATUS_COLORS[w.status] ?? ''}>
                                                        {w.status}
                                                    </Badge>
                                                </td>
                                                <td className="py-2">
                                                    {w.status === 'COMPLETED' && w.pdfUrl ? (
                                                        <a
                                                            href={w.pdfUrl}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="text-blue-600 hover:underline"
                                                        >
                                                            Download
                                                        </a>
                                                    ) : w.status === 'FAILED' ? (
                                                        <span className="text-red-500">Failed</span>
                                                    ) : (
                                                        <span className="text-gray-400">Pending</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}
        </div>
    );
}
