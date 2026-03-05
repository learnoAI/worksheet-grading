'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { analyticsAPI, School, Class } from '@/lib/api/analyticsAPI';
import { worksheetGenerationAPI, GeneratedWorksheet } from '@/lib/api/worksheetGeneration';

const STATUS_COLORS: Record<string, string> = {
    PENDING: 'bg-gray-100 text-gray-700',
    QUESTIONS_READY: 'bg-blue-100 text-blue-700',
    RENDERING: 'bg-yellow-100 text-yellow-700',
    COMPLETED: 'bg-green-100 text-green-700',
    FAILED: 'bg-red-100 text-red-700'
};

export default function GenerateWorksheetsPage() {
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

    // State
    const [isGenerating, setIsGenerating] = useState(false);
    const [worksheets, setWorksheets] = useState<GeneratedWorksheet[]>([]);
    const [isLoadingWorksheets, setIsLoadingWorksheets] = useState(false);

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

    // Load students when class changes
    useEffect(() => {
        if (!selectedClassId) { setStudents([]); setSelectedStudentId(''); return; }
        analyticsAPI.getStudentAnalytics({ classId: selectedClassId, pageSize: 200 })
            .then(res => {
                setStudents(res.students.map(s => ({ id: s.id, name: s.name, tokenNumber: s.tokenNumber })));
                setSelectedStudentId('');
            })
            .catch(() => toast.error('Failed to load students'));
    }, [selectedClassId]);

    // Load existing worksheets when student changes
    useEffect(() => {
        if (!selectedStudentId) { setWorksheets([]); return; }
        setIsLoadingWorksheets(true);
        worksheetGenerationAPI.listForStudent(selectedStudentId)
            .then(res => setWorksheets(res.data))
            .catch(() => toast.error('Failed to load worksheets'))
            .finally(() => setIsLoadingWorksheets(false));
    }, [selectedStudentId]);

    const handleGenerate = async () => {
        if (!selectedStudentId) { toast.error('Select a student first'); return; }
        setIsGenerating(true);
        try {
            const res = await worksheetGenerationAPI.generate(selectedStudentId, parseInt(days), startDate);
            toast.success(`Generated ${res.data.worksheetIds.length} worksheet(s)`);
            if (res.data.errors.length > 0) {
                toast.warning(`Warnings: ${res.data.errors.join(', ')}`);
            }
            // Refresh list
            const updated = await worksheetGenerationAPI.listForStudent(selectedStudentId);
            setWorksheets(updated.data);
        } catch (err) {
            toast.error(`Generation failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
        } finally {
            setIsGenerating(false);
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

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Generate Worksheets</h2>

            {/* Filters */}
            <Card>
                <CardHeader><CardTitle>Select Student</CardTitle></CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
                    </div>
                </CardContent>
            </Card>

            {/* Generation Form */}
            {selectedStudentId && (
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

            {/* Worksheets List */}
            {selectedStudentId && (
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
