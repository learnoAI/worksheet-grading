'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { userAPI } from '@/lib/api/user';
import { classAPI } from '@/lib/api/class';
import { User, UserRole } from '@/lib/api/types';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { Loader2, ArrowRight } from 'lucide-react';

type SourceClass = {
    classId: string;
    name: string;
    academicYear: string;
    schoolId: string;
    schoolName: string;
    blockReasons: string[];
};

const REASON_LABEL: Record<string, string> = {
    upload_in_progress: 'Upload in progress',
    worksheet_not_graded: 'AI grading not finished',
    grading_job_in_flight: 'Grading job in flight'
};

const SKIP_REASON_LABEL: Record<string, string> = {
    already_assigned: 'Target SR already had this class',
    source_no_longer_assigned: 'Source SR no longer had this class'
};

export default function ReassignClassesPage() {
    const { user, isLoading: authLoading } = useAuth();
    const router = useRouter();
    const searchParams = useSearchParams();

    const [teachers, setTeachers] = useState<User[]>([]);
    const [loadingTeachers, setLoadingTeachers] = useState(true);

    const [fromTeacherId, setFromTeacherId] = useState<string>('');
    const [toTeacherId, setToTeacherId] = useState<string>('');

    const [sourceClasses, setSourceClasses] = useState<SourceClass[]>([]);
    const [loadingSourceClasses, setLoadingSourceClasses] = useState(false);
    const [selectedClassIds, setSelectedClassIds] = useState<Set<string>>(new Set());

    const [confirmOpen, setConfirmOpen] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [result, setResult] = useState<{
        batchId: string;
        moved: string[];
        skipped: Array<{ classId: string; reason: string }>;
    } | null>(null);

    // Auth gate
    useEffect(() => {
        if (!authLoading && (!user || user.role !== UserRole.SUPERADMIN)) {
            toast.error('Access denied');
            router.push('/dashboard');
        }
    }, [user, authLoading, router]);

    // Load all teachers once
    useEffect(() => {
        if (user?.role !== UserRole.SUPERADMIN) return;
        (async () => {
            try {
                setLoadingTeachers(true);
                const data = await userAPI.getUsers(UserRole.TEACHER, { includeArchived: false });
                setTeachers(data);

                // Pre-select source from query string if provided
                const initial = searchParams.get('fromTeacherId');
                if (initial && data.some(t => t.id === initial)) {
                    setFromTeacherId(initial);
                }
            } catch (err) {
                toast.error('Failed to load teachers');
            } finally {
                setLoadingTeachers(false);
            }
        })();
    }, [user, searchParams]);

    // Load source's classes when source changes
    useEffect(() => {
        if (!fromTeacherId) {
            setSourceClasses([]);
            setSelectedClassIds(new Set());
            return;
        }
        (async () => {
            try {
                setLoadingSourceClasses(true);
                setSelectedClassIds(new Set());
                const data = await classAPI.getClassesByTeacherWithStatus(fromTeacherId);
                setSourceClasses(data.classes);
            } catch (err) {
                toast.error('Failed to load source SR classes');
                setSourceClasses([]);
            } finally {
                setLoadingSourceClasses(false);
            }
        })();
    }, [fromTeacherId]);

    const classesBySchool = useMemo(() => {
        const groups = new Map<string, { schoolName: string; classes: SourceClass[] }>();
        for (const c of sourceClasses) {
            if (!groups.has(c.schoolId)) {
                groups.set(c.schoolId, { schoolName: c.schoolName, classes: [] });
            }
            groups.get(c.schoolId)!.classes.push(c);
        }
        return Array.from(groups.entries()).map(([schoolId, g]) => ({ schoolId, ...g }));
    }, [sourceClasses]);

    const toggleClass = (classId: string) => {
        setSelectedClassIds(prev => {
            const next = new Set(prev);
            if (next.has(classId)) next.delete(classId);
            else next.add(classId);
            return next;
        });
    };

    const selectableInSchool = (schoolId: string) =>
        sourceClasses.filter(c => c.schoolId === schoolId && c.blockReasons.length === 0);

    const toggleSchool = (schoolId: string) => {
        const items = selectableInSchool(schoolId);
        const allSelected = items.every(c => selectedClassIds.has(c.classId));
        setSelectedClassIds(prev => {
            const next = new Set(prev);
            for (const c of items) {
                if (allSelected) next.delete(c.classId);
                else next.add(c.classId);
            }
            return next;
        });
    };

    const fromTeacher = teachers.find(t => t.id === fromTeacherId) ?? null;
    const toTeacher = teachers.find(t => t.id === toTeacherId) ?? null;

    const selectedClasses = useMemo(
        () => sourceClasses.filter(c => selectedClassIds.has(c.classId)),
        [sourceClasses, selectedClassIds]
    );

    const canSubmit =
        !!fromTeacherId &&
        !!toTeacherId &&
        fromTeacherId !== toTeacherId &&
        selectedClasses.length > 0 &&
        selectedClasses.every(c => c.blockReasons.length === 0);

    const handleSubmit = async () => {
        if (!canSubmit || !fromTeacher || !toTeacher) return;
        try {
            setSubmitting(true);
            const res = await classAPI.reassignClasses({
                fromTeacherId,
                toTeacherId,
                classIds: Array.from(selectedClassIds)
            });
            setResult(res);
            setConfirmOpen(false);
            toast.success(`Reassigned ${res.moved.length} class${res.moved.length === 1 ? '' : 'es'}`);
            // Refresh source view
            const refreshed = await classAPI.getClassesByTeacherWithStatus(fromTeacherId);
            setSourceClasses(refreshed.classes);
            setSelectedClassIds(new Set());
        } catch (err: any) {
            const message = err?.message || 'Reassignment failed';
            // Surface 409 blocked details if API returns structured payload
            const blocked = err?.data?.blocked as
                | Array<{ classId: string; reason: string }>
                | undefined;
            if (blocked && blocked.length) {
                toast.error(
                    `Blocked: ${blocked.length} class${blocked.length === 1 ? '' : 'es'} have in-flight work`
                );
                // Refresh to surface the block reasons in UI
                if (fromTeacherId) {
                    const refreshed = await classAPI.getClassesByTeacherWithStatus(fromTeacherId);
                    setSourceClasses(refreshed.classes);
                }
            } else {
                toast.error(message);
            }
        } finally {
            setSubmitting(false);
        }
    };

    if (authLoading || !user || user.role !== UserRole.SUPERADMIN) {
        return null;
    }

    return (
        <div className="space-y-6">
            <div>
                <h1 className="text-2xl font-bold">Reassign SR Classes</h1>
                <p className="text-sm text-muted-foreground mt-1">
                    Move classes from one SR (teacher) to another. Cross-school is supported. History is preserved — only future uploads route to the new SR.
                </p>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>1. Pick the source SR</CardTitle>
                    <CardDescription>The SR whose classes you want to move out.</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="max-w-md">
                        <Label htmlFor="from-sr">Source SR</Label>
                        <Select value={fromTeacherId} onValueChange={setFromTeacherId} disabled={loadingTeachers}>
                            <SelectTrigger id="from-sr">
                                <SelectValue placeholder={loadingTeachers ? 'Loading…' : 'Select source SR'} />
                            </SelectTrigger>
                            <SelectContent>
                                {teachers.map(t => {
                                    const schools = t.teacherSchools?.map(ts => ts.school.name) ?? [];
                                    return (
                                        <SelectItem key={t.id} value={t.id}>
                                            <span className="font-medium">{t.name}</span>{' '}
                                            <span className="text-muted-foreground">({t.username})</span>
                                            {schools.length > 0 && (
                                                <span className="text-muted-foreground">
                                                    {' '}— {schools.join(', ')}
                                                </span>
                                            )}
                                        </SelectItem>
                                    );
                                })}
                            </SelectContent>
                        </Select>
                    </div>
                </CardContent>
            </Card>

            {fromTeacherId && (
                <Card>
                    <CardHeader>
                        <CardTitle>2. Choose classes to move</CardTitle>
                        <CardDescription>
                            Showing {fromTeacher?.name}&rsquo;s active classes across all schools. Blocked rows can&rsquo;t be moved until in-flight work completes.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        {loadingSourceClasses ? (
                            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                                <Loader2 className="h-4 w-4 animate-spin" /> Loading classes…
                            </div>
                        ) : sourceClasses.length === 0 ? (
                            <p className="text-sm text-muted-foreground">This SR has no active classes.</p>
                        ) : (
                            <div className="space-y-6">
                                {classesBySchool.map(group => {
                                    const items = selectableInSchool(group.schoolId);
                                    const allSelected =
                                        items.length > 0 && items.every(c => selectedClassIds.has(c.classId));
                                    return (
                                        <div key={group.schoolId}>
                                            <div className="flex items-center justify-between mb-2">
                                                <h3 className="font-medium">{group.schoolName}</h3>
                                                {items.length > 0 && (
                                                    <Button
                                                        type="button"
                                                        size="sm"
                                                        variant="ghost"
                                                        onClick={() => toggleSchool(group.schoolId)}
                                                    >
                                                        {allSelected ? 'Clear all' : 'Select all'}
                                                    </Button>
                                                )}
                                            </div>
                                            <div className="space-y-1 border rounded-md divide-y">
                                                {group.classes.map(c => {
                                                    const blocked = c.blockReasons.length > 0;
                                                    const checked = selectedClassIds.has(c.classId);
                                                    return (
                                                        <label
                                                            key={c.classId}
                                                            className={`flex items-center gap-3 px-3 py-2 text-sm ${
                                                                blocked
                                                                    ? 'bg-gray-50 text-muted-foreground cursor-not-allowed'
                                                                    : 'cursor-pointer hover:bg-gray-50'
                                                            }`}
                                                        >
                                                            <input
                                                                type="checkbox"
                                                                disabled={blocked}
                                                                checked={checked}
                                                                onChange={() => toggleClass(c.classId)}
                                                            />
                                                            <span className="flex-1">
                                                                {c.name}{' '}
                                                                <span className="text-xs text-muted-foreground">
                                                                    ({c.academicYear})
                                                                </span>
                                                            </span>
                                                            {c.blockReasons.map(r => (
                                                                <Badge
                                                                    key={r}
                                                                    variant="outline"
                                                                    className="border-amber-300 bg-amber-50 text-amber-800"
                                                                    title={REASON_LABEL[r] || r}
                                                                >
                                                                    {REASON_LABEL[r] || r}
                                                                </Badge>
                                                            ))}
                                                        </label>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {fromTeacherId && (
                <Card>
                    <CardHeader>
                        <CardTitle>3. Pick the target SR</CardTitle>
                        <CardDescription>
                            The SR who will own the selected classes going forward.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="max-w-md">
                            <Label htmlFor="to-sr">Target SR</Label>
                            <Select value={toTeacherId} onValueChange={setToTeacherId} disabled={loadingTeachers}>
                                <SelectTrigger id="to-sr">
                                    <SelectValue placeholder={loadingTeachers ? 'Loading…' : 'Select target SR'} />
                                </SelectTrigger>
                                <SelectContent>
                                    {teachers
                                        .filter(t => t.id !== fromTeacherId)
                                        .map(t => (
                                            <SelectItem key={t.id} value={t.id}>
                                                {t.name}{' '}
                                                <span className="text-muted-foreground">({t.username})</span>
                                            </SelectItem>
                                        ))}
                                </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-2">
                                Need a new SR?{' '}
                                <Link
                                    href="/dashboard/superadmin/create-user"
                                    className="text-blue-600 underline"
                                >
                                    Create one →
                                </Link>
                            </p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {fromTeacherId && toTeacherId && selectedClasses.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle>4. Review &amp; confirm</CardTitle>
                        <CardDescription>
                            {selectedClasses.length} class{selectedClasses.length === 1 ? '' : 'es'} will move from{' '}
                            <strong>{fromTeacher?.name}</strong> to <strong>{toTeacher?.name}</strong>.
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2 max-h-64 overflow-y-auto border rounded-md divide-y mb-4">
                            {selectedClasses.map(c => (
                                <div
                                    key={c.classId}
                                    className="flex items-center justify-between text-sm px-3 py-2"
                                >
                                    <span>
                                        {c.schoolName} — {c.name}{' '}
                                        <span className="text-xs text-muted-foreground">
                                            ({c.academicYear})
                                        </span>
                                    </span>
                                    <span className="flex items-center gap-1 text-muted-foreground text-xs">
                                        {fromTeacher?.name} <ArrowRight className="h-3 w-3" /> {toTeacher?.name}
                                    </span>
                                </div>
                            ))}
                        </div>
                        <Button onClick={() => setConfirmOpen(true)} disabled={!canSubmit}>
                            Reassign {selectedClasses.length} class{selectedClasses.length === 1 ? '' : 'es'}
                        </Button>
                    </CardContent>
                </Card>
            )}

            {result && (
                <Card>
                    <CardHeader>
                        <CardTitle>Result</CardTitle>
                        <CardDescription>Batch ID: {result.batchId}</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                        <p className="text-sm">
                            Moved <strong>{result.moved.length}</strong> class
                            {result.moved.length === 1 ? '' : 'es'}; skipped{' '}
                            <strong>{result.skipped.length}</strong>.
                        </p>
                        {result.skipped.length > 0 && (
                            <div className="border rounded-md divide-y text-sm">
                                {result.skipped.map(s => (
                                    <div
                                        key={s.classId}
                                        className="px-3 py-2 flex justify-between items-center"
                                    >
                                        <span className="font-mono text-xs">{s.classId}</span>
                                        <span className="text-muted-foreground">
                                            {SKIP_REASON_LABEL[s.reason] || s.reason}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Confirm reassignment</DialogTitle>
                        <DialogDescription>
                            {selectedClasses.length} class{selectedClasses.length === 1 ? '' : 'es'} from{' '}
                            <strong>{fromTeacher?.name}</strong> will move to <strong>{toTeacher?.name}</strong>.
                            Past uploads stay attributed to {fromTeacher?.name}; future uploads will route to{' '}
                            {toTeacher?.name}.
                        </DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={submitting}>
                            Cancel
                        </Button>
                        <Button onClick={handleSubmit} disabled={submitting}>
                            {submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                            Confirm reassign
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    );
}
