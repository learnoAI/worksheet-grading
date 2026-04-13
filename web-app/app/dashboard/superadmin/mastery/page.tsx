'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, ArrowLeft } from 'lucide-react';
import { analyticsAPI, School, Class } from '@/lib/api/analyticsAPI';
import {
    masteryAPI,
    MasteryLevel,
    ClassMasteryOverviewResponse,
    StudentMasteryByTopicResponse,
    StudentRecommendationsResponse,
    TopicMastery,
    Recommendation
} from '@/lib/api/mastery';

// ── Constants ──────────────────────────────────────────────────────────────

const LEVEL_COLORS: Record<MasteryLevel, string> = {
    NOT_STARTED: 'bg-gray-100 text-gray-600',
    ATTEMPTED: 'bg-red-100 text-red-700',
    FAMILIAR: 'bg-yellow-100 text-yellow-700',
    PROFICIENT: 'bg-blue-100 text-blue-700',
    MASTERED: 'bg-green-100 text-green-700'
};

const LEVEL_LABELS: Record<MasteryLevel, string> = {
    NOT_STARTED: 'Not Started',
    ATTEMPTED: 'Attempted',
    FAMILIAR: 'Familiar',
    PROFICIENT: 'Proficient',
    MASTERED: 'Mastered'
};

const LEVEL_SHORT: Record<MasteryLevel, string> = {
    NOT_STARTED: '-',
    ATTEMPTED: 'A',
    FAMILIAR: 'F',
    PROFICIENT: 'P',
    MASTERED: 'M'
};

// ── Helper ─────────────────────────────────────────────────────────────────

