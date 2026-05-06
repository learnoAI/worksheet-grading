'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ComponentType } from 'react';
import { Activity, AlertTriangle, CalendarDays, CheckCircle2, Clock3, Gauge, RefreshCw, TimerReset, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Skeleton, SkeletonStyles } from '@/components/ui/skeleton';
import { gradingJobsAPI, type AdminGradingDashboardResponse } from '@/lib/api/gradingJobs';

const MIN_DATE = '2026-05-06';

function todayDateInput(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function formatNumber(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return new Intl.NumberFormat('en-IN').format(value);
}

function formatPercent(value: number | null | undefined): string {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return `${value.toFixed(value % 1 === 0 ? 0 : 1)}%`;
}

function formatDuration(seconds: number | null | undefined): string {
    if (seconds === null || seconds === undefined || Number.isNaN(seconds)) return '—';
    const total = Math.max(0, Math.round(seconds));
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
}

function formatDateTime(value: string | null | undefined): string {
    if (!value) return '—';
    return new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}

function shortReason(reason: string): string {
    return reason.length > 180 ? `${reason.slice(0, 180)}...` : reason;
}

function LiveMetric({
    label,
    value,
    detail,
    tone = 'neutral',
    icon: Icon,
}: {
    label: string;
    value: string;
    detail: string;
    tone?: 'neutral' | 'success' | 'warning' | 'danger';
    icon: ComponentType<{ className?: string }>;
}) {
    const toneClass = {
        neutral: 'border-slate-200 bg-slate-50 text-slate-900',
        success: 'border-emerald-200 bg-emerald-50 text-emerald-950',
        warning: 'border-amber-200 bg-amber-50 text-amber-950',
        danger: 'border-rose-200 bg-rose-50 text-rose-950',
    }[tone];

    return (
        <div className={`rounded-md border p-4 ${toneClass}`}>
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
                    <div className="mt-2 text-3xl font-semibold tracking-normal">{value}</div>
                </div>
                <Icon className="h-5 w-5 text-slate-500" />
            </div>
            <div className="mt-3 text-sm text-slate-600">{detail}</div>
        </div>
    );
}

function SummaryMetric({ label, value, sub }: { label: string; value: string; sub?: string }) {
    return (
        <div className="border-b border-slate-200 py-3 sm:border-b-0 sm:border-r sm:px-4 last:border-r-0">
            <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
            {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
        </div>
    );
}

function LoadingState() {
    return (
        <div className="space-y-6">
            <SkeletonStyles />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="rounded-md border p-4">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="mt-3 h-8 w-16" />
                        <Skeleton className="mt-4 h-4 w-full" />
                    </div>
                ))}
            </div>
            <Skeleton className="h-72 w-full" />
        </div>
    );
}

