'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { gradingJobsAPI, TeacherJobsSummary } from '@/lib/api/gradingJobs';
import { Loader2, CheckCircle2, XCircle, Clock, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface AIGradingStatusBarProps {
    refreshKey?: number;
    onRefresh?: () => void;
}

export function AIGradingStatusBar({ refreshKey, onRefresh }: AIGradingStatusBarProps) {
    const [summary, setSummary] = useState<TeacherJobsSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const fetchSummary = useCallback(async () => {
        try {
            setError(null);
            const response = await gradingJobsAPI.getMyJobsSummary();
            setSummary({
                pending: response.pending,
                processing: response.processing,
                completed: response.completed,
                failed: response.failed,
                total: response.total
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch status');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchSummary();

        const interval = setInterval(() => {
            if (summary && (summary.pending > 0 || summary.processing > 0)) {
                fetchSummary();
            }
        }, 10000);

        return () => clearInterval(interval);
    }, [fetchSummary, summary?.pending, summary?.processing, refreshKey]);

    const handleRefresh = () => {
        setLoading(true);
        fetchSummary();
        onRefresh?.();
    };

    const hasActiveJobs = summary && (summary.pending > 0 || summary.processing > 0);
    const hasAnyJobs = summary && summary.total > 0;

    return (
        <div className={`rounded-lg border ${hasActiveJobs ? 'border-blue-200 bg-blue-50' : 'border-gray-200 bg-gray-50'} p-3 mb-4`}>
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <span className="text-sm font-semibold text-gray-900">AI Grading</span>
                    </div>

                    {loading && !summary ? (
                        <div className="flex items-center gap-2 text-gray-500">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            <span className="text-xs">Loading...</span>
                        </div>
                    ) : error ? (
                        <div className="flex items-center gap-2 text-red-600">
                            <XCircle className="h-3.5 w-3.5" />
                            <span className="text-xs">{error}</span>
                        </div>
                    ) : !hasAnyJobs ? (
                        <span className="text-xs text-gray-500">No active jobs</span>
                    ) : (
                        <div className="flex items-center gap-2 flex-wrap">
                            {summary!.pending > 0 && (
                                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-yellow-100 text-yellow-800">
                                    <Clock className="h-3 w-3" />
                                    <span className="text-xs font-medium">{summary!.pending} Queued</span>
                                </div>
                            )}

                            {/* Processing */}
                            {summary!.processing > 0 && (
                                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-100 text-blue-800">
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                    <span className="text-xs font-medium">{summary!.processing} Processing</span>
                                </div>
                            )}

                            {summary!.completed > 0 && (
                                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-green-100 text-green-800">
                                    <CheckCircle2 className="h-3 w-3" />
                                    <span className="text-xs font-medium">{summary!.completed} Completed</span>
                                </div>
                            )}

                            {summary!.failed > 0 && (
                                <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-100 text-red-800">
                                    <XCircle className="h-3 w-3" />
                                    <span className="text-xs font-medium">{summary!.failed} Failed</span>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRefresh}
                    disabled={loading}
                    className="h-7 w-7 p-0"
                >
                    <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
                </Button>
            </div>
        </div>
    );
}