function MasteryBadge({ level }: { level: MasteryLevel }) {
    return (
        <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${LEVEL_COLORS[level]}`}>
            {LEVEL_LABELS[level]}
        </span>
    );
}

function MasteryCell({ level }: { level: MasteryLevel }) {
    return (
        <span className={`inline-flex items-center justify-center w-7 h-7 rounded text-xs font-bold ${LEVEL_COLORS[level]}`} title={LEVEL_LABELS[level]}>
            {LEVEL_SHORT[level]}
        </span>
    );
}

function LegendBar() {
    return (
        <div className="flex flex-wrap gap-3 text-xs">
            {(Object.keys(LEVEL_LABELS) as MasteryLevel[]).map(level => (
                <span key={level} className="flex items-center gap-1">
                    <span className={`inline-block w-3 h-3 rounded ${LEVEL_COLORS[level]}`} />
                    {LEVEL_SHORT[level]} = {LEVEL_LABELS[level]}
                </span>
            ))}
        </div>
    );
}

// ── Main Page ──────────────────────────────────────────────────────────────

export default function MasteryPage() {
    // Filter state
    const [schools, setSchools] = useState<School[]>([]);
    const [classes, setClasses] = useState<Class[]>([]);
    const [selectedSchoolId, setSelectedSchoolId] = useState<string>('');
    const [selectedClassId, setSelectedClassId] = useState<string>('');

    // Class overview state
    const [classData, setClassData] = useState<ClassMasteryOverviewResponse['data'] | null>(null);
    const [isLoadingClass, setIsLoadingClass] = useState(false);
    const [page, setPage] = useState(1);
    const pageSize = 30;

    // Student detail state
    const [selectedStudent, setSelectedStudent] = useState<{
        id: string;
        name: string;
        tokenNumber: string | null;
    } | null>(null);
    const [studentTopics, setStudentTopics] = useState<TopicMastery[] | null>(null);
    const [studentRecommendations, setStudentRecommendations] = useState<Recommendation[] | null>(null);
    const [isLoadingStudent, setIsLoadingStudent] = useState(false);
    const [expandedTopics, setExpandedTopics] = useState<Set<string>>(new Set());

    // Load schools
    useEffect(() => {
        const load = async () => {
            try {
                const data = await analyticsAPI.getAllSchools();
                setSchools(data);
            } catch {
                toast.error('Failed to load schools');
            }
        };
        load();
    }, []);

    // Load classes when school changes
    useEffect(() => {
        if (!selectedSchoolId) {
            setClasses([]);
            setSelectedClassId('');
            return;
        }
        const load = async () => {
            try {
                const data = await analyticsAPI.getClassesBySchool(selectedSchoolId);
                setClasses(data);
                setSelectedClassId('');
            } catch {
                toast.error('Failed to load classes');
            }
        };
        load();
    }, [selectedSchoolId]);

    // Load class mastery overview
    const loadClassOverview = useCallback(async () => {
        if (!selectedClassId) {
            setClassData(null);
            return;
        }
        setIsLoadingClass(true);
        setSelectedStudent(null);
        try {
            const res = await masteryAPI.getClassMasteryOverview(selectedClassId, { page, pageSize });
            setClassData(res.data);
        } catch {
            toast.error('Failed to load mastery data');
        } finally {
            setIsLoadingClass(false);
        }
    }, [selectedClassId, page]);

    useEffect(() => {
        setPage(1);
    }, [selectedClassId]);

    useEffect(() => {
        loadClassOverview();
    }, [loadClassOverview]);

    // Load student detail
    const openStudentDetail = async (student: { id: string; name: string; tokenNumber: string | null }) => {
        setSelectedStudent(student);
        setIsLoadingStudent(true);
        setExpandedTopics(new Set());
        try {
            const [topicRes, recRes] = await Promise.all([
                masteryAPI.getStudentMasteryByTopic(student.id),
                masteryAPI.getStudentRecommendations(student.id, 15)
            ]);
            setStudentTopics(topicRes.data.topics);
            setStudentRecommendations(recRes.data.recommendations);
        } catch {
            toast.error('Failed to load student mastery');
        } finally {
            setIsLoadingStudent(false);
        }
    };

    const toggleTopic = (topicId: string) => {
        setExpandedTopics(prev => {
            const next = new Set(prev);
            if (next.has(topicId)) next.delete(topicId);
            else next.add(topicId);
            return next;
        });
    };

    // ── Render ─────────────────────────────────────────────────────────────

    return (
        <div className="space-y-6">
            <h2 className="text-2xl font-bold">Student Mastery</h2>

            {/* Filters */}
            <div className="flex flex-wrap gap-4 items-end">
                <div className="w-64">
                    <label className="block text-sm font-medium text-gray-700 mb-1">School</label>
                    <Select value={selectedSchoolId} onValueChange={setSelectedSchoolId}>
                        <SelectTrigger>
                            <SelectValue placeholder="Select school" />
                        </SelectTrigger>
                        <SelectContent>
                            {schools.map(s => (
                                <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
                <div className="w-64">
                    <label className="block text-sm font-medium text-gray-700 mb-1">Class</label>
                    <Select
                        value={selectedClassId}
                        onValueChange={setSelectedClassId}
                        disabled={!selectedSchoolId}
                    >
                        <SelectTrigger>
                            <SelectValue placeholder={selectedSchoolId ? 'Select class' : 'Select school first'} />
                        </SelectTrigger>
                        <SelectContent>
                            {classes.map(c => (
                                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                </div>
            </div>

            {/* Student detail view */}
            {selectedStudent ? (
                <StudentDetailView
                    student={selectedStudent}
                    topics={studentTopics}
                    recommendations={studentRecommendations}
                    isLoading={isLoadingStudent}
                    expandedTopics={expandedTopics}
                    onToggleTopic={toggleTopic}
                    onBack={() => setSelectedStudent(null)}
                />
            ) : (
                /* Class overview matrix */
                <ClassOverviewView
                    classData={classData}
                    isLoading={isLoadingClass}
                    hasClass={!!selectedClassId}
                    page={page}
                    onPageChange={setPage}
                    onSelectStudent={openStudentDetail}
                />
            )}
        </div>
    );
}

// ── Class Overview Component ───────────────────────────────────────────────

function ClassOverviewView({
    classData,
    isLoading,
    hasClass,
    page,
    onPageChange,
    onSelectStudent
}: {
    classData: ClassMasteryOverviewResponse['data'] | null;
    isLoading: boolean;
    hasClass: boolean;
    page: number;
    onPageChange: (p: number) => void;
    onSelectStudent: (s: { id: string; name: string; tokenNumber: string | null }) => void;
}) {
    if (!hasClass) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-gray-500">
                    Select a school and class to view mastery data.
                </CardContent>
            </Card>
        );
    }

    if (isLoading) {
        return (
            <Card>
                <CardContent className="py-8 space-y-3">
                    {Array.from({ length: 8 }).map((_, i) => (
                        <Skeleton key={i} className="h-8 w-full" />
                    ))}
                </CardContent>
            </Card>
        );
    }

    if (!classData || classData.students.length === 0) {
        return (
            <Card>
                <CardContent className="py-12 text-center text-gray-500">
                    No mastery data found for this class.
                </CardContent>
            </Card>
        );
    }

    const { skills, students, pagination } = classData;

    return (
        <Card>
            <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                    <CardTitle className="text-lg">
                        Class Mastery Overview ({students.length} students, {pagination.totalSkills} skills)
                    </CardTitle>
                    <LegendBar />
                </div>
            </CardHeader>
            <CardContent>
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead>
                            <tr className="border-b">
                                <th className="text-left py-2 px-2 font-medium sticky left-0 bg-white min-w-[180px]">Student</th>
                                {skills.map(skill => (
                                    <th
                                        key={skill.id}
                                        className="text-center py-2 px-1 font-medium min-w-[36px]"
                                        title={`${skill.name}${skill.mainTopicName ? ` (${skill.mainTopicName})` : ''}`}
                                    >
                                        <div className="truncate max-w-[80px] text-xs" title={skill.name}>
                                            {skill.name.length > 10 ? skill.name.slice(0, 10) + '...' : skill.name}
                                        </div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {students.map(student => (
                                <tr key={student.studentId} className="border-b hover:bg-gray-50">
                                    <td className="py-1.5 px-2 sticky left-0 bg-white">
                                        <button
                                            className="text-left hover:text-blue-600 hover:underline font-medium"
                                            onClick={() => onSelectStudent({
                                                id: student.studentId,
                                                name: student.studentName,
                                                tokenNumber: student.tokenNumber
                                            })}
                                        >
                                            {student.studentName}
                                            {student.tokenNumber && (
                                                <span className="text-xs text-gray-400 ml-1">({student.tokenNumber})</span>
                                            )}
                                        </button>
                                    </td>
                                    {student.skills.map(skill => (
                                        <td key={skill.mathSkillId} className="py-1.5 px-1 text-center">
                                            <MasteryCell level={skill.masteryLevel} />
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* Pagination */}
                {pagination.totalPages > 1 && (
                    <div className="flex items-center justify-between mt-4 pt-3 border-t">
                        <span className="text-sm text-gray-500">
                            Skills {(page - 1) * pagination.pageSize + 1}-{Math.min(page * pagination.pageSize, pagination.totalSkills)} of {pagination.totalSkills}
                        </span>
                        <div className="flex gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onPageChange(page - 1)}
                                disabled={page <= 1}
                            >
                                Previous
                            </Button>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => onPageChange(page + 1)}
                                disabled={page >= pagination.totalPages}
                            >
                                Next
                            </Button>
                        </div>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

// ── Student Detail Component ───────────────────────────────────────────────

function StudentDetailView({
    student,
    topics,
    recommendations,
    isLoading,
    expandedTopics,
    onToggleTopic,
    onBack
}: {
    student: { id: string; name: string; tokenNumber: string | null };
    topics: TopicMastery[] | null;
    recommendations: Recommendation[] | null;
    isLoading: boolean;
    expandedTopics: Set<string>;
    onToggleTopic: (topicId: string) => void;
    onBack: () => void;
}) {
    if (isLoading) {
        return (
            <div className="space-y-4">
                <Skeleton className="h-8 w-64" />
                {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 w-full" />
                ))}
            </div>
        );
    }

    return (
        <div className="space-y-6">
            {/* Header */}
            <div className="flex items-center gap-3">
                <Button variant="ghost" size="sm" onClick={onBack}>
                    <ArrowLeft className="h-4 w-4 mr-1" /> Back
                </Button>
                <h3 className="text-lg font-semibold">
                    {student.name}
                    {student.tokenNumber && (
                        <span className="text-sm text-gray-400 font-normal ml-2">({student.tokenNumber})</span>
                    )}
                </h3>
            </div>

            {/* Summary cards */}
            {topics && topics.length > 0 && (
                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {(() => {
                        const allSkills = topics.flatMap(t => t.skills);
                        const counts: Record<MasteryLevel, number> = {
                            NOT_STARTED: 0, ATTEMPTED: 0, FAMILIAR: 0, PROFICIENT: 0, MASTERED: 0
                        };
                        allSkills.forEach(s => counts[s.masteryLevel]++);
                        return (
                            <>
                                <SummaryCard label="Skills Practiced" value={allSkills.length} />
                                <SummaryCard label="Mastered" value={counts.MASTERED} color="text-green-600" />
                                <SummaryCard label="Proficient" value={counts.PROFICIENT} color="text-blue-600" />
                                <SummaryCard label="Needs Work" value={counts.ATTEMPTED + counts.FAMILIAR} color="text-yellow-600" />
                            </>
                        );
                    })()}
                </div>
            )}

            {/* Recommendations */}
            {recommendations && recommendations.length > 0 && (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Review Recommendations</CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-2">
                            {recommendations.slice(0, 8).map(rec => (
                                <div key={rec.mathSkillId} className="flex items-center justify-between py-1.5 border-b last:border-b-0">
                                    <div>
                                        <span className="font-medium text-sm">{rec.skillName}</span>
                                        {rec.mainTopicName && (
                                            <span className="text-xs text-gray-400 ml-2">{rec.mainTopicName}</span>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-3 text-xs">
                                        <MasteryBadge level={rec.masteryLevel} />
                                        <span className="text-gray-500">
                                            {Math.round(rec.retrievability * 100)}% recall
                                        </span>
                                        <span className="text-gray-400">
                                            {rec.daysSinceLastPractice.toFixed(0)}d ago
                                        </span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Topics with skills */}
            {topics && topics.length > 0 ? (
                <Card>
                    <CardHeader className="pb-2">
                        <CardTitle className="text-base">Mastery by Topic</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-1">
                        {topics
                            .sort((a, b) => a.topicName.localeCompare(b.topicName))
                            .map(topic => {
                                const isExpanded = expandedTopics.has(topic.topicId);
                                return (
                                    <div key={topic.topicId} className="border rounded">
                                        <button
                                            className="flex items-center justify-between w-full px-3 py-2 hover:bg-gray-50 text-left"
                                            onClick={() => onToggleTopic(topic.topicId)}
                                        >
                                            <div className="flex items-center gap-2">
                                                {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                                                <span className="font-medium text-sm">{topic.topicName}</span>
                                                <span className="text-xs text-gray-400">({topic.skillCount} skills)</span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <AvgBar score={topic.averageMasteryScore} />
                                                <span className="text-xs text-gray-500 w-8 text-right">
                                                    {topic.averageMasteryScore.toFixed(1)}/4
                                                </span>
                                            </div>
                                        </button>
                                        {isExpanded && (
                                            <div className="border-t px-3 py-2 bg-gray-50/50">
                                                <table className="w-full text-sm">
                                                    <thead>
                                                        <tr className="text-xs text-gray-500">
                                                            <th className="text-left py-1 font-medium">Skill</th>
                                                            <th className="text-center py-1 font-medium w-24">Level</th>
                                                            <th className="text-center py-1 font-medium w-20">Last Score</th>
                                                            <th className="text-center py-1 font-medium w-16">Practices</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {topic.skills.map(skill => (
                                                            <tr key={skill.mathSkillId} className="border-t border-gray-100">
                                                                <td className="py-1.5">{skill.skillName}</td>
                                                                <td className="py-1.5 text-center">
                                                                    <MasteryBadge level={skill.masteryLevel} />
                                                                </td>
                                                                <td className="py-1.5 text-center text-gray-600">
                                                                    {skill.lastScore !== null ? `${Math.round(skill.lastScore * 100)}%` : '-'}
                                                                </td>
                                                                <td className="py-1.5 text-center text-gray-600">
                                                                    {skill.practiceCount}
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                    </CardContent>
                </Card>
            ) : (
                <Card>
                    <CardContent className="py-12 text-center text-gray-500">
                        No mastery data found for this student.
                    </CardContent>
                </Card>
            )}
        </div>
    );
}

// ── Small Components ───────────────────────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: number; color?: string }) {
    return (
        <Card>
            <CardContent className="py-3 px-4">
                <div className={`text-2xl font-bold ${color ?? 'text-gray-900'}`}>{value}</div>
                <div className="text-xs text-gray-500">{label}</div>
            </CardContent>
        </Card>
    );
}

function AvgBar({ score }: { score: number }) {
    const pct = Math.min(100, (score / 4) * 100);
    const color =
        score >= 3 ? 'bg-green-400' :
        score >= 2 ? 'bg-blue-400' :
        score >= 1 ? 'bg-yellow-400' :
        'bg-gray-300';
    return (
        <div className="w-16 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        </div>
    );
}