export default function SuperAdminGradingJobsPage() {
    const today = useMemo(() => todayDateInput(), []);
    const [startDate, setStartDate] = useState(today < MIN_DATE ? MIN_DATE : today);
    const [endDate, setEndDate] = useState(today < MIN_DATE ? MIN_DATE : today);
    const [appliedRange, setAppliedRange] = useState({ startDate: today < MIN_DATE ? MIN_DATE : today, endDate: today < MIN_DATE ? MIN_DATE : today });
    const [data, setData] = useState<AdminGradingDashboardResponse | null>(null);
    const [isLoading, setIsLoading] = useState(true);
    const [isRefreshing, setIsRefreshing] = useState(false);

    const fetchDashboard = useCallback(async (range: { startDate: string; endDate: string }, refreshOnly = false) => {
        try {
            refreshOnly ? setIsRefreshing(true) : setIsLoading(true);
            const response = await gradingJobsAPI.getAdminDashboard(range.startDate, range.endDate);
            setData(response);
        } catch (error) {
            console.error('Error loading grading jobs dashboard:', error);
            toast.error('Failed to load grading jobs dashboard');
        } finally {
            setIsLoading(false);
            setIsRefreshing(false);
        }
    }, []);

    useEffect(() => {
        fetchDashboard(appliedRange);
    }, [appliedRange, fetchDashboard]);

    const applyRange = () => {
        const nextStart = startDate < MIN_DATE ? MIN_DATE : startDate;
        const nextEnd = endDate < nextStart ? nextStart : endDate;
        const nextRange = { startDate: nextStart, endDate: nextEnd };

        setStartDate(nextStart);
        setEndDate(nextEnd);
        setAppliedRange(nextRange);
    };

    const refreshCurrent = () => {
        fetchDashboard(appliedRange, true);
    };

    const historical = data?.historical;
    const summary = historical?.summary;
    const terminalTotal = (summary?.completed || 0) + (summary?.failed || 0);
    const maxDailyTotal = Math.max(...(historical?.byDay.map((row) => row.total) || [1]), 1);

    if (isLoading && !data) {
        return <LoadingState />;
    }

    return (
        <div className="space-y-7">
            <div className="flex flex-col gap-3 border-b border-slate-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
                <div>
                    <h1 className="text-2xl font-semibold tracking-normal text-slate-950">Grading Jobs</h1>
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Badge variant="outline" className="border-slate-300 text-slate-600">Since 6 May</Badge>
                        {data?.current.generatedAt && (
                            <span className="text-sm text-slate-500">Updated {formatDateTime(data.current.generatedAt)}</span>
                        )}
                    </div>
                </div>
                <Button variant="outline" onClick={refreshCurrent} disabled={isRefreshing}>
                    <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
                    Refresh
                </Button>
            </div>

            <section className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                    <LiveMetric
                        label="In Progress"
                        value={formatNumber(data?.current.processing)}
                        detail={`${formatNumber(data?.current.activeProcessing)} active heartbeat, ${formatNumber(data?.current.staleProcessing)} stale`}
                        icon={Activity}
                        tone={(data?.current.staleProcessing || 0) > 0 ? 'warning' : 'neutral'}
                    />
                    <LiveMetric
                        label="Queued"
                        value={formatNumber(data?.current.queued)}
                        detail={`${formatNumber(data?.current.inProgress)} in progress right now`}
                        icon={Clock3}
                        tone={(data?.current.queued || 0) > 0 ? 'warning' : 'success'}
                    />
                    <LiveMetric
                        label="Avg Active Time"
                        value={formatDuration(data?.current.avgProcessingSeconds)}
                        detail={`Oldest active ${formatDuration(data?.current.oldestProcessingSeconds)}`}
                        icon={TimerReset}
                    />
                    <LiveMetric
                        label="No Heartbeat"
                        value={formatNumber(data?.current.noHeartbeat)}
                        detail="Processing jobs without a heartbeat timestamp"
                        icon={AlertTriangle}
                        tone={(data?.current.noHeartbeat || 0) > 0 ? 'danger' : 'success'}
                    />
                </div>

                {(data?.current.byClass.length || 0) > 0 && (
                    <div className="rounded-md border border-slate-200">
                        <div className="grid grid-cols-[1fr_auto_auto] gap-3 border-b border-slate-200 px-4 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                            <span>Current Classes</span>
                            <span>Processing</span>
                            <span>Queued</span>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {data?.current.byClass.map((row) => (
                                <div key={`${row.schoolName}-${row.className}`} className="grid grid-cols-[1fr_auto_auto] gap-3 px-4 py-3 text-sm">
                                    <div>
                                        <div className="font-medium text-slate-900">{row.className}</div>
                                        <div className="text-xs text-slate-500">{row.schoolName}</div>
                                    </div>
                                    <div className="font-semibold text-slate-900">{row.processing}</div>
                                    <div className="font-semibold text-slate-900">{row.queued}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </section>

            <section className="space-y-5 border-t border-slate-200 pt-6">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                    <div>
                        <div className="flex items-center gap-2">
                            <CalendarDays className="h-5 w-5 text-slate-500" />
                            <h2 className="text-xl font-semibold text-slate-950">Historical Jobs</h2>
                        </div>
                        <div className="mt-2 text-sm text-slate-500">
                            {data?.dateRange.startDate === data?.dateRange.endDate
                                ? data?.dateRange.startDate
                                : `${data?.dateRange.startDate} to ${data?.dateRange.endDate}`}
                        </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto]">
                        <div>
                            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">Start</label>
                            <Input type="date" min={MIN_DATE} max={today} value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                        </div>
                        <div>
                            <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-slate-500">End</label>
                            <Input type="date" min={startDate || MIN_DATE} max={today} value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                        </div>
                        <Button className="self-end" onClick={applyRange}>Apply</Button>
                    </div>
                </div>

                <div className="grid rounded-md border border-slate-200 sm:grid-cols-2 xl:grid-cols-6">
                    <SummaryMetric label="Total" value={formatNumber(summary?.total)} />
                    <SummaryMetric label="Completed" value={formatNumber(summary?.completed)} sub={formatPercent(summary?.successRate)} />
                    <SummaryMetric label="Failed" value={formatNumber(summary?.failed)} sub={formatPercent(summary?.failureRate)} />
                    <SummaryMetric label="Avg Job" value={formatDuration(summary?.avgJobSeconds)} />
                    <SummaryMetric label="Avg Success" value={formatDuration(summary?.avgSuccessSeconds)} />
                    <SummaryMetric label="Avg Attempts" value={formatNumber(summary?.avgAttempts)} />
                </div>

                <div className="rounded-md border border-slate-200">
                    <div className="border-b border-slate-200 px-4 py-3 text-sm font-semibold text-slate-950">Duration Percentiles</div>
                    <div className="grid sm:grid-cols-2 xl:grid-cols-4">
                        <SummaryMetric label="P75" value={formatDuration(summary?.p75JobSeconds)} />
                        <SummaryMetric label="P90" value={formatDuration(summary?.p90JobSeconds)} />
                        <SummaryMetric label="P95" value={formatDuration(summary?.p95JobSeconds)} />
                        <SummaryMetric label="P99" value={formatDuration(summary?.p99JobSeconds)} />
                    </div>
                </div>

                <div className="grid gap-5 xl:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
                    <div className="rounded-md border border-slate-200">
                        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
                            <div className="flex items-center gap-2 font-semibold text-slate-950">
                                <Gauge className="h-4 w-4 text-slate-500" />
                                Daily Throughput
                            </div>
                            <span className="text-xs text-slate-500">{formatNumber(terminalTotal)} terminal jobs</span>
                        </div>
                        <div className="divide-y divide-slate-100">
                            {historical?.byDay.length ? historical.byDay.map((row) => (
                                <div key={row.date} className="grid gap-3 px-4 py-3 text-sm md:grid-cols-[110px_1fr_90px_90px_90px] md:items-center">
                                    <div className="font-medium text-slate-900">{row.date}</div>
                                    <div className="h-3 overflow-hidden rounded-full bg-slate-100">
                                        <div className="h-full rounded-full bg-slate-900" style={{ width: `${Math.max(4, (row.total / maxDailyTotal) * 100)}%` }} />
                                    </div>
                                    <div className="text-slate-600">{formatNumber(row.total)} total</div>
                                    <div className="text-emerald-700">{formatNumber(row.completed)} done</div>
                                    <div className="text-rose-700">{formatNumber(row.failed)} failed</div>
                                    <div className="md:col-start-2 md:col-span-4 text-xs text-slate-500">
                                        Avg {formatDuration(row.avgJobSeconds)} · Success {formatPercent(row.successRate)}
                                    </div>
                                </div>
                            )) : (
                                <div className="px-4 py-10 text-center text-sm text-slate-500">No jobs in this range.</div>
                            )}
                        </div>
                    </div>

                    <div className="rounded-md border border-slate-200">
                        <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 font-semibold text-slate-950">
                            <XCircle className="h-4 w-4 text-rose-600" />
                            Failure Reasons
                        </div>
                        <div className="max-h-[440px] divide-y divide-slate-100 overflow-auto">
                            {historical?.failureReasons.length ? historical.failureReasons.map((row) => (
                                <div key={row.reason} className="px-4 py-3">
                                    <div className="flex items-start justify-between gap-3">
                                        <div className="text-sm font-medium text-slate-900">{shortReason(row.reason)}</div>
                                        <Badge variant="destructive">{row.count}</Badge>
                                    </div>
                                    <div className="mt-2 text-xs text-slate-500">Latest {formatDateTime(row.latestAt)}</div>
                                    <div className="mt-2 flex flex-wrap gap-1">
                                        {row.examples.map((example) => (
                                            <Badge key={example.id} variant="outline" className="border-slate-300 text-slate-600">
                                                #{example.worksheetNumber} · {example.className}
                                            </Badge>
                                        ))}
                                    </div>
                                </div>
                            )) : (
                                <div className="px-4 py-10 text-center text-sm text-slate-500">No failures in this range.</div>
                            )}
                        </div>
                    </div>
                </div>

                <div className="rounded-md border border-slate-200">
                    <div className="flex items-center gap-2 border-b border-slate-200 px-4 py-3 font-semibold text-slate-950">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        Recent Failed Jobs
                    </div>
                    <div className="overflow-x-auto">
                        <table className="w-full min-w-[900px] text-sm">
                            <thead className="border-b border-slate-200 bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                                <tr>
                                    <th className="px-4 py-3">Worksheet</th>
                                    <th className="px-4 py-3">Student</th>
                                    <th className="px-4 py-3">Class</th>
                                    <th className="px-4 py-3">Reason</th>
                                    <th className="px-4 py-3">Attempts</th>
                                    <th className="px-4 py-3">Time</th>
                                    <th className="px-4 py-3">Failed</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100">
                                {historical?.recentFailures.length ? historical.recentFailures.map((job) => (
                                    <tr key={job.id}>
                                        <td className="px-4 py-3 font-medium text-slate-950">#{job.worksheetNumber}</td>
                                        <td className="px-4 py-3 text-slate-700">{job.studentName}</td>
                                        <td className="px-4 py-3">
                                            <div className="text-slate-900">{job.className}</div>
                                            <div className="text-xs text-slate-500">{job.schoolName}</div>
                                        </td>
                                        <td className="max-w-[360px] px-4 py-3 text-slate-700">{shortReason(job.reason)}</td>
                                        <td className="px-4 py-3 text-slate-700">{job.attemptCount}</td>
                                        <td className="px-4 py-3 text-slate-700">{formatDuration(job.durationSeconds)}</td>
                                        <td className="px-4 py-3 text-slate-700">{formatDateTime(job.completedAt || job.lastErrorAt || job.createdAt)}</td>
                                    </tr>
                                )) : (
                                    <tr>
                                        <td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-500">
                                            No failed jobs in this range.
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-md border border-emerald-200 bg-emerald-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-emerald-950">
                            <CheckCircle2 className="h-4 w-4" />
                            Success Time
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-emerald-950">{formatDuration(summary?.avgSuccessSeconds)}</div>
                    </div>
                    <div className="rounded-md border border-rose-200 bg-rose-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-rose-950">
                            <XCircle className="h-4 w-4" />
                            Failure Time
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-rose-950">{formatDuration(summary?.avgFailureSeconds)}</div>
                    </div>
                    <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                        <div className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                            <Clock3 className="h-4 w-4" />
                            Open Jobs In Range
                        </div>
                        <div className="mt-2 text-2xl font-semibold text-slate-950">
                            {formatNumber((summary?.queued || 0) + (summary?.processing || 0))}
                        </div>
                    </div>
                </div>
            </section>
        </div>
    );
}
