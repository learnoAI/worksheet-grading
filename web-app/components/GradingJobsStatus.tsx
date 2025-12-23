'use client';

import { useState, useEffect, useCallback } from 'react';
import { gradingJobsAPI, GradingJobSummary, GradingJob } from '@/lib/api/gradingJobs';
import { Loader2, CheckCircle2, Clock, AlertCircle } from 'lucide-react';

interface GradingJobsStatusProps {
    className?: string;
    refreshTrigger?: number;
}

export function GradingJobsStatus({ className = '', refreshTrigger = 0 }: GradingJobsStatusProps) {
    const [summary, setSummary] = useState<GradingJobSummary | null>(null);
    const [activeJobs, setActiveJobs] = useState<GradingJob[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchData = useCallback(async () => {
        try {
            const response = await gradingJobsAPI.getTeacherJobsToday();
            setSummary(response.summary);
            setActiveJobs(response.jobs.filter(j => j.status === 'PROCESSING' || j.status === 'QUEUED').slice(0, 3));
        } catch (e) {
            console.error('Failed to fetch grading jobs:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, [fetchData, refreshTrigger]);

    // Don't show if no jobs today
    if (!loading && summary?.total === 0) {
        return null;
    }

    const hasActiveJobs = (summary?.queued || 0) + (summary?.processing || 0) > 0;

    return (
        <div className={`bg-gray-50 border border-gray-200 rounded-lg p-3 ${className}`}>
            <div className="flex flex-wrap items-center gap-3 md:gap-6">
                {/* Title with spinner when active */}
                <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                    {hasActiveJobs ? (
                        <Loader2 className="w-4 h-4 animate-spin text-blue-500" />
                    ) : (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                    )}
                    <span>AI Grading</span>
                </div>

                {/* Stats - compact pills */}
                <div className="flex flex-wrap items-center gap-2 text-xs">
                    {(summary?.processing || 0) > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-blue-100 text-blue-700 rounded-full">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            {summary?.processing} grading
                        </span>
                    )}
                    {(summary?.queued || 0) > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-yellow-100 text-yellow-700 rounded-full">
                            <Clock className="w-3 h-3" />
                            {summary?.queued} queued
                        </span>
                    )}
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-green-100 text-green-700 rounded-full">
                        <CheckCircle2 className="w-3 h-3" />
                        {summary?.completed || 0} done
                    </span>
                    {(summary?.failed || 0) > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-1 bg-red-100 text-red-700 rounded-full">
                            <AlertCircle className="w-3 h-3" />
                            {summary?.failed} failed
                        </span>
                    )}
                </div>

                {/* Active job names - compact */}
                {activeJobs.length > 0 && (
                    <div className="hidden md:flex items-center gap-2 text-xs text-gray-500 border-l border-gray-300 pl-3 ml-auto">
                        {activeJobs.map(job => (
                            <span key={job.id} className="truncate max-w-[100px]">
                                {job.studentName}
                            </span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
